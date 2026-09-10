begin;

create table public.trainer_assignments (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  owner_admin_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, trainer_id)
);

create index trainer_assignments_student_updated_idx
  on public.trainer_assignments (student_id, updated_at desc);
create index trainer_assignments_owner_student_idx
  on public.trainer_assignments (owner_admin_id, student_id);

create table public.trainer_assignment_skill_progress (
  assignment_id uuid not null references public.trainer_assignments(id) on delete cascade,
  skill_key text not null check (skill_key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  skill_fingerprint text not null check (skill_fingerprint ~ '^[0-9a-f]{64}$'),
  credited_correct integer not null default 0 check (credited_correct between 0 and 5),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, skill_key, skill_fingerprint)
);

create table public.trainer_completion_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  owner_admin_id uuid not null,
  source_trainer_id uuid,
  trainer_title text not null check (char_length(btrim(trainer_title)) between 1 and 120),
  trainer_type text not null,
  completed_at timestamptz not null default now(),
  skills_count integer not null check (skills_count > 0),
  progress_percent integer not null default 100 check (progress_percent = 100),
  created_at timestamptz not null default now()
);

create unique index trainer_completion_student_source_key
  on public.trainer_completion_history (student_id, owner_admin_id, source_trainer_id)
  where source_trainer_id is not null;
create index trainer_completion_student_completed_idx
  on public.trainer_completion_history (student_id, completed_at desc);
create index trainer_completion_owner_student_idx
  on public.trainer_completion_history (owner_admin_id, student_id);

alter table public.trainer_assignments enable row level security;
alter table public.trainer_assignment_skill_progress enable row level security;
alter table public.trainer_completion_history enable row level security;

revoke all on table public.trainer_assignments, public.trainer_assignment_skill_progress, public.trainer_completion_history from public, anon, authenticated;
grant select, insert, update, delete on table public.trainer_assignments, public.trainer_assignment_skill_progress, public.trainer_completion_history to service_role;

create function public.assign_trainer_atomic(p_owner_admin_id uuid, p_student_id uuid, p_trainer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':' || p_trainer_id::text, 8201));
  if not exists (select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN') then return jsonb_build_object('status', 'admin_not_found'); end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT') then return jsonb_build_object('status', 'student_not_found'); end if;
  if not exists (select 1 from public.trainers where id = p_trainer_id and owner_admin_id = p_owner_admin_id) then return jsonb_build_object('status', 'trainer_not_found'); end if;
  if exists (select 1 from public.trainer_assignments where student_id = p_student_id and trainer_id = p_trainer_id) then return jsonb_build_object('status', 'already_assigned'); end if;
  if exists (select 1 from public.trainer_completion_history where student_id = p_student_id and owner_admin_id = p_owner_admin_id and source_trainer_id = p_trainer_id) then return jsonb_build_object('status', 'already_completed'); end if;
  insert into public.trainer_assignments (trainer_id, student_id, owner_admin_id) values (p_trainer_id, p_student_id, p_owner_admin_id);
  return jsonb_build_object('status', 'created');
end;
$$;

