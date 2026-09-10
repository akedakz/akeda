begin;

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
    select id,0 as depth from public.test_folders where id=p_folder_id and created_by=p_created_by
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

commit;
