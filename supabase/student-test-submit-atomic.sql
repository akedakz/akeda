create or replace function public.save_student_test_answer_if_in_progress(
  p_attempt_id uuid,
  p_question_key text,
  p_answer jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.test_attempts%rowtype;
begin
  select * into v_attempt
  from public.test_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TEST_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.submitted_at is not null then
    return false;
  end if;
  if not exists (
    select 1 from public.test_assignments assignment
    where assignment.id = v_attempt.assignment_id
      and assignment.student_id = v_attempt.student_id
  ) then
    raise exception using errcode = 'P0001', message = 'TEST_ASSIGNMENT_OWNERSHIP_MISMATCH';
  end if;

  insert into public.test_attempt_answers(
    attempt_id, question_key, answer, is_correct, points_awarded, updated_at
  ) values (
    p_attempt_id, p_question_key, p_answer, null, null, now()
  )
  on conflict (attempt_id, question_key) do update
  set answer = excluded.answer,
      is_correct = null,
      points_awarded = null,
      updated_at = now();

  return true;
end;
$$;

create or replace function public.submit_student_test_attempt_atomic(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_assignment public.test_assignments%rowtype;
  v_question jsonb;
  v_answer jsonb;
  v_answer_type text;
  v_question_key text;
  v_question_type text;
  v_matches boolean;
  v_filled boolean;
  v_points numeric;
  v_score numeric := 0;
  v_max_score numeric := 0;
  v_correct integer := 0;
  v_incorrect integer := 0;
  v_unanswered integer := 0;
  v_selected text[];
  v_expected text[];
  v_numeric_value numeric;
  v_exact_value numeric;
  v_tolerance numeric;
  v_range_min numeric;
  v_range_max numeric;
begin
  select * into v_attempt
  from public.test_attempts
  where id = p_attempt_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TEST_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.submitted_at is not null then
    raise exception using errcode = 'P0001', message = 'TEST_ATTEMPT_ALREADY_SUBMITTED';
  end if;

  select * into v_assignment
  from public.test_assignments
  where id = v_attempt.assignment_id
    and student_id = v_attempt.student_id
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'TEST_ASSIGNMENT_OWNERSHIP_MISMATCH';
  end if;
  if v_assignment.deadline_at is not null and v_assignment.deadline_at <= now() then
    raise exception using errcode = 'P0001', message = 'TEST_ASSIGNMENT_DEADLINE_PASSED';
  end if;
  if v_attempt.attempt_number < 1
     or v_attempt.attempt_number > v_assignment.max_attempts
     or (select count(*) from public.test_attempts other
         where other.assignment_id = v_assignment.id
           and other.student_id = v_attempt.student_id
           and other.submitted_at is not null) >= v_assignment.max_attempts then
    raise exception using errcode = 'P0001', message = 'TEST_ASSIGNMENT_ATTEMPT_LIMIT';
  end if;
  if v_assignment.snapshot->>'version' <> '1'
     or jsonb_typeof(v_assignment.snapshot->'questions') <> 'array' then
    raise exception using errcode = 'P0001', message = 'TEST_ASSIGNMENT_INVALID_SNAPSHOT';
  end if;

  for v_question in
    select value from jsonb_array_elements(v_assignment.snapshot->'questions')
  loop
    v_question_key := v_question->>'key';
    v_question_type := v_question->>'type';
    v_points := (v_question->>'points')::numeric;
    v_max_score := v_max_score + v_points;
    v_matches := false;
    v_filled := false;
    v_answer := null;

    select answer into v_answer
    from public.test_attempt_answers
    where attempt_id = p_attempt_id and question_key = v_question_key;

    v_answer_type := v_answer->>'type';
    if v_question_type = 'SINGLE_CHOICE' and v_answer_type = 'SINGLE_CHOICE' then
      v_filled := nullif(v_answer->>'optionKey', '') is not null;
      if v_filled then
        v_matches := exists (
          select 1 from jsonb_array_elements(v_question->'options') option
          where option->>'key' = v_answer->>'optionKey'
            and coalesce((option->>'isCorrect')::boolean, false)
        );
      end if;
    elsif v_question_type = 'MULTIPLE_CHOICE'
          and v_answer_type = 'MULTIPLE_CHOICE'
          and jsonb_typeof(v_answer->'optionKeys') = 'array' then
      select coalesce(array_agg(distinct value order by value), array[]::text[])
        into v_selected
      from jsonb_array_elements_text(v_answer->'optionKeys');
      select coalesce(array_agg(distinct option->>'key' order by option->>'key'), array[]::text[])
        into v_expected
      from jsonb_array_elements(v_question->'options') option
      where coalesce((option->>'isCorrect')::boolean, false);
      v_filled := cardinality(v_selected) > 0;
      v_matches := v_filled and v_selected = v_expected;
    elsif v_question_type = 'NUMERIC'
          and v_answer_type = 'NUMERIC'
          and v_answer->'value' is not null
          and jsonb_typeof(v_answer->'value') = 'number' then
      v_filled := true;
      v_numeric_value := (v_answer->>'value')::numeric;
      if v_question->'numeric'->>'mode' = 'EXACT' then
        v_exact_value := (v_question->'numeric'->>'exactValue')::numeric;
        v_matches := v_numeric_value = v_exact_value;
      elsif v_question->'numeric'->>'mode' = 'TOLERANCE' then
        v_exact_value := (v_question->'numeric'->>'exactValue')::numeric;
        v_tolerance := (v_question->'numeric'->>'tolerance')::numeric;
        v_matches := abs(v_numeric_value - v_exact_value) <= v_tolerance;
      elsif v_question->'numeric'->>'mode' = 'RANGE' then
        v_range_min := (v_question->'numeric'->>'rangeMin')::numeric;
        v_range_max := (v_question->'numeric'->>'rangeMax')::numeric;
        v_matches := v_numeric_value between v_range_min and v_range_max;
      end if;
    end if;

    if not v_filled then
      v_unanswered := v_unanswered + 1;
    elsif v_matches then
      v_correct := v_correct + 1;
      v_score := v_score + v_points;
    else
      v_incorrect := v_incorrect + 1;
    end if;

    update public.test_attempt_answers
    set is_correct = v_matches,
        points_awarded = case when v_matches then v_points else 0 end,
        updated_at = now()
    where attempt_id = p_attempt_id and question_key = v_question_key;
  end loop;

  update public.test_attempts
  set submitted_at = now(),
      score = v_score,
      max_score = v_max_score,
      correct_count = v_correct,
      incorrect_count = v_incorrect,
      unanswered_count = v_unanswered,
      updated_at = now()
  where id = p_attempt_id and submitted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'TEST_ATTEMPT_ALREADY_SUBMITTED';
  end if;

  return jsonb_build_object(
    'attemptId', p_attempt_id,
    'assignmentId', v_assignment.id,
    'score', v_score,
    'maxScore', v_max_score,
    'correct', v_correct,
    'incorrect', v_incorrect,
    'unanswered', v_unanswered
  );
exception
  when others then
    raise;
end;
$$;

revoke all on function public.save_student_test_answer_if_in_progress(uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function public.submit_student_test_attempt_atomic(uuid)
from public, anon, authenticated;
grant execute on function public.save_student_test_answer_if_in_progress(uuid, text, jsonb)
to service_role;
grant execute on function public.submit_student_test_attempt_atomic(uuid)
to service_role;
