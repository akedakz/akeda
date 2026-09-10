begin;

-- AUDIT-02. Profile SHARE is acquired before runtime locks and held to commit.
-- It conflicts with the admin's student_status UPDATE (NO KEY UPDATE), while
-- remaining compatible with foreign-key KEY SHARE locks from admin assignment.
-- An answer admitted first finishes before pause commits; pause admitted first
-- makes the waiting/current request reject. No client role/status is accepted.
create function public.lock_active_trainer_student(p_student_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  perform 1 from public.profiles
  where id=p_student_id and role='STUDENT' and student_status='ACTIVE' for share;
  return found;
end; $$;
revoke all on function public.lock_active_trainer_student(uuid) from public,anon,authenticated,service_role;

-- Quick task issuance currently uses a service-side batch INSERT. Protect that
-- existing path too (including an old app), before any task row is inserted.
-- The student comes from the stored assignment, never from task JSON.
create function public.enforce_active_quick_problem_task_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare student_id_value uuid;
begin
  select student_id into student_id_value from public.trainer_assignments where id=new.assignment_id;
  if not found then return new; end if; -- existing FK handles absent assignment
  if not public.lock_active_trainer_student(student_id_value) then
    raise exception using errcode='PT403', message='student_inactive';
  end if;
  return new;
end; $$;
revoke all on function public.enforce_active_quick_problem_task_insert() from public,anon,authenticated,service_role;
create trigger enforce_active_quick_problem_task_insert
before insert on public.trainer_quick_problem_tasks
for each row execute function public.enforce_active_quick_problem_task_insert();

-- Existing canonical bodies below are preserved, with only the entry guard added.
-- Admin assign/reset/restart/unassign and admin completion entry points are unchanged.
-- Theory retains its existing assignment -> trainer order. The pre-existing
-- trainer/assignment inversion (AUDIT-07) is outside this migration's scope.

-- Source: 20260902-quick-problems-live-content.sql
create or replace function public.record_quick_problem_answer_atomic(
  p_student_id uuid, p_assignment_id uuid, p_task_id uuid, p_submitted_answer bigint,
  p_expected_content_revision integer, p_skill_fingerprints jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  assignment public.trainer_assignments%rowtype; trainer public.trainers%rowtype; task public.trainer_quick_problem_tasks%rowtype;
  assignment_student_id uuid; current_fingerprint text; current_skills integer;
  credited_before integer := 0; credited_after integer := 0; total_credited integer := 0;
  correct boolean; completed_skills integer;
begin
  if not public.lock_active_trainer_student(p_student_id) then return jsonb_build_object('status','student_inactive'); end if;
  if p_skill_fingerprints is null or jsonb_typeof(p_skill_fingerprints) <> 'object' then return jsonb_build_object('status', 'invalid_fingerprints'); end if;
  if p_submitted_answer is null or p_submitted_answer < -1000000000 or p_submitted_answer > 1000000000 then return jsonb_build_object('status', 'invalid_answer'); end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT') then return jsonb_build_object('status', 'student_not_found'); end if;
  select * into assignment from public.trainer_assignments where id = p_assignment_id and student_id = p_student_id;
  if not found then return jsonb_build_object('status', 'assignment_not_found'); end if;
  assignment_student_id := assignment.student_id;
  select * into trainer from public.trainers where id = assignment.trainer_id and owner_admin_id = assignment.owner_admin_id for share;
  if not found then return jsonb_build_object('status', 'trainer_deleted'); end if;
  if p_expected_content_revision is null or trainer.content_revision <> p_expected_content_revision then return jsonb_build_object('status', 'stale_trainer'); end if;
  select * into assignment from public.trainer_assignments where id = p_assignment_id and student_id = assignment_student_id and trainer_id = trainer.id for update;
  if not found then return jsonb_build_object('status', 'assignment_not_found'); end if;
  select * into task from public.trainer_quick_problem_tasks where id = p_task_id and assignment_id = assignment.id for update;
  if not found then return jsonb_build_object('status', 'task_not_found'); end if;
  if task.consumed_at is not null then return jsonb_build_object('status', 'already_consumed', 'correct', task.result_correct, 'credited_correct', task.credited_correct_after); end if;

  current_fingerprint := p_skill_fingerprints->>task.skill_key;
  if current_fingerprint is null then return jsonb_build_object('status', 'stale_skills'); end if;
  if task.skill_fingerprint <> current_fingerprint and not exists (
    with recursive reachable(fingerprint) as (
      select task.skill_fingerprint union
      select transition.new_fingerprint from reachable step join public.trainer_quick_problem_fingerprint_transitions transition
        on transition.trainer_id = trainer.id and transition.skill_key = task.skill_key and transition.old_fingerprint = step.fingerprint
    ) select 1 from reachable where fingerprint = current_fingerprint
  ) then return jsonb_build_object('status', 'stale_skills'); end if;

  current_skills := jsonb_array_length(trainer.definition->'skills');
  if current_skills < 1 or current_skills <> (select count(*) from jsonb_object_keys(p_skill_fingerprints)) then return jsonb_build_object('status', 'stale_skills'); end if;
  if exists (select 1 from jsonb_array_elements(trainer.definition->'skills') skill where not (p_skill_fingerprints ? (skill->>'key'))) then return jsonb_build_object('status', 'stale_skills'); end if;
  correct := task.expected_answer = p_submitted_answer;
  update public.trainer_quick_problem_tasks set consumed_at = now(), submitted_answer = p_submitted_answer, result_correct = correct where id = task.id;

  if correct and task.mode = 'NORMAL' then
    select coalesce(progress.credited_correct, 0) into credited_before from (select 1) seed left join public.trainer_assignment_skill_progress progress on progress.assignment_id = assignment.id and progress.skill_key = task.skill_key and progress.skill_fingerprint = current_fingerprint;
    insert into public.trainer_assignment_skill_progress (assignment_id, skill_key, skill_fingerprint, credited_correct) values (assignment.id, task.skill_key, current_fingerprint, 1)
    on conflict (assignment_id, skill_key, skill_fingerprint) do update set credited_correct = least(5, public.trainer_assignment_skill_progress.credited_correct + 1), updated_at = now() returning credited_correct into credited_after;
  else
    select coalesce(progress.credited_correct, 0) into credited_after from (select 1) seed left join public.trainer_assignment_skill_progress progress on progress.assignment_id = assignment.id and progress.skill_key = task.skill_key and progress.skill_fingerprint = current_fingerprint;
  end if;

  select coalesce(sum(coalesce(progress.credited_correct, 0)), 0), count(*) filter (where progress.credited_correct = 5) into total_credited, completed_skills
  from jsonb_each_text(p_skill_fingerprints) fingerprint left join public.trainer_assignment_skill_progress progress on progress.assignment_id = assignment.id and progress.skill_key = fingerprint.key and progress.skill_fingerprint = fingerprint.value;
  update public.trainer_quick_problem_tasks set credited_correct_after = credited_after where id = task.id;
  if completed_skills = current_skills then
    insert into public.trainer_completion_history (student_id, owner_admin_id, source_trainer_id, trainer_title, trainer_type, skills_count) values (assignment.student_id, assignment.owner_admin_id, trainer.id, trainer.title, trainer.type, current_skills);
    delete from public.trainer_assignments where id = assignment.id;
    return jsonb_build_object('status', 'recorded', 'correct', correct, 'mode', task.mode, 'credited_correct', credited_after, 'skill_completed', task.mode = 'NORMAL' and credited_before < 5 and credited_after = 5, 'trainer_completed', true, 'progress_percent', 100);
  end if;
  return jsonb_build_object('status', 'recorded', 'correct', correct, 'mode', task.mode, 'credited_correct', credited_after, 'skill_completed', correct and task.mode = 'NORMAL' and credited_before < 5 and credited_after = 5, 'trainer_completed', false, 'progress_percent', round(total_credited::numeric / (current_skills * 5) * 100)::integer);
exception when unique_violation then return jsonb_build_object('status', 'completion_conflict');
end;
$$;
revoke all on function public.record_quick_problem_answer_atomic(uuid,uuid,uuid,bigint,integer,jsonb) from public,anon,authenticated;
grant execute on function public.record_quick_problem_answer_atomic(uuid,uuid,uuid,bigint,integer,jsonb) to service_role;

-- Source: 20260830-theory-trainer-runtime.sql
create or replace function public.record_theory_answer_atomic(p_student_id uuid, p_assignment_id uuid, p_task_id uuid, p_selected_option integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare a public.trainer_assignments%rowtype; t public.trainer_theory_tasks%rowtype; tr public.trainers%rowtype; q jsonb; is_ok boolean; count_after integer; q_count integer; earned integer;
begin
  if not public.lock_active_trainer_student(p_student_id) then return jsonb_build_object('status','student_inactive'); end if;
  if p_selected_option not between 0 and 3 then return jsonb_build_object('status','invalid_answer'); end if;
  select * into a from public.trainer_assignments where id=p_assignment_id and student_id=p_student_id for update;
  if not found then return jsonb_build_object('status','assignment_not_found'); end if;
  select * into tr from public.trainers where id=a.trainer_id and type='THEORY' and status='PUBLISHED' for share;
  if not found then return jsonb_build_object('status','trainer_not_found'); end if;
  select * into t from public.trainer_theory_tasks where id=p_task_id and assignment_id=a.id for update;
  if not found then return jsonb_build_object('status','task_not_found'); end if;
  if t.answered_at is not null then return jsonb_build_object('status','already_answered'); end if;
  select value into q from jsonb_array_elements(tr.definition->'questions') where value->>'key'=t.question_key limit 1;
  if q is null or q->>'fingerprint' is distinct from t.question_fingerprint then
    update public.trainer_theory_tasks set answered_at=now(),selected_option=p_selected_option,is_correct=false where id=t.id;
    return jsonb_build_object('status','stale');
  end if;
  is_ok := (q->>'correctOption')::integer = p_selected_option;
  update public.trainer_theory_tasks set answered_at=now(),selected_option=p_selected_option,is_correct=is_ok where id=t.id;
  if is_ok then
    insert into public.trainer_theory_question_progress(assignment_id,question_key,question_fingerprint,correct_count,last_answered_at)
    values(a.id,t.question_key,t.question_fingerprint,1,now())
    on conflict(assignment_id,question_key) do update set question_fingerprint=excluded.question_fingerprint, correct_count=case when trainer_theory_question_progress.question_fingerprint=excluded.question_fingerprint then least(3,trainer_theory_question_progress.correct_count+1) else 1 end,last_answered_at=now(),updated_at=now()
    returning correct_count into count_after;
  else
    select coalesce(correct_count,0) into count_after from public.trainer_theory_question_progress where assignment_id=a.id and question_key=t.question_key and question_fingerprint=t.question_fingerprint;
    count_after:=coalesce(count_after,0);
  end if;
  q_count:=jsonb_array_length(tr.definition->'questions');
  if q_count<1 then return jsonb_build_object('status','invalid_definition'); end if;
  select coalesce(sum(least(3,coalesce(p.correct_count,0))),0)::integer into earned from jsonb_array_elements(tr.definition->'questions') cq left join public.trainer_theory_question_progress p on p.assignment_id=a.id and p.question_key=cq->>'key' and p.question_fingerprint=cq->>'fingerprint';
  if earned=q_count*3 then
    insert into public.trainer_theory_completion_history(student_id,owner_admin_id,source_trainer_id,title_snapshot,question_count_snapshot,required_points_snapshot,assigned_at)
    values(a.student_id,a.owner_admin_id,tr.id,tr.title,q_count,q_count*3,a.assigned_at) on conflict(student_id,owner_admin_id,source_trainer_id) do nothing;
    delete from public.trainer_assignments where id=a.id;
    return jsonb_build_object('status','recorded','correct',is_ok,'correct_option',(q->>'correctOption')::integer,'explanation',q->>'explanation','question_count',count_after,'earned',earned,'required',q_count*3,'progress_percent',100,'trainer_completed',true);
  end if;
  return jsonb_build_object('status','recorded','correct',is_ok,'correct_option',(q->>'correctOption')::integer,'explanation',q->>'explanation','question_count',count_after,'earned',earned,'required',q_count*3,'progress_percent',round(earned::numeric/(q_count*3)*100),'trainer_completed',false);
end; $$;
revoke all on function public.record_theory_answer_atomic(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.record_theory_answer_atomic(uuid,uuid,uuid,integer) to service_role;

-- Source: 20260830-theory-runner-performance.sql
create or replace function public.issue_theory_question_atomic(p_student_id uuid, p_assignment_id uuid)
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
  if not public.lock_active_trainer_student(p_student_id) then return jsonb_build_object('status','student_inactive'); end if;
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
revoke all on function public.issue_theory_question_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_theory_question_atomic(uuid,uuid) to service_role;

-- Source: 20260830-theory-runner-performance.sql
create or replace function public.record_theory_answer_and_issue_atomic(p_student_id uuid, p_assignment_id uuid, p_task_id uuid, p_selected_option integer)
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
  if not public.lock_active_trainer_student(p_student_id) then return jsonb_build_object('status','student_inactive'); end if;
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
revoke all on function public.record_theory_answer_and_issue_atomic(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.record_theory_answer_and_issue_atomic(uuid,uuid,uuid,integer) to service_role;

-- Source: 20260903-formula-recall-student-runtime.sql
create or replace function public.issue_formula_recall_task_atomic(p_student_id uuid, p_topic_id uuid default null, p_advance boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  runtime public.formula_recall_student_state; active public.formula_recall_tasks; picked_assignment public.formula_recall_student_formulas;
  picked_retry public.formula_recall_retries; picked_formula public.formula_recall_formulas; picked_condition public.formula_recall_conditions;
  condition_text_value text; condition_id_value uuid; alternatives_value jsonb; topic_title_value text; next_sequence bigint;
begin
  if not public.lock_active_trainer_student(p_student_id) then return jsonb_build_object('status','student_inactive'); end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','forbidden'); end if;
  if p_advance is null then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-runtime',8404));
  insert into public.formula_recall_student_state(student_id) values(p_student_id) on conflict do nothing;
  select * into active from public.formula_recall_tasks where student_id=p_student_id and state<>'DONE';
  if found then
    perform 1 from public.formula_recall_formulas where id=active.formula_id and owner_admin_id=active.owner_admin_id for share;
    if not found then return jsonb_build_object('status','unavailable'); end if;
    select * into picked_assignment from public.formula_recall_student_formulas
    where id=active.student_formula_id and student_id=p_student_id and formula_id=active.formula_id for update;
    if not found then return jsonb_build_object('status','unavailable'); end if;
    select * into active from public.formula_recall_tasks
    where id=active.id and student_id=p_student_id and student_formula_id=picked_assignment.id and formula_id=picked_assignment.formula_id and state<>'DONE' for update;
    if not found then return jsonb_build_object('status','unavailable'); end if;
    select * into runtime from public.formula_recall_student_state where student_id=p_student_id for update;
    if p_advance and active.state in ('CORRECT_CLEAN','CORRECT_HINTED') then
      update public.formula_recall_tasks set state='DONE',completed_at=now(),updated_at=now() where id=active.id;
      update public.formula_recall_student_state set completed_sequence=completed_sequence+1,last_formula_id=active.formula_id,updated_at=now() where student_id=p_student_id returning * into runtime;
    else return jsonb_build_object('status','resumed','task_id',active.id); end if;
  else
    select * into runtime from public.formula_recall_student_state where student_id=p_student_id for update;
  end if;

  select r.* into picked_retry from public.formula_recall_retries r
  join public.formula_recall_student_formulas sf on sf.id=r.student_formula_id
  join public.formula_recall_formulas f on f.id=sf.formula_id
  where r.student_id=p_student_id and r.target_canonical_expression=sf.target_canonical_expression
    and (p_topic_id is null or f.topic_id=p_topic_id) and r.eligible_after_sequence<=runtime.completed_sequence
  order by random() limit 1;

  if picked_retry.id is not null then select * into picked_assignment from public.formula_recall_student_formulas where id=picked_retry.student_formula_id;
  else
    select sf.* into picked_assignment from public.formula_recall_student_formulas sf
    join public.formula_recall_formulas f on f.id=sf.formula_id
    where sf.student_id=p_student_id and sf.clean_recall_count<3 and (p_topic_id is null or f.topic_id=p_topic_id)
      and not exists(select 1 from public.formula_recall_retries r where r.student_formula_id=sf.id)
    order by (sf.formula_id=runtime.last_formula_id),random() limit 1;
    if picked_assignment.id is null then
      select r.* into picked_retry from public.formula_recall_retries r
      join public.formula_recall_student_formulas sf on sf.id=r.student_formula_id
      join public.formula_recall_formulas f on f.id=sf.formula_id
      where r.student_id=p_student_id and r.target_canonical_expression=sf.target_canonical_expression and (p_topic_id is null or f.topic_id=p_topic_id)
      order by random() limit 1;
      if picked_retry.id is not null then select * into picked_assignment from public.formula_recall_student_formulas where id=picked_retry.student_formula_id; end if;
    end if;
  end if;
  if picked_assignment.id is null then
    if exists(select 1 from public.formula_recall_student_formulas where student_id=p_student_id) then return jsonb_build_object('status','complete'); end if;
    return jsonb_build_object('status','empty');
  end if;

  select * into picked_formula from public.formula_recall_formulas where id=picked_assignment.formula_id and owner_admin_id=picked_assignment.owner_admin_id for share;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  select * into picked_assignment from public.formula_recall_student_formulas
  where id=picked_assignment.id and student_id=p_student_id and formula_id=picked_formula.id and owner_admin_id=picked_formula.owner_admin_id for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  if picked_retry.id is not null then
    select * into picked_retry from public.formula_recall_retries
    where id=picked_retry.id and student_id=p_student_id and student_formula_id=picked_assignment.id
      and formula_id=picked_formula.id and target_canonical_expression=picked_assignment.target_canonical_expression for update;
    if not found then return jsonb_build_object('status','unavailable'); end if;
  end if;
  if picked_retry.id is not null then condition_id_value:=picked_retry.condition_id; condition_text_value:=picked_retry.condition_text_snapshot;
  else
    select c.* into picked_condition from public.formula_recall_conditions c where c.formula_id=picked_formula.id
      order by (c.id=picked_assignment.last_condition_id),random() limit 1;
    if picked_condition.id is null then return jsonb_build_object('status','unavailable'); end if;
    condition_id_value:=picked_condition.id; condition_text_value:=picked_condition.text;
  end if;
  select coalesce(jsonb_agg(a.expression order by a.sort_order),'[]'::jsonb) into alternatives_value from public.formula_recall_alternatives a where a.formula_id=picked_formula.id;
  select title into topic_title_value from public.formula_recall_topics where id=picked_formula.topic_id;
  select coalesce(max(issued_sequence),0)+1 into next_sequence from public.formula_recall_tasks where student_id=p_student_id;
  insert into public.formula_recall_tasks(owner_admin_id,student_id,student_formula_id,formula_id,condition_id,condition_text_snapshot,canonical_expression_snapshot,alternative_expressions_snapshot,formula_content_revision_snapshot,topic_id_snapshot,topic_title_snapshot,practice_topic_id,issued_sequence)
  values(picked_assignment.owner_admin_id,p_student_id,picked_assignment.id,picked_formula.id,condition_id_value,condition_text_value,picked_formula.canonical_expression,alternatives_value,picked_formula.content_revision,picked_formula.topic_id,topic_title_value,p_topic_id,next_sequence) returning * into active;
  update public.formula_recall_student_formulas set last_condition_id=condition_id_value,updated_at=now() where id=picked_assignment.id;
  if picked_retry.id is not null then delete from public.formula_recall_retries where id=picked_retry.id; end if;
  return jsonb_build_object('status','issued','task_id',active.id);
end; $$;
revoke all on function public.issue_formula_recall_task_atomic(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.issue_formula_recall_task_atomic(uuid,uuid,boolean) to service_role;

-- Source: 20260903-formula-recall-student-runtime.sql
create or replace function public.submit_formula_recall_answer_atomic(p_student_id uuid, p_task_id uuid, p_is_correct boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare task_meta public.formula_recall_tasks; task public.formula_recall_tasks; assigned public.formula_recall_student_formulas; runtime public.formula_recall_student_state; awarded boolean:=false;
begin
  if not public.lock_active_trainer_student(p_student_id) then return jsonb_build_object('status','student_inactive'); end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','forbidden'); end if;
  if p_is_correct is null then return jsonb_build_object('status','invalid'); end if;
  select * into task_meta from public.formula_recall_tasks where id=p_task_id and student_id=p_student_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-runtime',8404));
  perform 1 from public.formula_recall_formulas where id=task_meta.formula_id and owner_admin_id=task_meta.owner_admin_id for share;
  if not found then return jsonb_build_object('status','unassigned'); end if;
  select * into assigned from public.formula_recall_student_formulas
  where id=task_meta.student_formula_id and student_id=p_student_id and formula_id=task_meta.formula_id and owner_admin_id=task_meta.owner_admin_id for update;
  if not found then return jsonb_build_object('status','unassigned'); end if;
  select * into task from public.formula_recall_tasks
  where id=p_task_id and student_id=p_student_id and student_formula_id=assigned.id and formula_id=assigned.formula_id and owner_admin_id=assigned.owner_admin_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if task.state in ('CORRECT_CLEAN','CORRECT_HINTED') then return jsonb_build_object('status','already_completed','state',task.state,'credit_awarded',task.credit_awarded); end if;
  if task.state='REVEALED' and not p_is_correct then return jsonb_build_object('status','already_revealed','state',task.state); end if;
  if task.state not in ('AWAITING_ANSWER','RETRY_AFTER_HINT') then return jsonb_build_object('status','invalid_state','state',task.state); end if;
  select * into runtime from public.formula_recall_student_state where student_id=p_student_id for update;
  if not p_is_correct then
    update public.formula_recall_tasks set state='REVEALED',hinted=true,updated_at=now() where id=task.id;
    if task.canonical_expression_snapshot=assigned.target_canonical_expression then
      insert into public.formula_recall_retries(owner_admin_id,student_id,student_formula_id,formula_id,condition_id,condition_text_snapshot,target_content_revision,target_canonical_expression,eligible_after_sequence)
      values(task.owner_admin_id,p_student_id,assigned.id,task.formula_id,task.condition_id,task.condition_text_snapshot,assigned.target_content_revision,assigned.target_canonical_expression,runtime.completed_sequence+4)
      on conflict(student_formula_id) do update set condition_id=excluded.condition_id,condition_text_snapshot=excluded.condition_text_snapshot,target_content_revision=excluded.target_content_revision,target_canonical_expression=excluded.target_canonical_expression,eligible_after_sequence=excluded.eligible_after_sequence,updated_at=now();
    end if;
    return jsonb_build_object('status','revealed','state','REVEALED');
  end if;
  if task.state='AWAITING_ANSWER' and not task.hinted and not task.credit_awarded and task.canonical_expression_snapshot=assigned.target_canonical_expression then
    update public.formula_recall_student_formulas set clean_recall_count=least(3,clean_recall_count+1),updated_at=now() where id=assigned.id;
    awarded:=true;
  end if;
  update public.formula_recall_tasks set state=case when task.hinted or task.state='RETRY_AFTER_HINT' or task.canonical_expression_snapshot<>assigned.target_canonical_expression then 'CORRECT_HINTED' else 'CORRECT_CLEAN' end,
    credit_awarded=awarded,updated_at=now() where id=task.id;
  return jsonb_build_object('status','correct','state',case when task.hinted or task.state='RETRY_AFTER_HINT' or task.canonical_expression_snapshot<>assigned.target_canonical_expression then 'CORRECT_HINTED' else 'CORRECT_CLEAN' end,'credit_awarded',awarded);
end; $$;
revoke all on function public.submit_formula_recall_answer_atomic(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.submit_formula_recall_answer_atomic(uuid,uuid,boolean) to service_role;

-- Source: 20260903-formula-recall-student-runtime.sql
create or replace function public.acknowledge_formula_recall_hint_atomic(p_student_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if not public.lock_active_trainer_student(p_student_id) then return jsonb_build_object('status','student_inactive'); end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-runtime',8404));
  if exists(select 1 from public.formula_recall_tasks where id=p_task_id and student_id=p_student_id and state='RETRY_AFTER_HINT') then return jsonb_build_object('status','already_acknowledged'); end if;
  update public.formula_recall_tasks set state='RETRY_AFTER_HINT',hinted=true,updated_at=now()
  where id=p_task_id and student_id=p_student_id and state='REVEALED';
  if not found then return jsonb_build_object('status','invalid_state'); end if;
  return jsonb_build_object('status','acknowledged');
end; $$;
revoke all on function public.acknowledge_formula_recall_hint_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acknowledge_formula_recall_hint_atomic(uuid,uuid) to service_role;

commit;
