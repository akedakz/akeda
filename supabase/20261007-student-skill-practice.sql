begin;

create or replace function public.submit_learning_skill_attempt_atomic(
  p_student_id uuid,
  p_attempt_id uuid,
  p_answers jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attempt public.learning_skill_practice_attempts%rowtype;
  v_task public.learning_skill_practice_tasks%rowtype;
  v_answer text;
  v_normalized text;
  v_correct integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('status','invalid_answers');
  end if;

  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then
    return jsonb_build_object('status','student_not_found');
  end if;

  select * into v_attempt
  from public.learning_skill_practice_attempts
  where id=p_attempt_id and profile_id=p_student_id
  for update;

  if not found then return jsonb_build_object('status','attempt_not_found'); end if;
  if v_attempt.status <> 'OPEN' then return jsonb_build_object('status','already_completed'); end if;

  if not exists(
    select 1
    from public.learning_program_topics topic
    join public.student_learning_programs assigned
      on assigned.program_id=topic.program_id
     and assigned.student_id=p_student_id
    where topic.id=v_attempt.program_topic_id
  ) then
    return jsonb_build_object('status','not_assigned');
  end if;

  if (select count(*) from jsonb_object_keys(p_answers)) <> v_attempt.total_questions then
    return jsonb_build_object('status','incomplete');
  end if;

  for v_task in
    select * from public.learning_skill_practice_tasks
    where attempt_id=v_attempt.id
    order by position
    for update
  loop
    if v_task.answered_at is not null then
      return jsonb_build_object('status','already_completed');
    end if;

    v_answer := btrim(coalesce(p_answers->>v_task.id::text,''));
    if v_answer !~ '^[+-]?[0-9]+$' then
      return jsonb_build_object('status','invalid_answer','task_id',v_task.id);
    end if;

    begin
      v_normalized := (v_answer::bigint)::text;
    exception when numeric_value_out_of_range then
      return jsonb_build_object('status','invalid_answer','task_id',v_task.id);
    end;

    if v_normalized = v_task.expected_answer then
      v_correct := v_correct + 1;
    end if;

    update public.learning_skill_practice_tasks
    set submitted_answer=v_normalized,
        is_correct=(v_normalized=v_task.expected_answer),
        answered_at=now()
    where id=v_task.id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'task_id',v_task.id,
      'correct',(v_normalized=v_task.expected_answer),
      'expected_answer',v_task.expected_answer
    ));
  end loop;

  update public.learning_skill_practice_attempts
  set status='COMPLETED',
      correct_answers=v_correct,
      completed_at=now()
  where id=v_attempt.id;

  if v_correct=v_attempt.total_questions then
    insert into public.student_learning_program_topic_progress(
      student_id,program_id,program_topic_id,completed_at,updated_at
    )
    select p_student_id,topic.program_id,topic.id,now(),now()
    from public.learning_program_topics topic
    where topic.id=v_attempt.program_topic_id
    on conflict (student_id,program_topic_id)
    do update set completed_at=coalesce(public.student_learning_program_topic_progress.completed_at,excluded.completed_at),
                  updated_at=now();
  end if;

  return jsonb_build_object(
    'status','completed',
    'score',v_correct,
    'total',v_attempt.total_questions,
    'mastered',v_correct=v_attempt.total_questions,
    'results',v_results
  );
end;
$$;

revoke all on function public.submit_learning_skill_attempt_atomic(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_learning_skill_attempt_atomic(uuid,uuid,jsonb) to service_role;

commit;