create function public.reset_trainer_assignment_atomic(p_owner_admin_id uuid, p_student_id uuid, p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not exists (select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN') then return jsonb_build_object('status', 'admin_not_found'); end if;
  perform 1 from public.trainer_assignments where id = p_assignment_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  delete from public.trainer_assignment_skill_progress where assignment_id = p_assignment_id;
  update public.trainer_assignments set updated_at = now() where id = p_assignment_id;
  return jsonb_build_object('status', 'reset');
end;
$$;

create function public.restart_completed_trainer_atomic(p_owner_admin_id uuid, p_student_id uuid, p_completion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  completion public.trainer_completion_history%rowtype;
  source_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN') then return jsonb_build_object('status', 'admin_not_found'); end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT') then return jsonb_build_object('status', 'student_not_found'); end if;
  select source_trainer_id into source_id from public.trainer_completion_history
  where id = p_completion_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id;
  if not found then return jsonb_build_object('status', 'completion_not_found'); end if;
  if source_id is null then return jsonb_build_object('status', 'trainer_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':' || source_id::text, 8201));
  select * into completion from public.trainer_completion_history
  where id = p_completion_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id for update;
  if not found then return jsonb_build_object('status', 'completion_not_found'); end if;
  if completion.source_trainer_id is null or not exists (
    select 1 from public.trainers where id = completion.source_trainer_id and owner_admin_id = p_owner_admin_id
  ) then return jsonb_build_object('status', 'trainer_not_found'); end if;
  if exists (select 1 from public.trainer_assignments where student_id = p_student_id and trainer_id = completion.source_trainer_id) then return jsonb_build_object('status', 'already_assigned'); end if;
  delete from public.trainer_completion_history where id = completion.id;
  insert into public.trainer_assignments (trainer_id, student_id, owner_admin_id) values (completion.source_trainer_id, p_student_id, p_owner_admin_id);
  return jsonb_build_object('status', 'restarted');
end;
$$;

create function public.complete_trainer_assignment_atomic(p_owner_admin_id uuid, p_assignment_id uuid, p_expected_content_revision integer, p_skill_fingerprints jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  assignment public.trainer_assignments%rowtype;
  trainer public.trainers%rowtype;
  assignment_student_id uuid;
  current_skills integer;
begin
  if p_skill_fingerprints is null or jsonb_typeof(p_skill_fingerprints) <> 'object' then return jsonb_build_object('status', 'invalid_fingerprints'); end if;
  if not exists (select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN') then return jsonb_build_object('status', 'admin_not_found'); end if;
  select * into assignment from public.trainer_assignments where id = p_assignment_id and owner_admin_id = p_owner_admin_id;
  if not found then return jsonb_build_object('status', 'assignment_not_found'); end if;
  assignment_student_id := assignment.student_id;
  if not exists (select 1 from public.profiles where id = assignment_student_id and role = 'STUDENT') then return jsonb_build_object('status', 'student_not_found'); end if;
  select * into trainer from public.trainers where id = assignment.trainer_id and owner_admin_id = p_owner_admin_id for share;
  if not found then return jsonb_build_object('status', 'trainer_not_found'); end if;
  if p_expected_content_revision is null or trainer.content_revision <> p_expected_content_revision then return jsonb_build_object('status', 'stale_trainer'); end if;
  select * into assignment from public.trainer_assignments
  where id = p_assignment_id and owner_admin_id = p_owner_admin_id and trainer_id = trainer.id and student_id = assignment_student_id
  for update;
  if not found then return jsonb_build_object('status', 'assignment_not_found'); end if;
  current_skills := jsonb_array_length(trainer.definition->'skills');
  if current_skills < 1 or current_skills <> (select count(*) from jsonb_object_keys(p_skill_fingerprints)) then return jsonb_build_object('status', 'stale_skills'); end if;
  if exists (
    select 1 from jsonb_array_elements(trainer.definition->'skills') skill
    where not (p_skill_fingerprints ? (skill->>'key'))
  ) then return jsonb_build_object('status', 'stale_skills'); end if;
  if (select count(*) from public.trainer_assignment_skill_progress progress
      where progress.assignment_id = assignment.id and progress.credited_correct = 5
      and p_skill_fingerprints->>progress.skill_key = progress.skill_fingerprint) <> current_skills
  then return jsonb_build_object('status', 'not_complete'); end if;
  insert into public.trainer_completion_history (student_id, owner_admin_id, source_trainer_id, trainer_title, trainer_type, skills_count)
  values (assignment.student_id, assignment.owner_admin_id, trainer.id, trainer.title, trainer.type, current_skills);
  delete from public.trainer_assignments where id = assignment.id;
  return jsonb_build_object('status', 'completed');
exception when unique_violation then
  return jsonb_build_object('status', 'already_completed');
end;
$$;

revoke all on function public.assign_trainer_atomic(uuid, uuid, uuid), public.reset_trainer_assignment_atomic(uuid, uuid, uuid), public.restart_completed_trainer_atomic(uuid, uuid, uuid), public.complete_trainer_assignment_atomic(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.assign_trainer_atomic(uuid, uuid, uuid), public.reset_trainer_assignment_atomic(uuid, uuid, uuid), public.restart_completed_trainer_atomic(uuid, uuid, uuid), public.complete_trainer_assignment_atomic(uuid, uuid, integer, jsonb) to service_role;

comment on table public.trainer_completion_history is 'Immutable completion snapshots; identifier columns intentionally have no FK so educational history survives source deletion.';
comment on function public.complete_trainer_assignment_atomic(uuid, uuid, integer, jsonb) is 'Server-only Stage 3 completion boundary. Expected revision and fingerprints must come from the same current canonical trainer definition.';
comment on column public.trainers.content_revision is 'Must be incremented atomically with every update to definition that affects training content.';

commit;
