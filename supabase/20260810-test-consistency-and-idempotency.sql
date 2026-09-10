-- Apply after 20260810-auto-finalize-expired-test-attempts.sql.
begin;

alter table public.test_attempt_answers
  add column if not exists answer_revision bigint not null default 0;

alter table public.test_assignments
  add column if not exists idempotency_key uuid;

create unique index if not exists test_assignments_creation_idempotency
  on public.test_assignments(assigned_by, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.test_assignment_creation_operations (
  assigned_by uuid not null,
  idempotency_key uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (assigned_by, idempotency_key)
);
alter table public.test_assignment_creation_operations enable row level security;
revoke all on table public.test_assignment_creation_operations from public, anon, authenticated;
grant select, insert, update on table public.test_assignment_creation_operations to service_role;

create or replace function public.save_student_test_answer_if_in_progress(
  p_attempt_id uuid, p_question_key text, p_answer jsonb, p_revision bigint
) returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_attempt public.test_attempts%rowtype; v_assignment public.test_assignments%rowtype; v_checked_at timestamptz;
begin
  if p_revision < 1 then raise exception using errcode='22023',message='INVALID_ANSWER_REVISION'; end if;
  select * into v_attempt from public.test_attempts where id=p_attempt_id for update;
  if not found then raise exception using errcode='P0001',message='TEST_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.submitted_at is not null then return false; end if;
  select * into v_assignment from public.test_assignments where id=v_attempt.assignment_id and student_id=v_attempt.student_id for share;
  if not found then raise exception using errcode='P0001',message='TEST_ASSIGNMENT_OWNERSHIP_MISMATCH'; end if;
  v_checked_at:=clock_timestamp();
  if v_assignment.deadline_at is not null and v_assignment.deadline_at<=v_checked_at then
    perform public.submit_student_test_attempt_atomic(p_attempt_id);
    return false;
  end if;
  insert into public.test_attempt_answers(attempt_id,question_key,answer,is_correct,points_awarded,updated_at,answer_revision)
  values(p_attempt_id,p_question_key,p_answer,null,null,now(),p_revision)
  on conflict(attempt_id,question_key) do update
    set answer=excluded.answer,is_correct=null,points_awarded=null,updated_at=now(),answer_revision=excluded.answer_revision
    where public.test_attempt_answers.answer_revision < excluded.answer_revision;
  return true;
end;
$$;

revoke all on function public.save_student_test_answer_if_in_progress(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.save_student_test_answer_if_in_progress(uuid,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.save_student_test_answer_if_in_progress(uuid,text,jsonb,bigint) to service_role;

alter function public.create_composite_test_assignment_atomic(uuid,uuid[],text,integer,text,boolean,timestamptz,boolean,uuid)
  rename to create_composite_test_assignment_atomic_unkeyed;
revoke all on function public.create_composite_test_assignment_atomic_unkeyed(uuid,uuid[],text,integer,text,boolean,timestamptz,boolean,uuid) from public,anon,authenticated,service_role;

create function public.create_composite_test_assignment_atomic(
  p_student_id uuid, p_source_test_ids uuid[], p_title text, p_question_count integer,
  p_sampling_mode text, p_shuffle_questions boolean, p_deadline_at timestamptz,
  p_show_correct_answers_after_close boolean, p_assigned_by uuid, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if p_idempotency_key is null then raise exception using errcode='22023',message='IDEMPOTENCY_KEY_REQUIRED'; end if;
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

revoke all on function public.create_composite_test_assignment_atomic(uuid,uuid[],text,integer,text,boolean,timestamptz,boolean,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_composite_test_assignment_atomic(uuid,uuid[],text,integer,text,boolean,timestamptz,boolean,uuid,uuid) to service_role;

commit;
