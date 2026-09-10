begin;

create or replace function public.move_test_folder_safe(p_folder_id uuid, p_parent_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not exists (select 1 from public.test_folders where id = p_folder_id) then return jsonb_build_object('status', 'not_found'); end if;
  if p_parent_id is not null and not exists (select 1 from public.test_folders where id = p_parent_id) then return jsonb_build_object('status', 'not_found'); end if;
  if p_parent_id = p_folder_id or exists (
    with recursive descendants as (
      select id from public.test_folders where parent_id = p_folder_id
      union all select f.id from public.test_folders f join descendants d on f.parent_id = d.id
    ) select 1 from descendants where id = p_parent_id
  ) then return jsonb_build_object('status', 'cycle'); end if;
  update public.test_folders set parent_id = p_parent_id where id = p_folder_id;
  return jsonb_build_object('status', 'moved');
end; $$;

create or replace function public.inspect_test_folder_deletion(p_folder_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_folder_count integer; v_test_count integer; v_blockers jsonb;
begin
  if not exists (select 1 from public.test_folders where id = p_folder_id) then return jsonb_build_object('status', 'not_found'); end if;
  with recursive tree as (
    select id from public.test_folders where id = p_folder_id
    union all select f.id from public.test_folders f join tree t on f.parent_id = t.id
  ), affected_tests as (select id, title from public.tests where folder_id in (select id from tree))
  select (select count(*) - 1 from tree), (select count(*) from affected_tests), coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'reasons', array_remove(array[
      case when exists(select 1 from public.test_assignments x where x.source_test_id = a.id) then 'назначения' end,
      case when exists(select 1 from public.test_attempts ta join public.test_assignments x on x.id = ta.assignment_id where x.source_test_id = a.id) then 'попытки или результаты' end,
      case when exists(select 1 from public.test_questions q where q.test_id = a.id and q.image_path is not null) then 'изображения в Storage (атомарное удаление вместе с базой недоступно)' end
    ], null)
  )) filter (where exists(select 1 from public.test_assignments x where x.source_test_id = a.id) or exists(select 1 from public.test_questions q where q.test_id = a.id and q.image_path is not null)), '[]'::jsonb)
  into v_folder_count, v_test_count, v_blockers from affected_tests a;
  return jsonb_build_object('status', case when jsonb_array_length(v_blockers) > 0 then 'blocked' else 'ready' end, 'descendant_folders', v_folder_count, 'tests', v_test_count, 'blockers', v_blockers);
end; $$;

create or replace function public.delete_test_folder_atomic(p_folder_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_check jsonb; v_test_ids uuid[]; v_image_paths text[];
begin
  perform 1 from public.test_folders where id = p_folder_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_check := public.inspect_test_folder_deletion(p_folder_id);
  if v_check->>'status' = 'blocked' then return v_check; end if;
  with recursive tree as (
    select id from public.test_folders where id = p_folder_id
    union all select f.id from public.test_folders f join tree t on f.parent_id = t.id
  ) select coalesce(array_agg(id), array[]::uuid[]) into v_test_ids from public.tests where folder_id in (select id from tree);
  select coalesce(array_agg(distinct image_path), array[]::text[]) into v_image_paths from public.test_questions where test_id = any(v_test_ids) and image_path is not null;
  delete from public.test_question_options where question_id in (select id from public.test_questions where test_id = any(v_test_ids));
  delete from public.test_questions where test_id = any(v_test_ids);
  delete from public.tests where id = any(v_test_ids);
  with recursive tree as (
    select id, 0 depth from public.test_folders where id = p_folder_id
    union all select f.id, t.depth + 1 from public.test_folders f join tree t on f.parent_id = t.id
  ) delete from public.test_folders where id in (select id from tree order by depth desc);
  return jsonb_build_object('status', 'deleted', 'image_paths', to_jsonb(v_image_paths));
end; $$;

revoke all on function public.move_test_folder_safe(uuid, uuid), public.inspect_test_folder_deletion(uuid), public.delete_test_folder_atomic(uuid) from public, anon, authenticated;
grant execute on function public.move_test_folder_safe(uuid, uuid), public.inspect_test_folder_deletion(uuid), public.delete_test_folder_atomic(uuid) to service_role;

commit;
