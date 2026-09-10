-- Phase 2 runtime for the system "Mistake Review" trainer.
-- Apply after 20260904-test-mistake-trainer-phase-1.sql.
begin;

create function public.bump_active_mistake_snapshot_version()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if old.status='ACTIVE'
     and new.status='ACTIVE'
     and new.current_question_snapshot is distinct from old.current_question_snapshot
     and new.activation_version=old.activation_version then
    new.activation_version:=old.activation_version+1;
  end if;
  return new;
end;
$$;
create trigger bump_active_mistake_snapshot_version
before update of status,current_question_snapshot,activation_version on public.student_mistakes
for each row execute function public.bump_active_mistake_snapshot_version();
revoke all on function public.bump_active_mistake_snapshot_version() from public,anon,authenticated,service_role;

create function public.project_student_mistake_question(p_question jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare v_type text:=p_question->>'type'; v_result jsonb;
begin
  v_result:=jsonb_build_object(
    'key',p_question->>'key','type',v_type,'prompt',coalesce(p_question->>'prompt',''),
    'imagePath',p_question->'imagePath','points',p_question->'points',
    'required',coalesce(p_question->'required','false'::jsonb),'position',p_question->'position'
  );
  if v_type in ('SINGLE_CHOICE','MULTIPLE_CHOICE','NUMERIC') then
    v_result:=v_result||jsonb_build_object('options',coalesce((select jsonb_agg(
      jsonb_build_object('key',o->>'key','text',o->>'text','position',o->'position') order by (o->>'position')::integer,o->>'key'
    ) from jsonb_array_elements(coalesce(p_question->'options','[]'::jsonb)) o),'[]'::jsonb));
  elsif v_type='MATCHING' then
    v_result:=v_result||jsonb_build_object('matching',jsonb_build_object(
      'allowOptionReuse',coalesce(p_question->'matching'->'allowOptionReuse','false'::jsonb),
      'leftItems',coalesce((select jsonb_agg(jsonb_build_object('key',i->>'key','label',i->>'label','text',i->>'text','position',i->'position') order by (i->>'position')::integer,i->>'key') from jsonb_array_elements(coalesce(p_question->'matching'->'leftItems','[]'::jsonb)) i),'[]'::jsonb),
      'options',coalesce((select jsonb_agg(jsonb_build_object('key',o->>'key','label',o->>'label','text',o->>'text','position',o->'position') order by (o->>'position')::integer,o->>'key') from jsonb_array_elements(coalesce(p_question->'matching'->'options','[]'::jsonb)) o),'[]'::jsonb)
    ));
  elsif v_type='MULTI_PART' then
    v_result:=v_result||jsonb_build_object('multiPart',jsonb_build_object('parts',coalesce((select jsonb_agg(
      jsonb_build_object('key',p->>'key','label',p->>'label','prompt',p->>'prompt','type',p->>'type','points',p->'points','position',p->'position','options',coalesce((select jsonb_agg(jsonb_build_object('key',o->>'key','text',o->>'text','position',o->'position') order by (o->>'position')::integer,o->>'key') from jsonb_array_elements(coalesce(p->'options','[]'::jsonb)) o),'[]'::jsonb)) order by (p->>'position')::integer,p->>'key'
    ) from jsonb_array_elements(coalesce(p_question->'multiPart'->'parts','[]'::jsonb)) p),'[]'::jsonb)));
  else
    raise exception using errcode='22023',message='MISTAKE_QUESTION_TYPE_INVALID';
  end if;
  return v_result;
end;
$$;
revoke all on function public.project_student_mistake_question(jsonb) from public,anon,authenticated,service_role;

create function public.load_student_mistake_trainer(p_student_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_mistake public.student_mistakes%rowtype; v_count integer;
begin
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT' and student_status='ACTIVE') then
    return jsonb_build_object('status','forbidden');
  end if;
  select count(*)::integer into v_count from public.student_mistakes where student_id=p_student_id and status='ACTIVE';
  select * into v_mistake from public.student_mistakes where student_id=p_student_id and status='ACTIVE' order by activation_sequence,id limit 1;
  if not found then return jsonb_build_object('status','empty','activeCount',v_count); end if;
  return jsonb_build_object('status','ready','activeCount',v_count,'mistake',jsonb_build_object(
    'id',v_mistake.id,'activationVersion',v_mistake.activation_version,
    'question',public.project_student_mistake_question(v_mistake.current_question_snapshot),
    'sourceTitle',v_mistake.latest_assignment_title_snapshot,'lastFailedAt',v_mistake.last_failed_at));
end;
$$;
revoke all on function public.load_student_mistake_trainer(uuid) from public,anon,authenticated;
grant execute on function public.load_student_mistake_trainer(uuid) to service_role;

create function public.grade_student_mistake_answer(p_question jsonb,p_answer jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare v_type text:=p_question->>'type'; v_part jsonb; v_base jsonb; v_item jsonb; v_key text; v_value numeric; v_selected text[]; v_expected text[]; v_valid boolean; v_correct boolean; v_matches jsonb; v_seen text[]:=array[]::text[];
begin
  if jsonb_typeof(p_answer)<>'object' then return false; end if;
  if v_type='SINGLE_CHOICE' and p_answer->>'type'='SINGLE_CHOICE' and jsonb_typeof(p_answer->'optionKey')='string' then
    return exists(select 1 from jsonb_array_elements(p_question->'options') o where o->>'key'=p_answer->>'optionKey' and coalesce((o->>'isCorrect')::boolean,false));
  elsif v_type='MULTIPLE_CHOICE' and p_answer->>'type'='MULTIPLE_CHOICE' and jsonb_typeof(p_answer->'optionKeys')='array' then
    select coalesce(array_agg(value order by value),array[]::text[]),count(*)=count(distinct value) into v_selected,v_valid from jsonb_array_elements_text(p_answer->'optionKeys');
    select coalesce(array_agg(o->>'key' order by o->>'key'),array[]::text[]) into v_expected from jsonb_array_elements(p_question->'options') o where coalesce((o->>'isCorrect')::boolean,false);
    return v_valid and cardinality(v_selected)>0 and not exists(select 1 from unnest(v_selected) k where not exists(select 1 from jsonb_array_elements(p_question->'options') o where o->>'key'=k)) and v_selected=v_expected;
  elsif v_type='NUMERIC' and p_answer->>'type'='NUMERIC' and jsonb_typeof(p_answer->'value')='number' then
    v_value:=(p_answer->>'value')::numeric;
    return case p_question->'numeric'->>'mode' when 'EXACT' then v_value=(p_question->'numeric'->>'exactValue')::numeric when 'TOLERANCE' then abs(v_value-(p_question->'numeric'->>'exactValue')::numeric)<=(p_question->'numeric'->>'tolerance')::numeric when 'RANGE' then v_value between (p_question->'numeric'->>'rangeMin')::numeric and (p_question->'numeric'->>'rangeMax')::numeric else false end;
  elsif v_type='MATCHING' and p_answer->>'type'='MATCHING' and jsonb_typeof(p_answer->'matches')='object' then
    v_matches:=p_answer->'matches';
    for v_item in select value from jsonb_array_elements(p_question->'matching'->'leftItems') loop
      if jsonb_typeof(v_matches->(v_item->>'key'))<>'string' then return false; end if;
      v_key:=v_matches->> (v_item->>'key');
      if v_key is distinct from v_item->>'correctOptionKey' or not exists(select 1 from jsonb_array_elements(p_question->'matching'->'options') o where o->>'key'=v_key) then return false; end if;
      if not coalesce((p_question->'matching'->>'allowOptionReuse')::boolean,false) and v_key=any(v_seen) then return false; end if;
      v_seen:=array_append(v_seen,v_key);
    end loop;
    return true;
  elsif v_type='MULTI_PART' and p_answer->>'type'='MULTI_PART' and jsonb_typeof(p_answer->'parts')='object' then
    for v_part in select value from jsonb_array_elements(p_question->'multiPart'->'parts') loop
      v_base:=p_answer->'parts'->(v_part->>'key'); v_correct:=false;
      if v_part->>'type'='SINGLE_CHOICE' and v_base->>'type'='SINGLE_CHOICE' and jsonb_typeof(v_base->'optionKey')='string' then
        v_correct:=exists(select 1 from jsonb_array_elements(v_part->'options') o where o->>'key'=v_base->>'optionKey' and coalesce((o->>'isCorrect')::boolean,false));
      elsif v_part->>'type'='MULTIPLE_CHOICE' and v_base->>'type'='MULTIPLE_CHOICE' and jsonb_typeof(v_base->'optionKeys')='array' then
        select coalesce(array_agg(value order by value),array[]::text[]),count(*)=count(distinct value) into v_selected,v_valid from jsonb_array_elements_text(v_base->'optionKeys');
        select coalesce(array_agg(o->>'key' order by o->>'key'),array[]::text[]) into v_expected from jsonb_array_elements(v_part->'options') o where coalesce((o->>'isCorrect')::boolean,false);
        v_correct:=v_valid and cardinality(v_selected)>0 and not exists(select 1 from unnest(v_selected) k where not exists(select 1 from jsonb_array_elements(v_part->'options') o where o->>'key'=k)) and v_selected=v_expected;
      elsif v_part->>'type'='NUMERIC' and v_base->>'type'='NUMERIC' and jsonb_typeof(v_base->'value')='number' then
        v_value:=(v_base->>'value')::numeric;
        v_correct:=case v_part->'numeric'->>'mode' when 'EXACT' then v_value=(v_part->'numeric'->>'exactValue')::numeric when 'TOLERANCE' then abs(v_value-(v_part->'numeric'->>'exactValue')::numeric)<=(v_part->'numeric'->>'tolerance')::numeric when 'RANGE' then v_value between (v_part->'numeric'->>'rangeMin')::numeric and (v_part->'numeric'->>'rangeMax')::numeric else false end;
      end if;
      if not v_correct then return false; end if;
    end loop;
    return true;
  end if;
  return false;
exception when others then return false;
end;
$$;
revoke all on function public.grade_student_mistake_answer(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.submit_student_mistake_answer_atomic(p_mistake_id uuid,p_activation_version integer,p_submitted_answer jsonb,p_request_id uuid,p_student_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_mistake public.student_mistakes%rowtype; v_previous public.student_mistake_correction_attempts%rowtype; v_correct boolean; v_count integer;
begin
  if p_request_id is null or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT' and student_status='ACTIVE') then return jsonb_build_object('status','forbidden'); end if;
  select * into v_mistake from public.student_mistakes where id=p_mistake_id and student_id=p_student_id for update;
  if not found then return jsonb_build_object('status','forbidden'); end if;
  select * into v_previous from public.student_mistake_correction_attempts where mistake_id=p_mistake_id and request_id=p_request_id;
  if found then
    if v_previous.activation_version<>p_activation_version
       or (v_previous.is_correct and (v_mistake.status<>'CORRECTED' or v_mistake.activation_version<>p_activation_version+1))
       or (not v_previous.is_correct and (v_mistake.status<>'ACTIVE' or v_mistake.activation_version<>p_activation_version)) then
      return jsonb_build_object('status','stale');
    end if;
    select count(*)::integer into v_count from public.student_mistakes where student_id=p_student_id and status='ACTIVE';
    return jsonb_build_object('status',case when v_previous.is_correct then 'correct' else 'wrong' end,'activeCount',v_count,'idempotent',true);
  end if;
  if v_mistake.status<>'ACTIVE' or v_mistake.activation_version<>p_activation_version then return jsonb_build_object('status','stale'); end if;
  if v_mistake.id is distinct from (select id from public.student_mistakes where student_id=p_student_id and status='ACTIVE' order by activation_sequence,id limit 1) then return jsonb_build_object('status','not_oldest'); end if;
  v_correct:=public.grade_student_mistake_answer(v_mistake.current_question_snapshot,p_submitted_answer);
  insert into public.student_mistake_correction_attempts(mistake_id,activation_version,submitted_answer,is_correct,request_id) values(p_mistake_id,p_activation_version,p_submitted_answer,v_correct,p_request_id);
  if v_correct then update public.student_mistakes set status='CORRECTED',corrected_at=clock_timestamp(),activation_version=activation_version+1,updated_at=now() where id=p_mistake_id; end if;
  select count(*)::integer into v_count from public.student_mistakes where student_id=p_student_id and status='ACTIVE';
  return jsonb_build_object('status',case when v_correct then 'correct' else 'wrong' end,'activeCount',v_count,'idempotent',false);
end;
$$;
revoke all on function public.submit_student_mistake_answer_atomic(uuid,integer,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_student_mistake_answer_atomic(uuid,integer,jsonb,uuid,uuid) to service_role;

create function public.remove_student_mistake_atomic(p_mistake_id uuid,p_student_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_mistake public.student_mistakes%rowtype; v_count integer;
begin
  if not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  select * into v_mistake from public.student_mistakes where id=p_mistake_id and student_id=p_student_id and owner_admin_id=p_admin_id for update;
  if not found then return jsonb_build_object('status','forbidden'); end if;
  if v_mistake.status<>'ACTIVE' then return jsonb_build_object('status','not_active'); end if;
  update public.student_mistakes set status='REMOVED_BY_ADMIN',removed_at=clock_timestamp(),removed_by=p_admin_id,activation_version=activation_version+1,updated_at=now() where id=p_mistake_id;
  select count(*)::integer into v_count from public.student_mistakes where student_id=p_student_id and owner_admin_id=p_admin_id and status='ACTIVE';
  return jsonb_build_object('status','removed','activeCount',v_count);
end;
$$;
revoke all on function public.remove_student_mistake_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_student_mistake_atomic(uuid,uuid,uuid) to service_role;

commit;
