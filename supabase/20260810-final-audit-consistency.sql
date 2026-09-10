begin;

create or replace function public.replace_student_schedule_and_lessons_atomic(
  p_student_id uuid,
  p_created_by uuid,
  p_effective_from date,
  p_slots jsonb,
  p_generate_through date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
  v_checked_at timestamptz;
begin
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT')
     or not exists (select 1 from public.profiles where id = p_created_by and role = 'ADMIN') then
    raise exception 'invalid schedule owner';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or p_generate_through < p_effective_from then
    raise exception 'invalid schedule payload';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slots) slot
    where jsonb_typeof(slot) <> 'object'
       or (slot->>'weekday') !~ '^[1-7]$'
       or (slot->>'startTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (slot->>'durationMinutes') !~ '^[0-9]+$'
       or (slot->>'durationMinutes')::integer not between 15 and 300
  ) then raise exception 'invalid schedule slot'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 7107));
  v_checked_at := clock_timestamp();

  delete from public.student_lessons lesson
  where lesson.student_id = p_student_id
    and lesson.starts_at > v_checked_at
    and lesson.status_override is null
    and not exists (select 1 from public.lesson_homework_records homework where homework.lesson_id = lesson.id);

  delete from public.student_schedule_slots
  where student_id = p_student_id and valid_until is null and valid_from >= p_effective_from;
  update public.student_schedule_slots
  set valid_until = p_effective_from - 1, updated_at = statement_timestamp()
  where student_id = p_student_id and valid_until is null;

  for item in select value from jsonb_array_elements(p_slots) loop
    insert into public.student_schedule_slots(student_id, weekday, start_time, duration_minutes, valid_from, created_by)
    values (p_student_id, (item->>'weekday')::smallint, (item->>'startTime')::time, (item->>'durationMinutes')::integer, p_effective_from, p_created_by);
  end loop;

  insert into public.student_lessons(student_id, schedule_slot_id, starts_at, ends_at)
  select p_student_id, slot.id, generated.starts_at, generated.starts_at + make_interval(mins => slot.duration_minutes)
  from public.student_schedule_slots slot
  cross join lateral (
    select ((bounds.start_date + gs.day_offset + slot.start_time) at time zone 'Asia/Almaty') as starts_at
    from (select greatest(p_effective_from, (v_checked_at at time zone 'Asia/Almaty')::date) as start_date) bounds
    cross join generate_series(0, p_generate_through - bounds.start_date) as gs(day_offset)
    where extract(isodow from bounds.start_date + gs.day_offset)::smallint = slot.weekday
  ) generated
  where slot.student_id = p_student_id
    and slot.valid_until is null
    and generated.starts_at > v_checked_at
  on conflict (student_id, starts_at) do nothing;
end;
$$;
revoke all on function public.replace_student_schedule_and_lessons_atomic(uuid, uuid, date, jsonb, date) from public, anon, authenticated;
grant execute on function public.replace_student_schedule_and_lessons_atomic(uuid, uuid, date, jsonb, date) to service_role;

create or replace function public.create_support_message_rate_limited(p_student_id uuid, p_category text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_checked_at timestamptz;
begin
  if p_category not in ('PAGE','MATERIAL','TEST','DATA','OTHER') or length(btrim(p_message)) not between 10 and 2000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT' and student_status = 'ACTIVE') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text, 7116));
  v_checked_at := clock_timestamp();
  if exists (select 1 from public.support_messages where student_id = p_student_id and created_at >= v_checked_at - interval '30 seconds') then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  insert into public.support_messages(student_id, category, message, created_at) values (p_student_id, p_category, btrim(p_message), v_checked_at);
  return jsonb_build_object('status', 'created');
end;
$$;
revoke all on function public.create_support_message_rate_limited(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_support_message_rate_limited(uuid, text, text) to service_role;

create or replace function public.get_student_material_library(p_student_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive
  granted_tree(id, owner_id) as (
    select folder.id, access.granted_by
    from public.student_material_folder_access access
    join public.material_folders folder
      on folder.id = access.folder_id
     and folder.created_by = access.granted_by
    where access.student_id = p_student_id
    union
    select folder.id, tree.owner_id
    from public.material_folders folder
    join granted_tree tree
      on folder.parent_id = tree.id
     and folder.created_by = tree.owner_id
  ),
  visible_materials as (
    select material.*
    from public.materials material
    join granted_tree tree
      on tree.id = material.folder_id
     and tree.owner_id = material.created_by
    union
    select material.*
    from public.student_material_access access
    join public.materials material
      on material.id = access.material_id
     and material.created_by = access.granted_by
    where access.student_id = p_student_id
  ),
  visible_folder_seeds(id, owner_id) as (
    select id, owner_id from granted_tree
    union
    select folder.id, material.created_by
    from visible_materials material
    join public.material_folders folder
      on folder.id = material.folder_id
     and folder.created_by = material.created_by
  ),
  visible_folders(id, owner_id) as (
    select seed.id, seed.owner_id
    from visible_folder_seeds seed
    union
    select folder.parent_id, visible.owner_id
    from public.material_folders folder
    join visible_folders visible
      on folder.id = visible.id
     and folder.created_by = visible.owner_id
    join public.material_folders parent
      on parent.id = folder.parent_id
     and parent.created_by = visible.owner_id
    where folder.parent_id is not null
  )
  select jsonb_build_object(
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', folder.id, 'parent_id', folder.parent_id, 'name', folder.name) order by folder.name, folder.id) from public.material_folders folder where folder.id in (select id from visible_folders)), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(jsonb_build_object('id', material.id, 'folder_id', material.folder_id, 'type', material.type, 'title', material.title, 'description', material.description, 'storage_path', material.storage_path, 'original_file_name', material.original_file_name, 'mime_type', material.mime_type, 'file_size', material.file_size, 'external_url', material.external_url, 'created_at', material.created_at) order by material.title, material.id) from visible_materials material), '[]'::jsonb),
    'pins', coalesce((select jsonb_agg(pin.material_item_id) from public.student_material_pins pin where pin.student_id = p_student_id and pin.material_item_id in (select id from visible_materials)), '[]'::jsonb)
  );
$$;
revoke all on function public.get_student_material_library(uuid) from public, anon, authenticated;
grant execute on function public.get_student_material_library(uuid) to service_role;

commit;
