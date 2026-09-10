begin;

create table public.material_file_upload_sessions (
  material_id uuid primary key,
  admin_id uuid not null,
  folder_id uuid,
  title text not null,
  description text,
  original_file_name text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
alter table public.material_file_upload_sessions enable row level security;
revoke all on table public.material_file_upload_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.material_file_upload_sessions to service_role;

create table public.material_storage_cleanup_queue (
  admin_id uuid not null,
  subject_kind text not null check (subject_kind in ('MATERIAL','FOLDER')),
  subject_id uuid not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  primary key (admin_id, subject_kind, subject_id, storage_path)
);
alter table public.material_storage_cleanup_queue enable row level security;
revoke all on table public.material_storage_cleanup_queue from public, anon, authenticated;
grant select, insert, delete on table public.material_storage_cleanup_queue to service_role;

create table public.test_import_sessions (
  test_id uuid primary key,
  admin_id uuid not null,
  storage_prefix text not null unique,
  created_at timestamptz not null default now(),
  cleanup_pending boolean not null default false
);
alter table public.test_import_sessions enable row level security;
revoke all on table public.test_import_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.test_import_sessions to service_role;

create function public.finalize_material_file_upload_atomic(
  p_material_id uuid, p_admin_id uuid, p_storage_path text,
  p_actual_mime_type text, p_actual_file_size bigint
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_session public.material_file_upload_sessions%rowtype;
begin
  select * into v_session from public.material_file_upload_sessions
  where material_id=p_material_id and admin_id=p_admin_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_session.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if v_session.storage_path<>p_storage_path or p_storage_path not like 'materials/'||p_material_id::text||'/%'
     or p_storage_path like '%..%' or p_actual_file_size<1 or p_actual_file_size>104857600 then
    return jsonb_build_object('status','invalid_object');
  end if;
  if v_session.folder_id is not null and not exists(
    select 1 from public.material_folders where id=v_session.folder_id and created_by=p_admin_id
  ) then return jsonb_build_object('status','invalid_folder'); end if;
  insert into public.materials(id,folder_id,type,title,description,storage_path,original_file_name,mime_type,file_size,created_by)
  values(v_session.material_id,v_session.folder_id,'FILE',v_session.title,v_session.description,
    v_session.storage_path,v_session.original_file_name,nullif(p_actual_mime_type,''),p_actual_file_size,p_admin_id);
  delete from public.material_file_upload_sessions where material_id=p_material_id;
  return jsonb_build_object('status','created','folder_id',v_session.folder_id,'title',v_session.title);
end; $$;

create function public.delete_material_with_cleanup_atomic(p_material_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_material public.materials%rowtype; v_paths text[]; v_existed boolean:=false;
begin
  select * into v_material from public.materials where id=p_material_id and created_by=p_admin_id for update;
  if found then
    v_existed:=true;
    if v_material.type='FILE' and v_material.storage_path is not null then
      insert into public.material_storage_cleanup_queue(admin_id,subject_kind,subject_id,storage_path)
      values(p_admin_id,'MATERIAL',p_material_id,v_material.storage_path) on conflict do nothing;
    end if;
    delete from public.materials where id=p_material_id;
  end if;
  select coalesce(array_agg(storage_path),array[]::text[]) into v_paths
  from public.material_storage_cleanup_queue where admin_id=p_admin_id and subject_kind='MATERIAL' and subject_id=p_material_id;
  if not v_existed and cardinality(v_paths)=0 then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','deleted','folder_id',v_material.folder_id,'storage_paths',to_jsonb(v_paths));
end; $$;

create function public.delete_material_folder_with_cleanup_atomic(p_folder_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_paths text[];
begin
  perform 1 from public.material_folders where id=p_folder_id and created_by=p_admin_id for update;
  if not found then
    select coalesce(array_agg(storage_path),array[]::text[]) into v_paths from public.material_storage_cleanup_queue
    where admin_id=p_admin_id and subject_kind='FOLDER' and subject_id=p_folder_id;
    return case when cardinality(v_paths)>0 then jsonb_build_object('status','deleted','storage_paths',to_jsonb(v_paths)) else jsonb_build_object('status','not_found') end;
  end if;
  if exists(with recursive tree as (select id,created_by from public.material_folders where id=p_folder_id union all select f.id,f.created_by from public.material_folders f join tree t on f.parent_id=t.id) select 1 from tree where created_by<>p_admin_id)
     or exists(with recursive tree as (select id from public.material_folders where id=p_folder_id union all select f.id from public.material_folders f join tree t on f.parent_id=t.id) select 1 from public.materials m where m.folder_id in(select id from tree) and m.created_by<>p_admin_id)
  then return jsonb_build_object('status','forbidden'); end if;
  insert into public.material_storage_cleanup_queue(admin_id,subject_kind,subject_id,storage_path)
  with recursive tree as (select id from public.material_folders where id=p_folder_id union all select f.id from public.material_folders f join tree t on f.parent_id=t.id)
  select distinct p_admin_id,'FOLDER',p_folder_id,m.storage_path from public.materials m
  where m.folder_id in(select id from tree) and m.type='FILE' and m.storage_path is not null on conflict do nothing;
  with recursive tree as (select id from public.material_folders where id=p_folder_id union all select f.id from public.material_folders f join tree t on f.parent_id=t.id)
  delete from public.materials where folder_id in(select id from tree);
  with recursive tree as (select id from public.material_folders where id=p_folder_id union all select f.id from public.material_folders f join tree t on f.parent_id=t.id)
  delete from public.material_folders where id in(select id from tree);
  select coalesce(array_agg(storage_path),array[]::text[]) into v_paths from public.material_storage_cleanup_queue
  where admin_id=p_admin_id and subject_kind='FOLDER' and subject_id=p_folder_id;
  return jsonb_build_object('status','deleted','storage_paths',to_jsonb(v_paths));
end; $$;

create function public.grant_material_folder_access_atomic(p_student_id uuid,p_folder_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','student_not_found'); end if;
  if not exists(select 1 from public.material_folders where id=p_folder_id and created_by=p_admin_id) then return jsonb_build_object('status','folder_not_found'); end if;
  if exists(with recursive ancestors as (select id,parent_id,created_by from public.material_folders where id=p_folder_id union all select f.id,f.parent_id,f.created_by from public.material_folders f join ancestors a on a.parent_id=f.id) select 1 from ancestors where created_by<>p_admin_id)
     or exists(with recursive tree as (select id,created_by from public.material_folders where id=p_folder_id union all select f.id,f.created_by from public.material_folders f join tree t on f.parent_id=t.id) select 1 from tree where created_by<>p_admin_id)
     or exists(with recursive tree as (select id from public.material_folders where id=p_folder_id union all select f.id from public.material_folders f join tree t on f.parent_id=t.id) select 1 from public.materials m where m.folder_id in(select id from tree) and m.created_by<>p_admin_id)
  then return jsonb_build_object('status','foreign_tree'); end if;
  if exists(with recursive ancestors as (select id,parent_id from public.material_folders where id=p_folder_id union all select f.id,f.parent_id from public.material_folders f join ancestors a on a.parent_id=f.id) select 1 from public.student_material_folder_access x where x.student_id=p_student_id and x.folder_id in(select id from ancestors)) then return jsonb_build_object('status','already_covered'); end if;
  insert into public.student_material_folder_access(student_id,folder_id,granted_by) values(p_student_id,p_folder_id,p_admin_id) on conflict do nothing;
  with recursive tree as (select id from public.material_folders where id=p_folder_id union all select f.id from public.material_folders f join tree t on f.parent_id=t.id)
  delete from public.student_material_folder_access where student_id=p_student_id and granted_by=p_admin_id and folder_id in(select id from tree where id<>p_folder_id);
  with recursive tree as (select id from public.material_folders where id=p_folder_id union all select f.id from public.material_folders f join tree t on f.parent_id=t.id)
  delete from public.student_material_access where student_id=p_student_id and granted_by=p_admin_id and material_id in(select id from public.materials where folder_id in(select id from tree));
  return jsonb_build_object('status','granted');
end; $$;

create function public.prepare_stale_test_import_cleanup(p_admin_id uuid)
returns table(test_id uuid,storage_prefix text) language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.test_import_sessions s set cleanup_pending=true
  where s.admin_id=p_admin_id and not s.cleanup_pending and s.created_at<clock_timestamp()-interval '24 hours'
    and exists(select 1 from public.tests t where t.id=s.test_id and t.created_by=p_admin_id and t.status='DRAFT')
    and not exists(select 1 from public.test_questions q where q.test_id=s.test_id)
    and not exists(select 1 from public.test_assignments a where a.source_test_id=s.test_id);
  delete from public.tests t using public.test_import_sessions s
  where s.test_id=t.id and s.admin_id=p_admin_id and s.cleanup_pending
    and t.created_by=p_admin_id and t.status='DRAFT'
    and not exists(select 1 from public.test_questions q where q.test_id=t.id)
    and not exists(select 1 from public.test_assignments a where a.source_test_id=t.id);
  return query select s.test_id,s.storage_prefix from public.test_import_sessions s where s.admin_id=p_admin_id and s.cleanup_pending;
end; $$;

create function public.prepare_expired_material_upload_cleanup(p_admin_id uuid)
returns table(material_id uuid,storage_path text) language sql security definer set search_path=pg_catalog,public,pg_temp as $$
  select s.material_id,s.storage_path from public.material_file_upload_sessions s
  where s.admin_id=p_admin_id and s.expires_at<=clock_timestamp()
    and not exists(select 1 from public.materials m where m.id=s.material_id);
$$;

create function public.begin_test_import_atomic(p_test_id uuid,p_admin_id uuid,p_folder_id uuid,p_title text,p_description text,p_storage_prefix text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_created_at timestamptz;
begin
  if not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  if p_folder_id is not null and not exists(select 1 from public.test_folders where id=p_folder_id and created_by=p_admin_id) then return jsonb_build_object('status','folder_not_found'); end if;
  if nullif(btrim(p_title),'') is null
     or p_storage_prefix !~ ('^tests/'||p_test_id::text||'/questions/import-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or p_storage_prefix like '%..%' then return jsonb_build_object('status','invalid'); end if;
  insert into public.tests(id,title,description,folder_id,status,created_by) values(p_test_id,btrim(p_title),nullif(btrim(p_description),''),p_folder_id,'DRAFT',p_admin_id) returning created_at into v_created_at;
  insert into public.test_import_sessions(test_id,admin_id,storage_prefix) values(p_test_id,p_admin_id,p_storage_prefix);
  return jsonb_build_object('status','created','created_at',v_created_at);
end; $$;

revoke all on function public.finalize_material_file_upload_atomic(uuid,uuid,text,text,bigint), public.delete_material_with_cleanup_atomic(uuid,uuid), public.delete_material_folder_with_cleanup_atomic(uuid,uuid), public.grant_material_folder_access_atomic(uuid,uuid,uuid), public.prepare_stale_test_import_cleanup(uuid), public.prepare_expired_material_upload_cleanup(uuid), public.begin_test_import_atomic(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finalize_material_file_upload_atomic(uuid,uuid,text,text,bigint), public.delete_material_with_cleanup_atomic(uuid,uuid), public.delete_material_folder_with_cleanup_atomic(uuid,uuid), public.grant_material_folder_access_atomic(uuid,uuid,uuid), public.prepare_stale_test_import_cleanup(uuid), public.prepare_expired_material_upload_cleanup(uuid), public.begin_test_import_atomic(uuid,uuid,uuid,text,text,text) to service_role;

commit;
