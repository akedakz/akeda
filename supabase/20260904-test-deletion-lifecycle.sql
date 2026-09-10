-- Additive only. Apply manually after 20260901-single-attempt-test-assignments.sql.
-- Keeps historical assignment snapshots and their Storage images independent
-- from the lifecycle of live source tests.
begin;

-- Prevent legacy writers/deleters from racing the one-time backfill while this
-- migration transaction installs the new protocol.
lock table public.tests, public.test_questions, public.test_assignments in share row exclusive mode;

create table if not exists public.test_assignment_image_refs (
  assignment_id uuid not null references public.test_assignments(id) on delete cascade,
  storage_path text not null check (btrim(storage_path) <> ''),
  created_at timestamptz not null default now(),
  primary key (assignment_id, storage_path)
);

create index if not exists test_assignment_image_refs_storage_path_idx
  on public.test_assignment_image_refs(storage_path);

create table if not exists public.test_image_cleanup_claims (
  storage_path text primary key check (btrim(storage_path) <> ''),
  claimed_at timestamptz not null default now()
);

alter table public.test_assignment_image_refs enable row level security;
revoke all on table public.test_assignment_image_refs from public, anon, authenticated;
grant select, insert, delete on table public.test_assignment_image_refs to service_role;
alter table public.test_image_cleanup_claims enable row level security;
revoke all on table public.test_image_cleanup_claims from public, anon, authenticated;
grant select on table public.test_image_cleanup_claims to service_role;

create or replace function public.lock_test_lifecycle_tests(p_test_ids uuid[])
returns void language plpgsql set search_path = pg_catalog, public as $$
declare v_test_id uuid;
begin
  for v_test_id in
    select distinct id from unnest(coalesce(p_test_ids, array[]::uuid[])) ids(id)
    where id is not null order by id
  loop
    perform pg_advisory_xact_lock(hashtextextended('nsp:test-lifecycle:test:' || v_test_id::text, 0));
  end loop;
end;
$$;

create or replace function public.lock_test_lifecycle_images(p_paths text[])
returns void language plpgsql set search_path = pg_catalog, public as $$
declare v_path text;
begin
  for v_path in
    select distinct btrim(path) from unnest(coalesce(p_paths, array[]::text[])) paths(path)
    where nullif(btrim(path), '') is not null order by btrim(path)
  loop
    perform pg_advisory_xact_lock(hashtextextended('nsp:test-lifecycle:image:' || v_path, 0));
  end loop;
end;
$$;

revoke all on function public.lock_test_lifecycle_tests(uuid[]) from public, anon, authenticated;
revoke all on function public.lock_test_lifecycle_images(text[]) from public, anon, authenticated;

create or replace function public.claim_test_image_cleanup_candidates(p_paths text[])
returns text[] language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_paths text[];
begin
  select coalesce(array_agg(path order by path),array[]::text[]) into v_paths
  from (select distinct btrim(path) path from unnest(coalesce(p_paths,array[]::text[])) paths(path)
    where nullif(btrim(path),'') is not null) normalized;
  perform public.lock_test_lifecycle_images(v_paths);
  insert into public.test_image_cleanup_claims(storage_path)
  select path from unnest(v_paths) candidates(path)
  where not exists(select 1 from public.test_questions q where q.image_path=path)
    and not exists(select 1 from public.test_assignment_image_refs r where r.storage_path=path)
  on conflict do nothing;
  return coalesce((select array_agg(path order by path) from unnest(v_paths) candidates(path)
    where exists(select 1 from public.test_image_cleanup_claims c where c.storage_path=path)
      and not exists(select 1 from public.test_questions q where q.image_path=path)
      and not exists(select 1 from public.test_assignment_image_refs r where r.storage_path=path)),array[]::text[]);
end;
$$;

revoke all on function public.claim_test_image_cleanup_candidates(text[]) from public,anon,authenticated,service_role;

