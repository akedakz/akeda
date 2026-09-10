-- Additive only. Apply manually after 20260810-test-consistency-and-idempotency.sql.
begin;

create or replace function public.create_single_attempt_test_assignment_atomic(
  p_student_id uuid,
  p_source_test_id uuid,
  p_title text,
  p_snapshot jsonb,
  p_deadline_at timestamptz,
  p_show_correct_answers_after_close boolean,
  p_assigned_by uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assignment_id uuid;
begin
  if p_idempotency_key is null
     or nullif(btrim(p_title), '') is null
     or char_length(btrim(p_title)) > 240
     or jsonb_typeof(p_snapshot) is distinct from 'object'
     or coalesce(p_snapshot->>'version', '') not in ('1', '2')
     or jsonb_typeof(p_snapshot->'questions') is distinct from 'array' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select id into v_assignment_id
  from public.test_assignments
  where assigned_by = p_assigned_by and idempotency_key = p_idempotency_key;
  if v_assignment_id is not null then
    return jsonb_build_object('status', 'already_created', 'assignment_id', v_assignment_id);
  end if;

  if not exists(select 1 from public.profiles where id = p_assigned_by and role = 'ADMIN')
     or not exists(select 1 from public.profiles where id = p_student_id and role = 'STUDENT')
     or not exists(
       select 1 from public.tests
       where id = p_source_test_id
         and created_by = p_assigned_by
         and status = 'PUBLISHED'
         and is_assignment_copy = false
     ) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- Serialize assignment creation for this student/source pair. This protects
  -- against double submit and concurrent browser tabs without rewriting history.
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':' || p_source_test_id::text, 0));

  select id into v_assignment_id
  from public.test_assignments
  where assigned_by = p_assigned_by and idempotency_key = p_idempotency_key;
  if v_assignment_id is not null then
    return jsonb_build_object('status', 'already_created', 'assignment_id', v_assignment_id);
  end if;

  if exists(
    select 1
    from public.test_assignments assignment
    where assignment.student_id = p_student_id
      and assignment.source_test_id = p_source_test_id
      and (
        not exists(
          select 1 from public.test_attempts attempt
          where attempt.assignment_id = assignment.id and attempt.submitted_at is not null
        )
        or exists(
          select 1 from public.test_attempts attempt
          where attempt.assignment_id = assignment.id and attempt.submitted_at is null
        )
      )
  ) then
    return jsonb_build_object('status', 'active_exists');
  end if;

  insert into public.test_assignments(
    student_id, source_test_id, title, snapshot, deadline_at, max_attempts,
    show_correct_answers_after_close, assigned_by, idempotency_key
  ) values (
    p_student_id, p_source_test_id, btrim(p_title), p_snapshot, p_deadline_at, 1,
    coalesce(p_show_correct_answers_after_close, false), p_assigned_by, p_idempotency_key
  ) returning id into v_assignment_id;

  return jsonb_build_object('status', 'created', 'assignment_id', v_assignment_id);
end;
$$;

revoke all on function public.create_single_attempt_test_assignment_atomic(uuid,uuid,text,jsonb,timestamptz,boolean,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.create_single_attempt_test_assignment_atomic(uuid,uuid,text,jsonb,timestamptz,boolean,uuid,uuid)
  to service_role;

commit;
