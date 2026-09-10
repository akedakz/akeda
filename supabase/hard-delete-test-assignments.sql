begin;

create or replace function public.delete_test_assignment_safe(
  p_assignment_id uuid,
  p_student_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_assignment public.test_assignments%rowtype;
  v_is_copy boolean := false;
  v_paths text[] := array[]::text[];
begin
  select * into v_assignment
  from public.test_assignments
  where id = p_assignment_id and student_id = p_student_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select coalesce(is_assignment_copy, false) into v_is_copy
  from public.tests
  where id = v_assignment.source_test_id;

  delete from public.test_attempt_answers
  where attempt_id in (
    select id from public.test_attempts
    where assignment_id = p_assignment_id and student_id = p_student_id
  );

  delete from public.test_attempts
  where assignment_id = p_assignment_id and student_id = p_student_id;

  delete from public.test_assignments
  where id = p_assignment_id and student_id = p_student_id;

  if v_is_copy then
    create temporary table deleted_assignment_copy_paths(
      path text primary key
    ) on commit drop;

    insert into deleted_assignment_copy_paths
    select distinct image_path
    from public.test_questions
    where test_id = v_assignment.source_test_id and image_path is not null;

    delete from public.test_question_options
    where question_id in (
      select id from public.test_questions
      where test_id = v_assignment.source_test_id
    );

    delete from public.test_questions
    where test_id = v_assignment.source_test_id;

    delete from public.tests
    where id = v_assignment.source_test_id and is_assignment_copy = true;

    select coalesce(array_agg(path), array[]::text[]) into v_paths
    from deleted_assignment_copy_paths candidate
    where not exists (
      select 1 from public.test_questions remaining
      where remaining.image_path = candidate.path
    );
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'image_paths', to_jsonb(v_paths)
  );
end;
$$;

revoke all on function public.delete_test_assignment_safe(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.delete_test_assignment_safe(uuid, uuid)
to service_role;

commit;