create or replace function public.capture_test_assignment_image_refs()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_paths text[];
begin
  select coalesce(array_agg(path order by path), array[]::text[]) into v_paths
  from (
    select distinct btrim(question->>'imagePath') as path
    from jsonb_array_elements(
      case when jsonb_typeof(new.snapshot->'questions') = 'array'
        then new.snapshot->'questions' else '[]'::jsonb end
    ) questions(question)
    where nullif(btrim(question->>'imagePath'), '') is not null
  ) unique_paths;

  perform public.lock_test_lifecycle_images(v_paths);
  if exists(select 1 from public.test_image_cleanup_claims claim where claim.storage_path=any(v_paths)) then
    raise exception using errcode='55000',message='ASSIGNMENT_IMAGE_CLEANUP_CLAIMED';
  end if;
  insert into public.test_assignment_image_refs(assignment_id, storage_path)
  select new.id, path from unnest(v_paths) paths(path)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists capture_test_assignment_image_refs on public.test_assignments;
create trigger capture_test_assignment_image_refs
after insert on public.test_assignments
for each row execute function public.capture_test_assignment_image_refs();

-- Idempotent backfill: malformed/non-array legacy snapshots produce no rows;
-- duplicate, NULL and blank paths are ignored.
insert into public.test_assignment_image_refs(assignment_id, storage_path)
select assignment.id, btrim(question->>'imagePath')
from public.test_assignments assignment
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(assignment.snapshot->'questions') = 'array'
    then assignment.snapshot->'questions' else '[]'::jsonb end
) questions(question)
where nullif(btrim(question->>'imagePath'), '') is not null
on conflict do nothing;

-- Assignment inserts must go through the locked RPCs below. SECURITY DEFINER
-- functions continue to work as their owner.
revoke insert on table public.test_assignments from service_role;

create or replace function public.create_single_attempt_test_assignment_atomic(
  p_student_id uuid, p_source_test_id uuid, p_title text, p_snapshot jsonb,
  p_deadline_at timestamptz, p_show_correct_answers_after_close boolean,
  p_assigned_by uuid, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_assignment_id uuid;
begin
  if p_idempotency_key is null or nullif(btrim(p_title), '') is null
     or char_length(btrim(p_title)) > 240
     or jsonb_typeof(p_snapshot) is distinct from 'object'
     or coalesce(p_snapshot->>'version', '') not in ('1', '2')
     or jsonb_typeof(p_snapshot->'questions') is distinct from 'array' then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform public.lock_test_lifecycle_tests(array[p_source_test_id]);

  select id into v_assignment_id from public.test_assignments
  where assigned_by = p_assigned_by and idempotency_key = p_idempotency_key;
  if v_assignment_id is not null then
    return jsonb_build_object('status', 'already_created', 'assignment_id', v_assignment_id);
  end if;

  if not exists(select 1 from public.profiles where id = p_assigned_by and role = 'ADMIN')
     or not exists(select 1 from public.profiles where id = p_student_id and role = 'STUDENT')
     or not exists(select 1 from public.tests where id = p_source_test_id
       and created_by = p_assigned_by and status = 'PUBLISHED' and is_assignment_copy = false) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if exists(
    select 1
    from jsonb_array_elements(p_snapshot->'questions') question
    where nullif(btrim(question->>'imagePath'), '') is not null
      and not exists(select 1 from public.test_questions live
        where live.test_id=p_source_test_id and live.image_path=btrim(question->>'imagePath'))
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':' || p_source_test_id::text, 0));
  select id into v_assignment_id from public.test_assignments
  where assigned_by = p_assigned_by and idempotency_key = p_idempotency_key;
  if v_assignment_id is not null then
    return jsonb_build_object('status', 'already_created', 'assignment_id', v_assignment_id);
  end if;
  if exists(select 1 from public.test_assignments assignment
    where assignment.student_id = p_student_id and assignment.source_test_id = p_source_test_id
      and (not exists(select 1 from public.test_attempts attempt where attempt.assignment_id = assignment.id and attempt.submitted_at is not null)
        or exists(select 1 from public.test_attempts attempt where attempt.assignment_id = assignment.id and attempt.submitted_at is null))) then
    return jsonb_build_object('status', 'active_exists');
  end if;

  insert into public.test_assignments(student_id, source_test_id, title, snapshot, deadline_at,
    max_attempts, show_correct_answers_after_close, assigned_by, idempotency_key)
  values(p_student_id, p_source_test_id, btrim(p_title), p_snapshot, p_deadline_at, 1,
    coalesce(p_show_correct_answers_after_close, false), p_assigned_by, p_idempotency_key)
  returning id into v_assignment_id;
  return jsonb_build_object('status', 'created', 'assignment_id', v_assignment_id);
