begin;

create or replace function public.move_material_folder_safe(p_folder_id uuid, p_parent_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not exists (select 1 from public.material_folders where id = p_folder_id) then return jsonb_build_object('status','not_found'); end if;
  if p_parent_id is not null and not exists (select 1 from public.material_folders where id = p_parent_id) then return jsonb_build_object('status','not_found'); end if;
  if p_parent_id = p_folder_id or exists (
    with recursive descendants as (
      select id from public.material_folders where parent_id = p_folder_id
      union all select f.id from public.material_folders f join descendants d on f.parent_id = d.id
    ) select 1 from descendants where id = p_parent_id
  ) then return jsonb_build_object('status','cycle'); end if;
  update public.material_folders set parent_id = p_parent_id where id = p_folder_id;
  return jsonb_build_object('status','moved');
end; $$;

create or replace function public.inspect_material_folder_deletion(p_folder_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  with recursive tree as (
    select id from public.material_folders where id = p_folder_id
    union all select f.id from public.material_folders f join tree t on f.parent_id = t.id
  ) select case when not exists(select 1 from tree) then jsonb_build_object('status','not_found') else jsonb_build_object(
    'status','ready', 'descendant_folders',(select count(*) - 1 from tree), 'materials',(select count(*) from public.materials where folder_id in (select id from tree))
  ) end;
$$;

create or replace function public.delete_material_folder_atomic(p_folder_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_paths text[];
begin
  perform 1 from public.material_folders where id = p_folder_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  with recursive tree as (
    select id from public.material_folders where id = p_folder_id
    union all select f.id from public.material_folders f join tree t on f.parent_id = t.id
  ) select coalesce(array_agg(distinct storage_path), array[]::text[]) into v_paths from public.materials where folder_id in (select id from tree) and type = 'FILE' and storage_path is not null;
  with recursive tree as (
    select id from public.material_folders where id = p_folder_id
    union all select f.id from public.material_folders f join tree t on f.parent_id = t.id
  ) delete from public.materials where folder_id in (select id from tree);
  with recursive tree as (
    select id from public.material_folders where id = p_folder_id
    union all select f.id from public.material_folders f join tree t on f.parent_id = t.id
  ) delete from public.material_folders where id in (select id from tree);
  return jsonb_build_object('status','deleted','storage_paths',to_jsonb(v_paths));
end; $$;

revoke all on function public.move_material_folder_safe(uuid,uuid), public.inspect_material_folder_deletion(uuid), public.delete_material_folder_atomic(uuid) from public, anon, authenticated;
grant execute on function public.move_material_folder_safe(uuid,uuid), public.inspect_material_folder_deletion(uuid), public.delete_material_folder_atomic(uuid) to service_role;

commit;
