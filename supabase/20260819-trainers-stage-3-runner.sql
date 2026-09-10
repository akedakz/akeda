begin;

create table public.trainer_quick_problem_tasks (
  id uuid primary key,
  assignment_id uuid not null references public.trainer_assignments(id) on delete cascade,
  issued_sequence bigint generated always as identity unique,
  mode text not null check (mode in ('NORMAL', 'HINT')),
  skill_key text not null check (skill_key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  skill_fingerprint text not null check (skill_fingerprint ~ '^[0-9a-f]{64}$'),
  variant_key text not null check (variant_key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  content_revision integer not null check (content_revision > 0),
  prompt text not null check (char_length(prompt) between 1 and 1000),
  answer_unit text not null check (char_length(btrim(answer_unit)) between 1 and 40),
  expected_answer bigint not null check (expected_answer between -1000000000 and 1000000000),
  consumed_at timestamptz,
  submitted_answer bigint,
  result_correct boolean,
  credited_correct_after integer check (credited_correct_after between 0 and 5),
  created_at timestamptz not null default now(),
  check ((consumed_at is null and submitted_answer is null and result_correct is null) or
         (consumed_at is not null and submitted_answer is not null and result_correct is not null))
);

create index trainer_quick_tasks_assignment_queue_idx
  on public.trainer_quick_problem_tasks (assignment_id, mode, issued_sequence desc);
create index trainer_quick_tasks_unconsumed_idx
  on public.trainer_quick_problem_tasks (assignment_id, issued_sequence)
  where consumed_at is null;

alter table public.trainer_quick_problem_tasks enable row level security;
revoke all on table public.trainer_quick_problem_tasks from public, anon, authenticated;
revoke all on sequence public.trainer_quick_problem_tasks_issued_sequence_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.trainer_quick_problem_tasks to service_role;
grant usage, select on sequence public.trainer_quick_problem_tasks_issued_sequence_seq to service_role;

create function public.record_quick_problem_answer_atomic(
  p_student_id uuid,
  p_assignment_id uuid,
  p_task_id uuid,
  p_submitted_answer bigint,
  p_expected_content_revision integer,
  p_skill_fingerprints jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  assignment public.trainer_assignments%rowtype;
  trainer public.trainers%rowtype;
  task public.trainer_quick_problem_tasks%rowtype;
  assignment_student_id uuid;
  current_skills integer;
  credited_before integer := 0;
  credited_after integer := 0;
  total_credited integer := 0;
  correct boolean;
  completed_skills integer;
begin
  if p_skill_fingerprints is null or jsonb_typeof(p_skill_fingerprints) <> 'object' then return jsonb_build_object('status', 'invalid_fingerprints'); end if;
  if p_submitted_answer is null or p_submitted_answer < -1000000000 or p_submitted_answer > 1000000000 then return jsonb_build_object('status', 'invalid_answer'); end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT') then return jsonb_build_object('status', 'student_not_found'); end if;

  select * into assignment from public.trainer_assignments where id = p_assignment_id and student_id = p_student_id;
  if not found then return jsonb_build_object('status', 'assignment_not_found'); end if;
  assignment_student_id := assignment.student_id;

  select * into trainer from public.trainers
  where id = assignment.trainer_id and owner_admin_id = assignment.owner_admin_id
  for share;
  if not found then return jsonb_build_object('status', 'trainer_deleted'); end if;
  if p_expected_content_revision is null or trainer.content_revision <> p_expected_content_revision then return jsonb_build_object('status', 'stale_trainer'); end if;

  select * into assignment from public.trainer_assignments
  where id = p_assignment_id and student_id = assignment_student_id and trainer_id = trainer.id
  for update;
  if not found then return jsonb_build_object('status', 'assignment_not_found'); end if;

  select * into task from public.trainer_quick_problem_tasks
  where id = p_task_id and assignment_id = assignment.id
  for update;
  if not found then return jsonb_build_object('status', 'task_not_found'); end if;
  if task.consumed_at is not null then
    return jsonb_build_object('status', 'already_consumed', 'correct', task.result_correct, 'credited_correct', task.credited_correct_after);
  end if;
  if task.content_revision <> trainer.content_revision then return jsonb_build_object('status', 'stale_trainer'); end if;
  if p_skill_fingerprints->>task.skill_key is distinct from task.skill_fingerprint then return jsonb_build_object('status', 'stale_trainer'); end if;

  current_skills := jsonb_array_length(trainer.definition->'skills');
  if current_skills < 1 or current_skills <> (select count(*) from jsonb_object_keys(p_skill_fingerprints)) then return jsonb_build_object('status', 'stale_trainer'); end if;
  if exists (select 1 from jsonb_array_elements(trainer.definition->'skills') skill where not (p_skill_fingerprints ? (skill->>'key'))) then return jsonb_build_object('status', 'stale_trainer'); end if;

  correct := task.expected_answer = p_submitted_answer;
  update public.trainer_quick_problem_tasks set consumed_at = now(), submitted_answer = p_submitted_answer, result_correct = correct where id = task.id;

  if correct and task.mode = 'NORMAL' then
    select coalesce(max(progress.credited_correct), 0) into credited_before
    from public.trainer_assignment_skill_progress progress
    where progress.assignment_id = assignment.id and progress.skill_key = task.skill_key and progress.skill_fingerprint = task.skill_fingerprint;
    insert into public.trainer_assignment_skill_progress (assignment_id, skill_key, skill_fingerprint, credited_correct)
    values (assignment.id, task.skill_key, task.skill_fingerprint, 1)
    on conflict (assignment_id, skill_key, skill_fingerprint) do update
      set credited_correct = least(5, public.trainer_assignment_skill_progress.credited_correct + 1), updated_at = now()
    returning credited_correct into credited_after;
  else
    select coalesce(progress.credited_correct, 0) into credited_after
    from (select 1) seed left join public.trainer_assignment_skill_progress progress
      on progress.assignment_id = assignment.id and progress.skill_key = task.skill_key and progress.skill_fingerprint = task.skill_fingerprint;
  end if;

  select coalesce(sum(least(5, progress.credited_correct)), 0), count(*) filter (where progress.credited_correct = 5)
  into total_credited, completed_skills
  from jsonb_each_text(p_skill_fingerprints) fingerprint
  left join public.trainer_assignment_skill_progress progress
    on progress.assignment_id = assignment.id and progress.skill_key = fingerprint.key and progress.skill_fingerprint = fingerprint.value;

  update public.trainer_quick_problem_tasks set credited_correct_after = credited_after where id = task.id;

  if completed_skills = current_skills then
    insert into public.trainer_completion_history (student_id, owner_admin_id, source_trainer_id, trainer_title, trainer_type, skills_count)
    values (assignment.student_id, assignment.owner_admin_id, trainer.id, trainer.title, trainer.type, current_skills);
    delete from public.trainer_assignments where id = assignment.id;
    return jsonb_build_object('status', 'recorded', 'correct', correct, 'mode', task.mode, 'credited_correct', credited_after, 'skill_completed', task.mode = 'NORMAL' and credited_before < 5 and credited_after = 5, 'trainer_completed', true, 'progress_percent', 100);
  end if;

  return jsonb_build_object(
    'status', 'recorded', 'correct', correct, 'mode', task.mode,
    'credited_correct', credited_after,
    'skill_completed', correct and task.mode = 'NORMAL' and credited_before < 5 and credited_after = 5,
    'trainer_completed', false,
    'progress_percent', round(total_credited::numeric / (current_skills * 5) * 100)::integer
  );
exception when unique_violation then
  return jsonb_build_object('status', 'completion_conflict');
end;
$$;

revoke all on function public.record_quick_problem_answer_atomic(uuid, uuid, uuid, bigint, integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_quick_problem_answer_atomic(uuid, uuid, uuid, bigint, integer, jsonb) to service_role;

comment on table public.trainer_quick_problem_tasks is 'Server-issued one-time QUICK_PROBLEMS tasks. Expected answers are never selected by browser clients.';
comment on function public.record_quick_problem_answer_atomic(uuid, uuid, uuid, bigint, integer, jsonb) is 'Student-server boundary: consumes one task, records credit, and completes the trainer atomically.';

commit;
