begin;

create table public.trainer_quick_problem_fingerprint_transitions (
  id bigint generated always as identity primary key,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  skill_key text not null check (skill_key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  old_fingerprint text not null check (old_fingerprint ~ '^[0-9a-f]{64}$'),
  new_fingerprint text not null check (new_fingerprint ~ '^[0-9a-f]{64}$'),
  from_content_revision integer not null check (from_content_revision > 0),
  to_content_revision integer not null check (to_content_revision = from_content_revision + 1),
  created_at timestamptz not null default now(),
  check (old_fingerprint <> new_fingerprint),
  unique (trainer_id, skill_key, old_fingerprint, new_fingerprint)
);

create index trainer_quick_problem_transitions_lookup_idx on public.trainer_quick_problem_fingerprint_transitions (trainer_id, skill_key, old_fingerprint);
alter table public.trainer_quick_problem_fingerprint_transitions enable row level security;
revoke all on table public.trainer_quick_problem_fingerprint_transitions from public, anon, authenticated;
revoke all on sequence public.trainer_quick_problem_fingerprint_transitions_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.trainer_quick_problem_fingerprint_transitions to service_role;
grant usage, select on sequence public.trainer_quick_problem_fingerprint_transitions_id_seq to service_role;

create function public.mutate_quick_problem_prompts_atomic(
  p_owner_admin_id uuid, p_trainer_id uuid, p_expected_content_revision integer,
  p_skill_key text, p_variant_key text, p_old_definition jsonb, p_new_definition jsonb,
  p_old_fingerprint text, p_new_fingerprint text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  trainer public.trainers%rowtype;
  old_skill jsonb; new_skill jsonb; old_variant jsonb; new_variant jsonb;
  next_revision integer;
begin
  if not exists (select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN') then return jsonb_build_object('status', 'admin_not_found'); end if;
  if p_skill_key !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$' or p_variant_key !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$' then return jsonb_build_object('status', 'invalid_target'); end if;
  if p_old_fingerprint !~ '^[0-9a-f]{64}$' or p_new_fingerprint !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status', 'invalid_fingerprint'); end if;
  if jsonb_typeof(p_old_definition) <> 'object' or jsonb_typeof(p_new_definition) <> 'object' then return jsonb_build_object('status', 'invalid_definition'); end if;

  select * into trainer from public.trainers where id = p_trainer_id and owner_admin_id = p_owner_admin_id and type = 'QUICK_PROBLEMS' for update;
  if not found then return jsonb_build_object('status', 'trainer_not_found'); end if;
  if trainer.content_revision <> p_expected_content_revision or trainer.definition <> p_old_definition then return jsonb_build_object('status', 'stale_trainer'); end if;
  if (p_old_definition - 'skills') <> (p_new_definition - 'skills') then return jsonb_build_object('status', 'non_prompt_change'); end if;
  if jsonb_typeof(p_old_definition->'skills') <> 'array' or jsonb_typeof(p_new_definition->'skills') <> 'array' or jsonb_array_length(p_old_definition->'skills') <> jsonb_array_length(p_new_definition->'skills') then return jsonb_build_object('status', 'non_prompt_change'); end if;

  if exists (
    select 1 from jsonb_array_elements(p_old_definition->'skills') with ordinality o(skill, position)
    join jsonb_array_elements(p_new_definition->'skills') with ordinality n(skill, position) using (position)
    where o.skill->>'key' is distinct from n.skill->>'key'
       or (o.skill->>'key' <> p_skill_key and o.skill <> n.skill)
       or (o.skill->>'key' = p_skill_key and (o.skill - 'variants') <> (n.skill - 'variants'))
  ) then return jsonb_build_object('status', 'non_prompt_change'); end if;

  if (select count(*) from jsonb_array_elements(p_old_definition->'skills') skill where skill->>'key' = p_skill_key) <> 1
     or (select count(*) from jsonb_array_elements(p_new_definition->'skills') skill where skill->>'key' = p_skill_key) <> 1 then return jsonb_build_object('status', 'invalid_skill_identity'); end if;
  select skill into old_skill from jsonb_array_elements(p_old_definition->'skills') skill where skill->>'key' = p_skill_key;
  select skill into new_skill from jsonb_array_elements(p_new_definition->'skills') skill where skill->>'key' = p_skill_key;
  if jsonb_typeof(old_skill->'variants') <> 'array' or jsonb_typeof(new_skill->'variants') <> 'array' or jsonb_array_length(old_skill->'variants') <> jsonb_array_length(new_skill->'variants') then return jsonb_build_object('status', 'non_prompt_change'); end if;

  if exists (
    select 1 from jsonb_array_elements(old_skill->'variants') with ordinality o(variant, position)
    join jsonb_array_elements(new_skill->'variants') with ordinality n(variant, position) using (position)
    where o.variant->>'key' is distinct from n.variant->>'key'
       or (o.variant->>'key' <> p_variant_key and o.variant <> n.variant)
       or (o.variant->>'key' = p_variant_key and (o.variant - 'prompts') <> (n.variant - 'prompts'))
  ) then return jsonb_build_object('status', 'non_prompt_change'); end if;

  if (select count(*) from jsonb_array_elements(old_skill->'variants') variant where variant->>'key' = p_variant_key) <> 1
     or (select count(*) from jsonb_array_elements(new_skill->'variants') variant where variant->>'key' = p_variant_key) <> 1 then return jsonb_build_object('status', 'invalid_variant_identity'); end if;
  select variant into old_variant from jsonb_array_elements(old_skill->'variants') variant where variant->>'key' = p_variant_key;
  select variant into new_variant from jsonb_array_elements(new_skill->'variants') variant where variant->>'key' = p_variant_key;
  if jsonb_typeof(old_variant->'prompts') <> 'array' or jsonb_typeof(new_variant->'prompts') <> 'array' or jsonb_array_length(new_variant->'prompts') < 1 then return jsonb_build_object('status', 'invalid_prompts'); end if;
  if old_variant->'prompts' = new_variant->'prompts' then return jsonb_build_object('status', 'unchanged', 'content_revision', trainer.content_revision); end if;
  if p_old_fingerprint = p_new_fingerprint then return jsonb_build_object('status', 'invalid_transition'); end if;

  next_revision := trainer.content_revision + 1;
  insert into public.trainer_quick_problem_fingerprint_transitions (trainer_id, skill_key, old_fingerprint, new_fingerprint, from_content_revision, to_content_revision)
  values (trainer.id, p_skill_key, p_old_fingerprint, p_new_fingerprint, trainer.content_revision, next_revision)
  on conflict (trainer_id, skill_key, old_fingerprint, new_fingerprint) do nothing;

  insert into public.trainer_assignment_skill_progress (assignment_id, skill_key, skill_fingerprint, credited_correct, updated_at)
  select progress.assignment_id, progress.skill_key, p_new_fingerprint, progress.credited_correct, now()
  from public.trainer_assignment_skill_progress progress join public.trainer_assignments assignment on assignment.id = progress.assignment_id
  where assignment.trainer_id = trainer.id and assignment.owner_admin_id = trainer.owner_admin_id and progress.skill_key = p_skill_key and progress.skill_fingerprint = p_old_fingerprint
  on conflict (assignment_id, skill_key, skill_fingerprint) do update set credited_correct = greatest(public.trainer_assignment_skill_progress.credited_correct, excluded.credited_correct), updated_at = now();

  delete from public.trainer_assignment_skill_progress progress using public.trainer_assignments assignment
  where assignment.id = progress.assignment_id and assignment.trainer_id = trainer.id and assignment.owner_admin_id = trainer.owner_admin_id and progress.skill_key = p_skill_key and progress.skill_fingerprint = p_old_fingerprint;
  update public.trainers set definition = p_new_definition, content_revision = next_revision, updated_at = now() where id = trainer.id;
  return jsonb_build_object('status', 'updated', 'content_revision', next_revision);
end;
$$;

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

revoke all on function public.mutate_quick_problem_prompts_atomic(uuid, uuid, integer, text, text, jsonb, jsonb, text, text), public.record_quick_problem_answer_atomic(uuid, uuid, uuid, bigint, integer, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_quick_problem_prompts_atomic(uuid, uuid, integer, text, text, jsonb, jsonb, text, text), public.record_quick_problem_answer_atomic(uuid, uuid, uuid, bigint, integer, jsonb) to service_role;

commit;
