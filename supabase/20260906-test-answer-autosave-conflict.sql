-- Apply manually after the current 20260904 migrations, before the app update.
-- Preserve legacy RPCs and grants during rollout; retire them in a separate
-- cleanup migration only after deployment and runtime QA.
-- Grading and deadline finalization remain in the existing canonical function.
begin;

create function public.save_student_test_answer_checked(
  p_attempt_id uuid, p_question_key text, p_answer jsonb, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_assignment public.test_assignments%rowtype;
  v_answer public.test_attempt_answers%rowtype;
  v_revision bigint;
begin
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991 then
    raise exception using errcode='22023',message='INVALID_ANSWER_REVISION';
  end if;
  select * into v_attempt from public.test_attempts where id=p_attempt_id for update;
  if not found then raise exception using errcode='P0001',message='TEST_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.submitted_at is not null then return jsonb_build_object('status','closed'); end if;
  select * into v_assignment from public.test_assignments where id=v_attempt.assignment_id and student_id=v_attempt.student_id for share;
  if not found then raise exception using errcode='P0001',message='TEST_ASSIGNMENT_OWNERSHIP_MISMATCH'; end if;
  if v_assignment.deadline_at is not null and v_assignment.deadline_at<=clock_timestamp() then
    perform public.submit_student_test_attempt_atomic(p_attempt_id);
    return jsonb_build_object('status','closed');
  end if;
  select * into v_answer from public.test_attempt_answers where attempt_id=p_attempt_id and question_key=p_question_key;
  v_revision:=coalesce(v_answer.answer_revision,0);
  if found and v_answer.answer=p_answer then
    return jsonb_build_object('status','already_current','current_revision',v_revision);
  end if;
  if v_revision<>p_expected_revision then
    return jsonb_build_object('status','conflict','current_revision',v_revision);
  end if;
  insert into public.test_attempt_answers(attempt_id,question_key,answer,is_correct,points_awarded,updated_at,answer_revision)
  values(p_attempt_id,p_question_key,p_answer,null,null,now(),v_revision+1)
  on conflict(attempt_id,question_key) do update
    set answer=excluded.answer,is_correct=null,points_awarded=null,updated_at=now(),answer_revision=excluded.answer_revision;
  return jsonb_build_object('status','saved','current_revision',v_revision+1);
end;
$$;

-- Close the gap between client flush and grading. Autosave and canonical submit
-- already lock the attempt first: no other save can slip past this comparison.
create function public.submit_student_test_attempt_checked(p_attempt_id uuid,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_attempt public.test_attempts%rowtype; v_answers jsonb; v_result jsonb;
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception using errcode='22023',message='INVALID_SUBMIT_ANSWERS';
  end if;
  select * into v_attempt from public.test_attempts where id=p_attempt_id for update;
  if not found then raise exception using errcode='P0001',message='TEST_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.submitted_at is not null then return jsonb_build_object('status','already_submitted'); end if;
  select coalesce(jsonb_object_agg(question_key,answer),'{}'::jsonb) into v_answers
  from public.test_attempt_answers where attempt_id=p_attempt_id;
  if v_answers is distinct from p_answers then return jsonb_build_object('status','conflict'); end if;
  v_result:=public.submit_student_test_attempt_atomic(p_attempt_id);
  return jsonb_build_object('status','submitted','result',v_result);
end;
$$;

-- Restrict only the new RPCs. Legacy production callers remain callable.
revoke all on function public.save_student_test_answer_checked(uuid,text,jsonb,bigint),
  public.submit_student_test_attempt_checked(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_student_test_answer_checked(uuid,text,jsonb,bigint),
  public.submit_student_test_attempt_checked(uuid,jsonb) to service_role;

commit;
