begin;

create function public.issue_theory_question_atomic(p_student_id uuid, p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  a public.trainer_assignments%rowtype;
  tr public.trainers%rowtype;
  existing_task public.trainer_theory_tasks%rowtype;
  chosen_question jsonb;
  chosen_key text;
  chosen_fingerprint text;
  recent_key text;
  pool_count integer;
  mastery integer;
  earned integer;
  required integer;
begin
  select * into a from public.trainer_assignments
  where id = p_assignment_id and student_id = p_student_id for update;
  if not found then return jsonb_build_object('status', 'assignment_not_found'); end if;

  select * into tr from public.trainers
  where id = a.trainer_id and type = 'THEORY' and status = 'PUBLISHED' for share;
  if not found or jsonb_typeof(tr.definition->'questions') <> 'array' or jsonb_array_length(tr.definition->'questions') < 1 then
    return jsonb_build_object('status', 'trainer_not_found');
  end if;

  update public.trainer_theory_tasks task set answered_at = now(), is_correct = false
  where task.assignment_id = a.id and task.answered_at is null and (
    not exists (
      select 1 from jsonb_array_elements(tr.definition->'questions') question
      where question->>'key' = task.question_key and question->>'fingerprint' = task.question_fingerprint
    ) or coalesce((
      select progress.correct_count from public.trainer_theory_question_progress progress
      where progress.assignment_id = a.id and progress.question_key = task.question_key and progress.question_fingerprint = task.question_fingerprint
    ), 0) >= 3
  );

  select task.* into existing_task from public.trainer_theory_tasks task
  where task.assignment_id = a.id and task.answered_at is null
  order by task.issued_at, task.id limit 1 for update;

  if found then
    update public.trainer_theory_tasks set answered_at = now(), is_correct = false
    where assignment_id = a.id and answered_at is null and id <> existing_task.id;
    select question into chosen_question from jsonb_array_elements(tr.definition->'questions') question
    where question->>'key' = existing_task.question_key and question->>'fingerprint' = existing_task.question_fingerprint limit 1;
    chosen_key := existing_task.question_key;
    mastery := coalesce((select correct_count from public.trainer_theory_question_progress where assignment_id = a.id and question_key = chosen_key and question_fingerprint = existing_task.question_fingerprint), 0);
  else
    select task.question_key into recent_key from public.trainer_theory_tasks task
    where task.assignment_id = a.id order by task.issued_at desc, task.id desc limit 1;

    select count(*)::integer into pool_count
    from jsonb_array_elements(tr.definition->'questions') question
    left join public.trainer_theory_question_progress progress
      on progress.assignment_id = a.id and progress.question_key = question->>'key' and progress.question_fingerprint = question->>'fingerprint'
    where coalesce(progress.correct_count, 0) < 3;
    if pool_count = 0 then return jsonb_build_object('status', 'no_question'); end if;

    select candidate.question, candidate.question->>'key', candidate.question->>'fingerprint'
    into chosen_question, chosen_key, chosen_fingerprint
    from (
      select question,
        (select max(task.issued_at) from public.trainer_theory_tasks task where task.assignment_id = a.id and task.question_key = question->>'key') last_seen
      from jsonb_array_elements(tr.definition->'questions') question
      left join public.trainer_theory_question_progress progress
        on progress.assignment_id = a.id and progress.question_key = question->>'key' and progress.question_fingerprint = question->>'fingerprint'
      where coalesce(progress.correct_count, 0) < 3
    ) candidate
    order by case when pool_count > 1 and candidate.question->>'key' = recent_key then 1 else 0 end,
      candidate.last_seen nulls first, candidate.question->>'key'
    limit 1;

    insert into public.trainer_theory_tasks(assignment_id, question_key, question_fingerprint)
    values(a.id, chosen_key, chosen_fingerprint) returning * into existing_task;
    mastery := coalesce((select correct_count from public.trainer_theory_question_progress where assignment_id = a.id and question_key = chosen_key and question_fingerprint = chosen_fingerprint), 0);
  end if;

  required := jsonb_array_length(tr.definition->'questions') * 3;
  select coalesce(sum(least(3, coalesce(progress.correct_count, 0))), 0)::integer into earned
  from jsonb_array_elements(tr.definition->'questions') question
  left join public.trainer_theory_question_progress progress
    on progress.assignment_id = a.id and progress.question_key = question->>'key' and progress.question_fingerprint = question->>'fingerprint';

  return jsonb_build_object(
    'status', 'issued', 'assignment_id', a.id, 'title', tr.title,
    'earned', earned, 'required', required, 'progress_percent', round(earned::numeric / required * 100),
    'task', jsonb_build_object('id', existing_task.id, 'question_key', chosen_key, 'text', chosen_question->>'text', 'options', chosen_question->'options', 'mastery', mastery)
  );
end;
$$;

create function public.record_theory_answer_and_issue_atomic(p_student_id uuid, p_assignment_id uuid, p_task_id uuid, p_selected_option integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  a public.trainer_assignments%rowtype;
  task public.trainer_theory_tasks%rowtype;
  tr public.trainers%rowtype;
  question jsonb;
  answer_is_correct boolean;
  count_after integer;
  question_count integer;
  earned integer;
  issued jsonb;
begin
  if p_selected_option not between 0 and 3 then return jsonb_build_object('status', 'invalid_answer'); end if;
  select * into a from public.trainer_assignments where id = p_assignment_id and student_id = p_student_id for update;
  if not found then return jsonb_build_object('status', 'assignment_not_found'); end if;
  select * into tr from public.trainers where id = a.trainer_id and type = 'THEORY' and status = 'PUBLISHED' for share;
  if not found then return jsonb_build_object('status', 'trainer_not_found'); end if;
  select * into task from public.trainer_theory_tasks where id = p_task_id and assignment_id = a.id for update;
  if not found then return jsonb_build_object('status', 'task_not_found'); end if;
  if task.answered_at is not null then return jsonb_build_object('status', 'already_answered'); end if;

  select value into question from jsonb_array_elements(tr.definition->'questions') where value->>'key' = task.question_key limit 1;
  if question is null or question->>'fingerprint' is distinct from task.question_fingerprint then
    update public.trainer_theory_tasks set answered_at = now(), selected_option = p_selected_option, is_correct = false where id = task.id;
    issued := public.issue_theory_question_atomic(p_student_id, p_assignment_id);
    return jsonb_build_object('status', 'stale', 'earned', issued->'earned', 'required', issued->'required', 'progress_percent', issued->'progress_percent', 'next_question', issued->'task');
  end if;

  answer_is_correct := (question->>'correctOption')::integer = p_selected_option;
  update public.trainer_theory_tasks set answered_at = now(), selected_option = p_selected_option, is_correct = answer_is_correct where id = task.id;
  if answer_is_correct then
    insert into public.trainer_theory_question_progress(assignment_id, question_key, question_fingerprint, correct_count, last_answered_at)
    values(a.id, task.question_key, task.question_fingerprint, 1, now())
    on conflict(assignment_id, question_key) do update set
      question_fingerprint = excluded.question_fingerprint,
      correct_count = case when trainer_theory_question_progress.question_fingerprint = excluded.question_fingerprint then least(3, trainer_theory_question_progress.correct_count + 1) else 1 end,
      last_answered_at = now(), updated_at = now()
    returning correct_count into count_after;
  else
    select coalesce(correct_count, 0) into count_after from public.trainer_theory_question_progress
    where assignment_id = a.id and question_key = task.question_key and question_fingerprint = task.question_fingerprint;
    count_after := coalesce(count_after, 0);
  end if;

  question_count := jsonb_array_length(tr.definition->'questions');
  select coalesce(sum(least(3, coalesce(progress.correct_count, 0))), 0)::integer into earned
  from jsonb_array_elements(tr.definition->'questions') current_question
  left join public.trainer_theory_question_progress progress
    on progress.assignment_id = a.id and progress.question_key = current_question->>'key' and progress.question_fingerprint = current_question->>'fingerprint';

  if earned = question_count * 3 then
    insert into public.trainer_theory_completion_history(student_id, owner_admin_id, source_trainer_id, title_snapshot, question_count_snapshot, required_points_snapshot, assigned_at)
    values(a.student_id, a.owner_admin_id, tr.id, tr.title, question_count, question_count * 3, a.assigned_at)
    on conflict(student_id, owner_admin_id, source_trainer_id) do nothing;
    delete from public.trainer_assignments where id = a.id;
    return jsonb_build_object('status', 'recorded', 'correct', answer_is_correct, 'correct_option', (question->>'correctOption')::integer, 'explanation', case when answer_is_correct then null else question->>'explanation' end, 'question_count', count_after, 'earned', earned, 'required', question_count * 3, 'progress_percent', 100, 'trainer_completed', true, 'next_question', null);
  end if;

  issued := public.issue_theory_question_atomic(p_student_id, p_assignment_id);
  return jsonb_build_object('status', 'recorded', 'correct', answer_is_correct, 'correct_option', (question->>'correctOption')::integer, 'explanation', case when answer_is_correct then null else question->>'explanation' end, 'question_count', count_after, 'earned', earned, 'required', question_count * 3, 'progress_percent', round(earned::numeric / (question_count * 3) * 100), 'trainer_completed', false, 'next_question', issued->'task');
end;
$$;

revoke all on function public.issue_theory_question_atomic(uuid, uuid), public.record_theory_answer_and_issue_atomic(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.issue_theory_question_atomic(uuid, uuid), public.record_theory_answer_and_issue_atomic(uuid, uuid, uuid, integer) to service_role;

commit;