end;
$$;

create or replace function public.create_composite_test_assignment_atomic(
  p_student_id uuid, p_source_test_ids uuid[], p_title text, p_question_count integer,
  p_sampling_mode text, p_shuffle_questions boolean, p_deadline_at timestamptz,
  p_show_correct_answers_after_close boolean, p_assigned_by uuid, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_result jsonb;
begin
  if p_idempotency_key is null then raise exception using errcode='22023', message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform public.lock_test_lifecycle_tests(p_source_test_ids);
  insert into public.test_assignment_creation_operations(assigned_by,idempotency_key)
  values(p_assigned_by,p_idempotency_key) on conflict do nothing;
  select result into v_result from public.test_assignment_creation_operations
  where assigned_by=p_assigned_by and idempotency_key=p_idempotency_key for update;
  if v_result is not null then return v_result; end if;
  v_result:=public.create_composite_test_assignment_atomic_unkeyed(
    p_student_id,p_source_test_ids,p_title,p_question_count,p_sampling_mode,p_shuffle_questions,
    p_deadline_at,p_show_correct_answers_after_close,p_assigned_by);
  update public.test_assignment_creation_operations set result=v_result
  where assigned_by=p_assigned_by and idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.inspect_test_folder_deletion(p_folder_id uuid, p_created_by uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_folder_count integer; v_test_count integer;
begin
  if not exists(select 1 from public.profiles where id=p_created_by and role='ADMIN') then
    return jsonb_build_object('status','forbidden');
  end if;
  if not exists(select 1 from public.test_folders where id=p_folder_id and created_by=p_created_by) then
    return jsonb_build_object('status','not_found');
  end if;
  with recursive tree as (
    select id from public.test_folders where id=p_folder_id and created_by=p_created_by
    union all select f.id from public.test_folders f join tree t on f.parent_id=t.id where f.created_by=p_created_by
  )
  select (select count(*)-1 from tree),
    (select count(*) from public.tests where folder_id in(select id from tree) and created_by=p_created_by and is_assignment_copy=false)
  into v_folder_count,v_test_count;
  return jsonb_build_object('status','ready','descendant_folders',v_folder_count,'tests',v_test_count);
end;
$$;

create or replace function public.delete_unassigned_test_atomic(p_test_id uuid, p_created_by uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_paths text[];
begin
  if not exists(select 1 from public.profiles where id=p_created_by and role='ADMIN') then
    return jsonb_build_object('status','forbidden');
  end if;
  perform public.lock_test_lifecycle_tests(array[p_test_id]);
  if not exists(select 1 from public.tests where id=p_test_id and created_by=p_created_by and is_assignment_copy=false) then
    return jsonb_build_object('status','not_found');
  end if;
  select coalesce(array_agg(distinct btrim(image_path) order by btrim(image_path)),array[]::text[]) into v_paths
  from public.test_questions where test_id=p_test_id and nullif(btrim(image_path),'') is not null;
  perform public.lock_test_lifecycle_images(v_paths);
  delete from public.test_question_options where question_id in(select id from public.test_questions where test_id=p_test_id);
  delete from public.test_questions where test_id=p_test_id;
  delete from public.tests where id=p_test_id and created_by=p_created_by and is_assignment_copy=false;
  v_paths:=public.claim_test_image_cleanup_candidates(v_paths);
  return jsonb_build_object('status','deleted','image_paths',to_jsonb(v_paths));
end;
$$;

create or replace function public.delete_test_folder_atomic(p_folder_id uuid, p_created_by uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_test_ids uuid[]; v_paths text[]; v_check jsonb;
begin
  if not exists(select 1 from public.profiles where id=p_created_by and role='ADMIN') then
    return jsonb_build_object('status','forbidden');
  end if;
  v_check:=public.inspect_test_folder_deletion(p_folder_id,p_created_by);
  if v_check->>'status' <> 'ready' then return v_check; end if;
  create temporary table lifecycle_folder_tree(id uuid primary key, depth integer not null) on commit drop;
  insert into lifecycle_folder_tree
  with recursive tree as (
    select id,0 from public.test_folders where id=p_folder_id and created_by=p_created_by
    union all select f.id,t.depth+1 from public.test_folders f join tree t on f.parent_id=t.id where f.created_by=p_created_by
  ) select * from tree;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_test_ids from public.tests
  where folder_id in(select id from lifecycle_folder_tree) and created_by=p_created_by and is_assignment_copy=false;
  perform public.lock_test_lifecycle_tests(v_test_ids);
  -- Recheck after waiting for creators and reject mixed-ownership trees.
  if exists(select 1 from public.test_folders f join lifecycle_folder_tree t on f.parent_id=t.id where not exists(select 1 from lifecycle_folder_tree x where x.id=f.id))
     or exists(select 1 from public.tests where folder_id in(select id from lifecycle_folder_tree)
       and (created_by is distinct from p_created_by or is_assignment_copy)) then
    return jsonb_build_object('status','forbidden');
  end if;
  select coalesce(array_agg(distinct btrim(image_path) order by btrim(image_path)),array[]::text[]) into v_paths
  from public.test_questions where test_id=any(v_test_ids) and nullif(btrim(image_path),'') is not null;
  perform public.lock_test_lifecycle_images(v_paths);
  delete from public.test_question_options where question_id in(select id from public.test_questions where test_id=any(v_test_ids));
  delete from public.test_questions where test_id=any(v_test_ids);
  delete from public.tests where id=any(v_test_ids) and created_by=p_created_by and is_assignment_copy=false;
  delete from public.test_folders where id in(select id from lifecycle_folder_tree order by depth desc);
  v_paths:=public.claim_test_image_cleanup_candidates(v_paths);
  return jsonb_build_object('status','deleted','image_paths',to_jsonb(v_paths));
end;
$$;

create or replace function public.delete_test_assignment_safe(p_assignment_id uuid, p_student_id uuid, p_assigned_by uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_assignment public.test_assignments%rowtype; v_source_test_id uuid; v_is_copy boolean:=false; v_paths text[]; v_test_ids uuid[];
begin
  if not exists(select 1 from public.profiles where id=p_assigned_by and role='ADMIN') then
    return jsonb_build_object('status','forbidden');
  end if;
  select source_test_id into v_source_test_id from public.test_assignments
  where id=p_assignment_id and student_id=p_student_id and assigned_by=p_assigned_by;
  if not found then return jsonb_build_object('status','not_found'); end if;
  v_test_ids:=case when v_source_test_id is null then array[]::uuid[] else array[v_source_test_id] end;
  perform public.lock_test_lifecycle_tests(v_test_ids);
  select * into v_assignment from public.test_assignments
  where id=p_assignment_id and student_id=p_student_id and assigned_by=p_assigned_by for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  select coalesce(is_assignment_copy,false) into v_is_copy from public.tests where id=v_assignment.source_test_id;
  select coalesce(array_agg(distinct path order by path),array[]::text[]) into v_paths from (
    select storage_path path from public.test_assignment_image_refs where assignment_id=p_assignment_id
    union select image_path from public.test_questions where v_is_copy and test_id=v_assignment.source_test_id and nullif(btrim(image_path),'') is not null
  ) paths;
  perform public.lock_test_lifecycle_images(v_paths);
  delete from public.test_attempt_answers where attempt_id in(select id from public.test_attempts where assignment_id=p_assignment_id and student_id=p_student_id);
  delete from public.test_attempts where assignment_id=p_assignment_id and student_id=p_student_id;
  delete from public.test_assignments where id=p_assignment_id and student_id=p_student_id and assigned_by=p_assigned_by;
  if v_is_copy then
    delete from public.test_question_options where question_id in(select id from public.test_questions where test_id=v_assignment.source_test_id);
    delete from public.test_questions where test_id=v_assignment.source_test_id;
    delete from public.tests where id=v_assignment.source_test_id and is_assignment_copy=true;
  end if;
  v_paths:=public.claim_test_image_cleanup_candidates(v_paths);
  return jsonb_build_object('status','deleted','image_paths',to_jsonb(v_paths));
end;
$$;

-- Serialize editor mutations with assignment creation/deletion. The original
-- function remains the single implementation of editor validation and writes.
alter function public.save_test_editor(uuid,text,text,jsonb)
  rename to save_test_editor_without_lifecycle_lock;
revoke all on function public.save_test_editor_without_lifecycle_lock(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;

create function public.save_test_editor(p_test_id uuid,p_title text,p_description text,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_paths text[];
begin
  perform public.lock_test_lifecycle_tests(array[p_test_id]);
  select coalesce(array_agg(path order by path),array[]::text[]) into v_paths
  from (select distinct btrim(question->>'imagePath') path
    from jsonb_array_elements(case when jsonb_typeof(p_questions)='array' then p_questions else '[]'::jsonb end) question
    where nullif(btrim(question->>'imagePath'),'') is not null) proposed;
  perform public.lock_test_lifecycle_images(v_paths);
  if exists(select 1 from public.test_image_cleanup_claims claim where claim.storage_path=any(v_paths)) then
    raise exception using errcode='55000',message='TEST_IMAGE_CLEANUP_CLAIMED';
  end if;
  return public.save_test_editor_without_lifecycle_lock(p_test_id,p_title,p_description,p_questions);
end;
$$;

revoke all on function public.save_test_editor(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_test_editor(uuid,text,text,jsonb) to service_role;

create or replace function public.test_image_cleanup_candidates(p_test_id uuid,p_paths text[],p_created_by uuid)
returns text[] language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_paths text[];
begin
  if not exists(select 1 from public.profiles where id=p_created_by and role='ADMIN')
     or not exists(select 1 from public.tests where id=p_test_id and created_by=p_created_by and is_assignment_copy=false) then
    return array[]::text[];
  end if;
  perform public.lock_test_lifecycle_tests(array[p_test_id]);
  select coalesce(array_agg(path order by path),array[]::text[]) into v_paths
  from (select distinct btrim(path) path from unnest(coalesce(p_paths,array[]::text[])) paths(path)
    where nullif(btrim(path),'') is not null) normalized;
  return public.claim_test_image_cleanup_candidates(v_paths);
end;
$$;

revoke all on function public.test_image_cleanup_candidates(uuid,text[],uuid) from public,anon,authenticated;
grant execute on function public.test_image_cleanup_candidates(uuid,text[],uuid) to service_role;

create or replace function public.test_import_image_cleanup_candidates(p_test_id uuid,p_paths text[],p_admin_id uuid)
returns text[] language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN')
     or not exists(select 1 from public.test_import_sessions where test_id=p_test_id and admin_id=p_admin_id) then
    return array[]::text[];
  end if;
  if exists(select 1 from unnest(coalesce(p_paths,array[]::text[])) paths(path)
    where path not like 'tests/' || p_test_id::text || '/questions/%' or path like '%..%') then
    return array[]::text[];
  end if;
  perform public.lock_test_lifecycle_tests(array[p_test_id]);
  return public.claim_test_image_cleanup_candidates(p_paths);
end;
$$;

revoke all on function public.test_import_image_cleanup_candidates(uuid,text[],uuid) from public,anon,authenticated;
grant execute on function public.test_import_image_cleanup_candidates(uuid,text[],uuid) to service_role;

revoke all on function public.inspect_test_folder_deletion(uuid) from service_role;
revoke all on function public.delete_test_folder_atomic(uuid) from service_role;
revoke all on function public.delete_unassigned_test_atomic(uuid) from service_role;
revoke all on function public.delete_test_assignment_safe(uuid,uuid) from service_role;
revoke all on function public.inspect_test_folder_deletion(uuid,uuid) from public,anon,authenticated;
revoke all on function public.delete_test_folder_atomic(uuid,uuid) from public,anon,authenticated;
revoke all on function public.delete_unassigned_test_atomic(uuid,uuid) from public,anon,authenticated;
revoke all on function public.delete_test_assignment_safe(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.inspect_test_folder_deletion(uuid,uuid), public.delete_test_folder_atomic(uuid,uuid),
  public.delete_unassigned_test_atomic(uuid,uuid), public.delete_test_assignment_safe(uuid,uuid,uuid) to service_role;

commit;
