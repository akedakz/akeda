begin;

create or replace function public.start_student_test_attempt_atomic(
  p_assignment_id uuid,
  p_student_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assignment public.test_assignments%rowtype;
  v_active_id uuid;
  v_attempt_id uuid;
  v_attempt_number integer;
  v_checked_at timestamptz;
begin
  select * into v_assignment
  from public.test_assignments
  where id = p_assignment_id and student_id = p_student_id
  for update;

  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select id into v_active_id
  from public.test_attempts
  where assignment_id = p_assignment_id
    and student_id = p_student_id
    and submitted_at is null;

  v_checked_at := clock_timestamp();
  if v_assignment.deadline_at is not null and v_assignment.deadline_at <= v_checked_at then
    return jsonb_build_object('status', 'deadline_passed');
  end if;
  if v_active_id is not null then
    return jsonb_build_object('status', 'active', 'attempt_id', v_active_id);
  end if;

  select coalesce(max(attempt_number), 0) + 1
  into v_attempt_number
  from public.test_attempts
  where assignment_id = p_assignment_id and student_id = p_student_id;

  if v_attempt_number > v_assignment.max_attempts then
    return jsonb_build_object('status', 'limit_reached');
  end if;

  insert into public.test_attempts(assignment_id, student_id, attempt_number)
  values(p_assignment_id, p_student_id, v_attempt_number)
  returning id into v_attempt_id;
  return jsonb_build_object('status', 'created', 'attempt_id', v_attempt_id);
end;
$$;

create or replace function public.submit_student_test_attempt_atomic(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_attempt public.test_attempts%rowtype; v_assignment public.test_assignments%rowtype;
  q jsonb; ans jsonb; item jsonb; part jsonb; base jsonb; option_value jsonb;
  v_points numeric; v_awarded numeric; v_score numeric:=0; v_max numeric:=0;
  v_correct integer:=0; v_incorrect integer:=0; v_unanswered integer:=0;
  v_filled boolean; v_matches boolean; v_valid boolean; v_value numeric;
  v_selected text[]; v_expected text[]; v_option_key text; v_occurrences integer;
begin
  select * into v_attempt from public.test_attempts where id=p_attempt_id for update;
  if not found then raise exception using errcode='P0001',message='TEST_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.submitted_at is not null then raise exception using errcode='P0001',message='TEST_ATTEMPT_ALREADY_SUBMITTED'; end if;
  select * into v_assignment from public.test_assignments where id=v_attempt.assignment_id and student_id=v_attempt.student_id for share;
  if not found then raise exception using errcode='P0001',message='TEST_ASSIGNMENT_OWNERSHIP_MISMATCH'; end if;
  if v_attempt.attempt_number<1 or v_attempt.attempt_number>v_assignment.max_attempts or (select count(*) from public.test_attempts a where a.assignment_id=v_assignment.id and a.student_id=v_attempt.student_id and a.submitted_at is not null)>=v_assignment.max_attempts then raise exception using errcode='P0001',message='TEST_ASSIGNMENT_ATTEMPT_LIMIT'; end if;
  if v_assignment.snapshot->>'version' is null or v_assignment.snapshot->>'version' not in ('1','2') or jsonb_typeof(v_assignment.snapshot->'questions') is distinct from 'array' then raise exception using errcode='P0001',message='TEST_ASSIGNMENT_INVALID_SNAPSHOT'; end if;

  for q in select value from jsonb_array_elements(v_assignment.snapshot->'questions') loop
    v_points:=greatest(coalesce((q->>'points')::numeric,0),0); v_max:=v_max+v_points; v_awarded:=0; v_filled:=false; v_matches:=false;
    select answer into ans from public.test_attempt_answers where attempt_id=p_attempt_id and question_key=q->>'key';
    if jsonb_typeof(ans)<>'object' then ans:=null; end if;

    if q->>'type'='MATCHING' and ans->>'type'='MATCHING' and jsonb_typeof(ans->'matches')='object' and jsonb_typeof(q->'matching'->'leftItems')='array' and jsonb_typeof(q->'matching'->'options')='array' then
      for item in select value from jsonb_array_elements(q->'matching'->'leftItems') loop
        option_value:=ans->'matches'->(item->>'key'); v_option_key:=case when jsonb_typeof(option_value)='string' then option_value#>>'{}' else null end;
        v_valid:=v_option_key is not null and exists(select 1 from jsonb_array_elements(q->'matching'->'options') o where o->>'key'=v_option_key);
        if v_valid and not coalesce((q->'matching'->>'allowOptionReuse')::boolean,false) then
          select count(*) into v_occurrences from jsonb_each(ans->'matches') e where jsonb_typeof(e.value)='string' and e.value#>>'{}'=v_option_key and exists(select 1 from jsonb_array_elements(q->'matching'->'leftItems') known where known->>'key'=e.key);
          v_valid:=v_occurrences=1;
        end if;
        if v_valid then v_filled:=true; if v_option_key=item->>'correctOptionKey' then v_awarded:=v_awarded+1; end if; end if;
      end loop;
      v_awarded:=least(v_awarded,v_points);

    elsif q->>'type'='MULTI_PART' and ans->>'type'='MULTI_PART' and jsonb_typeof(ans->'parts')='object' and jsonb_typeof(q->'multiPart'->'parts')='array' then
      for part in select value from jsonb_array_elements(q->'multiPart'->'parts') loop
        base:=ans->'parts'->(part->>'key'); v_valid:=false; v_matches:=false;
        if jsonb_typeof(base)='object' and part->>'type'='NUMERIC' and base->>'type'='NUMERIC' and jsonb_typeof(base->'value')='number' then
          v_valid:=true; v_value:=(base->>'value')::numeric;
          v_matches:=case part->'numeric'->>'mode' when 'EXACT' then v_value=(part->'numeric'->>'exactValue')::numeric when 'TOLERANCE' then abs(v_value-(part->'numeric'->>'exactValue')::numeric)<=(part->'numeric'->>'tolerance')::numeric when 'RANGE' then v_value between (part->'numeric'->>'rangeMin')::numeric and (part->'numeric'->>'rangeMax')::numeric else false end;
        elsif jsonb_typeof(base)='object' and part->>'type'='SINGLE_CHOICE' and base->>'type'='SINGLE_CHOICE' and jsonb_typeof(base->'optionKey')='string' then
          v_option_key:=base->>'optionKey'; v_valid:=exists(select 1 from jsonb_array_elements(part->'options') o where o->>'key'=v_option_key); v_matches:=v_valid and exists(select 1 from jsonb_array_elements(part->'options') o where o->>'key'=v_option_key and coalesce((o->>'isCorrect')::boolean,false));
        elsif jsonb_typeof(base)='object' and part->>'type'='MULTIPLE_CHOICE' and base->>'type'='MULTIPLE_CHOICE' and jsonb_typeof(base->'optionKeys')='array' then
          select coalesce(array_agg(value order by value),array[]::text[]),count(*)=count(distinct value) into v_selected,v_valid from jsonb_array_elements_text(base->'optionKeys');
          v_valid:=v_valid and not exists(select 1 from unnest(v_selected) selected_key where not exists(select 1 from jsonb_array_elements(part->'options') o where o->>'key'=selected_key));
          select coalesce(array_agg(o->>'key' order by o->>'key'),array[]::text[]) into v_expected from jsonb_array_elements(part->'options') o where coalesce((o->>'isCorrect')::boolean,false);
          v_valid:=v_valid and cardinality(v_selected)>0; v_matches:=v_valid and v_selected=v_expected;
        end if;
        if v_valid then v_filled:=true; if v_matches then v_awarded:=v_awarded+(part->>'points')::numeric; end if; end if;
      end loop;
      v_awarded:=least(v_awarded,v_points);

    elsif q->>'type'='SINGLE_CHOICE' and ans->>'type'='SINGLE_CHOICE' and jsonb_typeof(ans->'optionKey')='string' then
      v_option_key:=ans->>'optionKey'; v_filled:=exists(select 1 from jsonb_array_elements(q->'options') o where o->>'key'=v_option_key); v_matches:=v_filled and exists(select 1 from jsonb_array_elements(q->'options') o where o->>'key'=v_option_key and coalesce((o->>'isCorrect')::boolean,false)); if v_matches then v_awarded:=v_points; end if;
    elsif q->>'type'='MULTIPLE_CHOICE' and ans->>'type'='MULTIPLE_CHOICE' and jsonb_typeof(ans->'optionKeys')='array' then
      select coalesce(array_agg(value order by value),array[]::text[]),count(*)=count(distinct value) into v_selected,v_valid from jsonb_array_elements_text(ans->'optionKeys');
      v_valid:=v_valid and not exists(select 1 from unnest(v_selected) selected_key where not exists(select 1 from jsonb_array_elements(q->'options') o where o->>'key'=selected_key));
      select coalesce(array_agg(o->>'key' order by o->>'key'),array[]::text[]) into v_expected from jsonb_array_elements(q->'options') o where coalesce((o->>'isCorrect')::boolean,false); v_filled:=v_valid and cardinality(v_selected)>0; v_matches:=v_filled and v_selected=v_expected; if v_matches then v_awarded:=v_points; end if;
    elsif q->>'type'='NUMERIC' and ans->>'type'='NUMERIC' and jsonb_typeof(ans->'value')='number' then
      v_filled:=true; v_value:=(ans->>'value')::numeric; v_matches:=case q->'numeric'->>'mode' when 'EXACT' then v_value=(q->'numeric'->>'exactValue')::numeric when 'TOLERANCE' then abs(v_value-(q->'numeric'->>'exactValue')::numeric)<=(q->'numeric'->>'tolerance')::numeric when 'RANGE' then v_value between (q->'numeric'->>'rangeMin')::numeric and (q->'numeric'->>'rangeMax')::numeric else false end; if v_matches then v_awarded:=v_points; end if;
    end if;

    v_matches:=v_awarded=v_points and v_points>0; v_score:=v_score+v_awarded;
    if not v_filled then v_unanswered:=v_unanswered+1; elsif v_matches then v_correct:=v_correct+1; else v_incorrect:=v_incorrect+1; end if;
    update public.test_attempt_answers set is_correct=v_matches,points_awarded=v_awarded,updated_at=now() where attempt_id=p_attempt_id and question_key=q->>'key';
  end loop;
  update public.test_attempts set submitted_at=now(),score=v_score,max_score=v_max,correct_count=v_correct,incorrect_count=v_incorrect,unanswered_count=v_unanswered,updated_at=now() where id=p_attempt_id and submitted_at is null;
  if not found then raise exception using errcode='P0001',message='TEST_ATTEMPT_ALREADY_SUBMITTED'; end if;
  return jsonb_build_object('attemptId',p_attempt_id,'assignmentId',v_assignment.id,'score',v_score,'maxScore',v_max,'correct',v_correct,'incorrect',v_incorrect,'unanswered',v_unanswered);
end;
$$;

create or replace function public.save_student_test_answer_if_in_progress(
  p_attempt_id uuid,
  p_question_key text,
  p_answer jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_assignment public.test_assignments%rowtype;
  v_checked_at timestamptz;
begin
  select * into v_attempt from public.test_attempts where id = p_attempt_id for update;
  if not found then raise exception using errcode='P0001',message='TEST_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.submitted_at is not null then return false; end if;

  select * into v_assignment
  from public.test_assignments
  where id = v_attempt.assignment_id and student_id = v_attempt.student_id
  for share;
  if not found then raise exception using errcode='P0001',message='TEST_ASSIGNMENT_OWNERSHIP_MISMATCH'; end if;

  v_checked_at := clock_timestamp();
  if v_assignment.deadline_at is not null and v_assignment.deadline_at <= v_checked_at then
    perform public.submit_student_test_attempt_atomic(p_attempt_id);
    return false;
  end if;

  insert into public.test_attempt_answers(attempt_id,question_key,answer,is_correct,points_awarded,updated_at)
  values(p_attempt_id,p_question_key,p_answer,null,null,now())
  on conflict(attempt_id,question_key) do update
  set answer=excluded.answer,is_correct=null,points_awarded=null,updated_at=now();
  return true;
end;
$$;

create or replace function public.finalize_student_test_attempt_if_expired(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_attempt public.test_attempts%rowtype; v_deadline timestamptz; v_checked_at timestamptz; v_result jsonb;
begin
  select * into v_attempt from public.test_attempts where id=p_attempt_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_attempt.submitted_at is not null then return jsonb_build_object('status','already_submitted'); end if;
  select deadline_at into v_deadline from public.test_assignments where id=v_attempt.assignment_id and student_id=v_attempt.student_id for share;
  if not found then return jsonb_build_object('status','not_found'); end if;
  v_checked_at:=clock_timestamp();
  if v_deadline is null then return jsonb_build_object('status','too_early'); end if;
  if v_deadline>v_checked_at then return jsonb_build_object('status','too_early','retry_after_ms',ceil(extract(epoch from (v_deadline-v_checked_at))*1000)); end if;
  v_result:=public.submit_student_test_attempt_atomic(p_attempt_id);
  return jsonb_build_object('status','finalized','result',v_result);
end;
$$;

revoke all on function public.start_student_test_attempt_atomic(uuid,uuid) from public,anon,authenticated;
revoke all on function public.submit_student_test_attempt_atomic(uuid) from public,anon,authenticated;
revoke all on function public.save_student_test_answer_if_in_progress(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.finalize_student_test_attempt_if_expired(uuid) from public,anon,authenticated;
grant execute on function public.start_student_test_attempt_atomic(uuid,uuid) to service_role;
grant execute on function public.submit_student_test_attempt_atomic(uuid) to service_role;
grant execute on function public.save_student_test_answer_if_in_progress(uuid,text,jsonb) to service_role;
grant execute on function public.finalize_student_test_attempt_if_expired(uuid) to service_role;

commit;
