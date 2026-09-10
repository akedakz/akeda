begin;

create or replace function public.delete_unassigned_test_atomic(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_test_id uuid;
  v_image_paths text[];
begin
  select id into v_test_id
  from public.tests
  where id = p_test_id
  for update;

  if v_test_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if exists (select 1 from public.test_assignments where source_test_id = p_test_id)
     or exists (
       select 1
       from public.test_attempts attempt
       join public.test_assignments assignment on assignment.id = attempt.assignment_id
       where assignment.source_test_id = p_test_id
     ) then
    return jsonb_build_object('status', 'assigned');
  end if;

  select coalesce(array_agg(distinct image_path), array[]::text[])
  into v_image_paths
  from public.test_questions
  where test_id = p_test_id and image_path is not null;

  delete from public.test_question_options
  where question_id in (select id from public.test_questions where test_id = p_test_id);
  delete from public.test_questions where test_id = p_test_id;
  delete from public.tests where id = p_test_id;

  return jsonb_build_object('status', 'deleted', 'image_paths', to_jsonb(v_image_paths));
end;
$$;

revoke all on function public.delete_unassigned_test_atomic(uuid) from public, anon, authenticated;
grant execute on function public.delete_unassigned_test_atomic(uuid) to service_role;

commit;
