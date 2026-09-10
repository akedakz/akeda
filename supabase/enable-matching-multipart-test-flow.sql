-- Run only after add-matching-multipart-question-types.sql.
begin;

create or replace function public.save_test_editor(
  p_test_id uuid,
  p_title text,
  p_description text,
  p_questions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  q jsonb; o jsonb; l jsonb; p jsonb;
  v_question_id uuid; v_option_id uuid;
  v_type text; v_config jsonb; v_normalized_config jsonb; v_parts jsonb; v_part jsonb;
  v_points numeric; v_correct integer; v_count integer;
  v_keys text[]; v_positions integer[]; v_left_keys text[]; v_option_keys text[]; v_option_positions integer[]; v_correct_keys text[];
  v_result jsonb;
begin
  if nullif(btrim(p_title), '') is null or jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'INVALID_TEST_EDITOR_INPUT';
  end if;
  if not exists (select 1 from public.tests where id = p_test_id) then
    raise exception using errcode = 'P0001', message = 'TEST_NOT_FOUND';
  end if;

  create temporary table editor_question_ids(id uuid primary key) on commit drop;
  create temporary table editor_option_ids(question_id uuid not null, id uuid primary key) on commit drop;
  update public.tests set title=btrim(p_title), description=nullif(btrim(p_description),''), updated_at=now() where id=p_test_id;

  for q in select value from jsonb_array_elements(p_questions) loop
    v_type := q->>'type'; v_config := q->'typeConfig'; v_normalized_config := null; v_points := null;
    if v_type is null or v_type not in ('SINGLE_CHOICE','MULTIPLE_CHOICE','NUMERIC','MATCHING','MULTI_PART') then
      raise exception using errcode = '22023', message = 'INVALID_QUESTION_TYPE';
    end if;
    if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'isRequired') is distinct from 'boolean' or jsonb_typeof(q->'position') is distinct from 'number'
       or (q->>'position')::numeric <> trunc((q->>'position')::numeric) then
      raise exception using errcode = '22023', message = 'INVALID_QUESTION_STRUCTURE';
    end if;

    if v_type = 'MATCHING' then
      if jsonb_typeof(v_config) is distinct from 'object' or jsonb_typeof(v_config->'matching') is distinct from 'object'
         or jsonb_typeof(v_config->'matching'->'leftItems') is distinct from 'array'
         or jsonb_typeof(v_config->'matching'->'options') is distinct from 'array'
         or jsonb_typeof(v_config->'matching'->'allowOptionReuse') is distinct from 'boolean'
         or jsonb_array_length(v_config->'matching'->'leftItems') < 2
         or jsonb_array_length(v_config->'matching'->'options') < 2 then
        raise exception using errcode = '22023', message = 'INVALID_MATCHING_CONFIG';
      end if;
      v_keys:=array[]::text[]; v_positions:=array[]::integer[];
      for o in select value from jsonb_array_elements(v_config->'matching'->'options') loop
        if jsonb_typeof(o) is distinct from 'object' or nullif(btrim(o->>'key'),'') is null or nullif(btrim(o->>'text'),'') is null
           or nullif(btrim(o->>'label'),'') is null or jsonb_typeof(o->'position') is distinct from 'number'
           or (o->>'position')::numeric<>trunc((o->>'position')::numeric) then raise exception 'INVALID_MATCHING_OPTION'; end if;
        if o->>'key'=any(v_keys) or (o->>'position')::integer=any(v_positions) then raise exception 'DUPLICATE_MATCHING_OPTION_KEY_OR_POSITION'; end if;
        v_keys:=array_append(v_keys,o->>'key'); v_positions:=array_append(v_positions,(o->>'position')::integer);
      end loop;
      v_left_keys:=array[]::text[]; v_positions:=array[]::integer[]; v_correct_keys:=array[]::text[];
      for l in select value from jsonb_array_elements(v_config->'matching'->'leftItems') loop
        if jsonb_typeof(l) is distinct from 'object' or nullif(btrim(l->>'key'),'') is null or nullif(btrim(l->>'text'),'') is null
           or nullif(btrim(l->>'label'),'') is null or jsonb_typeof(l->'position') is distinct from 'number'
           or (l->>'position')::numeric<>trunc((l->>'position')::numeric)
           or nullif(l->>'correctOptionKey','') is null or not (l->>'correctOptionKey'=any(v_keys)) then raise exception 'INVALID_MATCHING_LEFT_ITEM'; end if;
        if l->>'key'=any(v_left_keys) or (l->>'position')::integer=any(v_positions) then raise exception 'DUPLICATE_MATCHING_LEFT_KEY_OR_POSITION'; end if;
        if not (v_config->'matching'->>'allowOptionReuse')::boolean and l->>'correctOptionKey'=any(v_correct_keys) then raise exception 'MATCHING_OPTION_REUSED'; end if;
        v_left_keys:=array_append(v_left_keys,l->>'key'); v_positions:=array_append(v_positions,(l->>'position')::integer); v_correct_keys:=array_append(v_correct_keys,l->>'correctOptionKey');
      end loop;
      v_points:=jsonb_array_length(v_config->'matching'->'leftItems');
      v_normalized_config:=jsonb_build_object('matching',jsonb_build_object('allowOptionReuse',(v_config->'matching'->>'allowOptionReuse')::boolean,'leftItems',v_config->'matching'->'leftItems','options',v_config->'matching'->'options'));

    elsif v_type = 'MULTI_PART' then
      if jsonb_typeof(v_config) is distinct from 'object' or jsonb_typeof(v_config->'multiPart') is distinct from 'object'
         or jsonb_typeof(v_config->'multiPart'->'parts') is distinct from 'array' or jsonb_array_length(v_config->'multiPart'->'parts')<1 then raise exception 'INVALID_MULTI_PART_CONFIG'; end if;
      v_keys:=array[]::text[]; v_positions:=array[]::integer[]; v_parts:='[]'::jsonb; v_points:=0;
      for p in select value from jsonb_array_elements(v_config->'multiPart'->'parts') loop
        if jsonb_typeof(p) is distinct from 'object' or nullif(btrim(p->>'key'),'') is null or nullif(btrim(p->>'prompt'),'') is null
           or nullif(btrim(p->>'label'),'') is null or p->>'type' is null or p->>'type' not in ('NUMERIC','SINGLE_CHOICE','MULTIPLE_CHOICE')
           or jsonb_typeof(p->'points') is distinct from 'number' or (p->>'points')::numeric<=0
           or jsonb_typeof(p->'position') is distinct from 'number' or (p->>'position')::numeric<>trunc((p->>'position')::numeric) then raise exception 'INVALID_MULTI_PART_PART'; end if;
        if p->>'key'=any(v_keys) or (p->>'position')::integer=any(v_positions) then raise exception 'DUPLICATE_MULTI_PART_KEY_OR_POSITION'; end if;
        v_keys:=array_append(v_keys,p->>'key'); v_positions:=array_append(v_positions,(p->>'position')::integer); v_points:=v_points+(p->>'points')::numeric;
        if p->>'type'='NUMERIC' then
          if p->>'numericMode' is null or p->>'numericMode' not in ('EXACT','TOLERANCE','RANGE') then raise exception 'INVALID_MULTI_PART_NUMERIC_MODE'; end if;
          if p->>'numericMode' in ('EXACT','TOLERANCE') and jsonb_typeof(p->'numericAnswer') is distinct from 'number' then raise exception 'INVALID_MULTI_PART_NUMERIC_ANSWER'; end if;
          if p->>'numericMode'='TOLERANCE' and (jsonb_typeof(p->'numericTolerance') is distinct from 'number' or (p->>'numericTolerance')::numeric<0) then raise exception 'INVALID_MULTI_PART_TOLERANCE'; end if;
          if p->>'numericMode'='RANGE' and (jsonb_typeof(p->'numericMin') is distinct from 'number' or jsonb_typeof(p->'numericMax') is distinct from 'number' or (p->>'numericMin')::numeric>(p->>'numericMax')::numeric) then raise exception 'INVALID_MULTI_PART_RANGE'; end if;
          v_part:=jsonb_build_object('key',p->>'key','label',p->>'label','prompt',btrim(p->>'prompt'),'type','NUMERIC','points',(p->>'points')::numeric,'position',(p->>'position')::integer,'numericMode',p->>'numericMode','numericAnswer',case when p->>'numericMode' in ('EXACT','TOLERANCE') then p->'numericAnswer' else 'null'::jsonb end,'numericTolerance',case when p->>'numericMode'='TOLERANCE' then p->'numericTolerance' else 'null'::jsonb end,'numericMin',case when p->>'numericMode'='RANGE' then p->'numericMin' else 'null'::jsonb end,'numericMax',case when p->>'numericMode'='RANGE' then p->'numericMax' else 'null'::jsonb end,'options','[]'::jsonb);
        else
          if jsonb_typeof(p->'options') is distinct from 'array' or jsonb_array_length(p->'options')<2 then raise exception 'INVALID_MULTI_PART_OPTIONS'; end if;
          v_option_keys:=array[]::text[]; v_option_positions:=array[]::integer[]; v_correct:=0;
          for o in select value from jsonb_array_elements(p->'options') loop
            if jsonb_typeof(o) is distinct from 'object' or nullif(btrim(coalesce(o->>'id',o->>'clientId',o->>'key')),'') is null or nullif(btrim(o->>'text'),'') is null
               or jsonb_typeof(o->'position') is distinct from 'number' or (o->>'position')::numeric<>trunc((o->>'position')::numeric)
               or jsonb_typeof(o->'isCorrect') is distinct from 'boolean' then raise exception 'INVALID_MULTI_PART_OPTION'; end if;
            if coalesce(o->>'id',o->>'clientId',o->>'key')=any(v_option_keys) or (o->>'position')::integer=any(v_option_positions) then raise exception 'DUPLICATE_MULTI_PART_OPTION_KEY_OR_POSITION'; end if;
            v_option_keys:=array_append(v_option_keys,coalesce(o->>'id',o->>'clientId',o->>'key')); v_option_positions:=array_append(v_option_positions,(o->>'position')::integer); if (o->>'isCorrect')::boolean then v_correct:=v_correct+1; end if;
          end loop;
          if (p->>'type'='SINGLE_CHOICE' and v_correct<>1) or (p->>'type'='MULTIPLE_CHOICE' and v_correct<1) then raise exception 'INVALID_MULTI_PART_CORRECT_OPTIONS'; end if;
          v_part:=jsonb_build_object('key',p->>'key','label',p->>'label','prompt',btrim(p->>'prompt'),'type',p->>'type','points',(p->>'points')::numeric,'position',(p->>'position')::integer,'numericMode',null,'numericAnswer',null,'numericTolerance',null,'numericMin',null,'numericMax',null,'options',p->'options');
        end if;
        v_parts:=v_parts||jsonb_build_array(v_part);
      end loop;
      v_normalized_config:=jsonb_build_object('multiPart',jsonb_build_object('parts',v_parts));
    else
      v_points:=(q->>'points')::numeric;
      if v_points<=0 then raise exception 'INVALID_QUESTION_POINTS'; end if;
    end if;

    v_question_id:=case when nullif(q->>'id','') is not null and exists(select 1 from public.test_questions where id=(q->>'id')::uuid and test_id=p_test_id) then (q->>'id')::uuid else gen_random_uuid() end;
    insert into editor_question_ids values(v_question_id);
    insert into public.test_questions(id,test_id,type,prompt,image_path,points,is_required,position,numeric_mode,numeric_answer,numeric_tolerance,numeric_min,numeric_max,type_config)
    values(v_question_id,p_test_id,v_type::public.question_type,btrim(coalesce(q->>'prompt','')),nullif(q->>'imagePath',''),v_points,(q->>'isRequired')::boolean,(q->>'position')::integer,
      case when v_type='NUMERIC' then (jsonb_populate_record(null::public.test_questions,jsonb_build_object('numeric_mode',q->'numericMode'))).numeric_mode else null end,
      case when v_type='NUMERIC' and q->>'numericMode'<>'RANGE' then (q->>'numericAnswer')::numeric else null end,
      case when v_type='NUMERIC' and q->>'numericMode'='TOLERANCE' then (q->>'numericTolerance')::numeric else null end,
      case when v_type='NUMERIC' and q->>'numericMode'='RANGE' then (q->>'numericMin')::numeric else null end,
      case when v_type='NUMERIC' and q->>'numericMode'='RANGE' then (q->>'numericMax')::numeric else null end,v_normalized_config)
    on conflict(id) do update set type=excluded.type,prompt=excluded.prompt,image_path=excluded.image_path,points=excluded.points,is_required=excluded.is_required,position=excluded.position,numeric_mode=excluded.numeric_mode,numeric_answer=excluded.numeric_answer,numeric_tolerance=excluded.numeric_tolerance,numeric_min=excluded.numeric_min,numeric_max=excluded.numeric_max,type_config=excluded.type_config,updated_at=now();

    if v_type in ('SINGLE_CHOICE','MULTIPLE_CHOICE') then
      for o in select value from jsonb_array_elements(coalesce(q->'options','[]'::jsonb)) loop
        v_option_id:=case when nullif(o->>'id','') is not null and exists(select 1 from public.test_question_options where id=(o->>'id')::uuid and question_id=v_question_id) then (o->>'id')::uuid else gen_random_uuid() end;
        insert into editor_option_ids values(v_question_id,v_option_id);
        insert into public.test_question_options(id,question_id,text,is_correct,position) values(v_option_id,v_question_id,btrim(o->>'text'),(o->>'isCorrect')::boolean,(o->>'position')::integer)
        on conflict(id) do update set text=excluded.text,is_correct=excluded.is_correct,position=excluded.position,updated_at=now();
      end loop;
    end if;
    delete from public.test_question_options x where x.question_id=v_question_id and not exists(select 1 from editor_option_ids k where k.question_id=v_question_id and k.id=x.id);
  end loop;

  delete from public.test_question_options where question_id in(select id from public.test_questions where test_id=p_test_id and id not in(select id from editor_question_ids));
  delete from public.test_questions where test_id=p_test_id and id not in(select id from editor_question_ids);
  select jsonb_build_object('id',t.id,'folderId',t.folder_id,'title',t.title,'description',coalesce(t.description,''),'questions',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'clientId',x.id,'type',x.type,'prompt',x.prompt,'imagePath',x.image_path,'imageUrl',null,'points',x.points,'isRequired',x.is_required,'position',x.position,'numericMode',x.numeric_mode,'numericAnswer',x.numeric_answer,'numericTolerance',x.numeric_tolerance,'numericMin',x.numeric_min,'numericMax',x.numeric_max,'typeConfig',x.type_config,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'clientId',o.id,'text',o.text,'isCorrect',o.is_correct,'position',o.position) order by o.position) from public.test_question_options o where o.question_id=x.id),'[]'::jsonb)) order by x.position) from public.test_questions x where x.test_id=t.id),'[]'::jsonb)) into v_result from public.tests t where t.id=p_test_id;
  return v_result;
end;
$$;

revoke all on function public.save_test_editor(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_test_editor(uuid,text,text,jsonb) to service_role;

create or replace function public.create_composite_test_assignment_atomic(
  p_student_id uuid, p_source_test_ids uuid[], p_title text, p_question_count integer,
  p_sampling_mode text, p_shuffle_questions boolean, p_deadline_at timestamptz,
  p_show_correct_answers_after_close boolean, p_assigned_by uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_test_id uuid:=gen_random_uuid(); v_assignment_id uuid:=gen_random_uuid(); v_available integer; v_source_count integer; v_snapshot jsonb; v_question record; v_selected integer:=0; v_round integer:=1;
begin
  if nullif(btrim(p_title),'') is null or char_length(btrim(p_title))>240 or p_sampling_mode not in ('POOL','BALANCED') or p_question_count<1 or p_source_test_ids is null or cardinality(p_source_test_ids)<1 or cardinality(p_source_test_ids)<>(select count(distinct source_id) from unnest(p_source_test_ids) source_ids(source_id)) then raise exception using errcode='22023',message='INVALID_COMPOSITE_TEST_INPUT'; end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','student_not_found'); end if;
  if not exists(select 1 from public.profiles where id=p_assigned_by and role='ADMIN') then raise exception using errcode='42501',message='ADMIN_REQUIRED'; end if;
  select count(*),coalesce(sum(question_count),0) into v_source_count,v_available from(select t.id,count(q.id)::integer question_count from public.tests t left join public.test_questions q on q.test_id=t.id where t.id=any(p_source_test_ids) and t.status='PUBLISHED' and t.is_assignment_copy=false group by t.id having count(q.id)>0) source;
  if v_source_count<>cardinality(p_source_test_ids) then return jsonb_build_object('status','invalid_sources'); end if; if p_question_count>v_available then return jsonb_build_object('status','invalid_limit'); end if;
  create temporary table composite_source_order(test_id uuid primary key,order_key double precision) on commit drop; insert into composite_source_order select id,random() from unnest(p_source_test_ids) id;
  create temporary table composite_candidates(source_test_id uuid not null,source_question_id uuid primary key,source_position integer not null,random_rank integer not null) on commit drop;
  insert into composite_candidates select q.test_id,q.id,q.position,row_number() over(partition by q.test_id order by random(),q.id)::integer from public.test_questions q where q.test_id=any(p_source_test_ids);
  create temporary table composite_selected(source_test_id uuid not null,source_question_id uuid primary key,selection_order serial) on commit drop;
  if p_sampling_mode='POOL' then insert into composite_selected(source_test_id,source_question_id) select source_test_id,source_question_id from composite_candidates order by random(),source_question_id limit p_question_count;
  else while v_selected<p_question_count loop for v_question in select c.source_test_id,c.source_question_id from composite_candidates c join composite_source_order s on s.test_id=c.source_test_id where c.random_rank=v_round order by s.order_key,c.source_test_id loop exit when v_selected>=p_question_count; insert into composite_selected(source_test_id,source_question_id) values(v_question.source_test_id,v_question.source_question_id); v_selected:=v_selected+1; end loop; v_round:=v_round+1; end loop; end if;
  insert into public.tests(id,folder_id,title,description,status,is_assignment_copy,created_by) values(v_test_id,null,btrim(p_title),null,'PUBLISHED',true,p_assigned_by);
  create temporary table composite_question_map(source_id uuid primary key,target_id uuid not null,target_position integer not null) on commit drop;
  insert into composite_question_map select s.source_question_id,gen_random_uuid(),row_number() over(order by case when p_shuffle_questions then random() else s.selection_order end,s.selection_order)::integer-1 from composite_selected s;
  insert into public.test_questions(id,test_id,type,prompt,image_path,points,is_required,position,numeric_mode,numeric_answer,numeric_tolerance,numeric_min,numeric_max,type_config)
  select m.target_id,v_test_id,q.type,q.prompt,q.image_path,q.points,q.is_required,m.target_position,q.numeric_mode,q.numeric_answer,q.numeric_tolerance,q.numeric_min,q.numeric_max,q.type_config from composite_question_map m join public.test_questions q on q.id=m.source_id;
  insert into public.test_question_options(id,question_id,text,is_correct,position) select gen_random_uuid(),m.target_id,o.text,o.is_correct,o.position from composite_question_map m join public.test_question_options o on o.question_id=m.source_id;
  select jsonb_build_object('version',2,'sourceTestId',t.id,'createdBy',p_assigned_by,'title',t.title,'description',coalesce(t.description,''),'questions',coalesce(jsonb_agg(
    jsonb_build_object('key',q.id,'type',q.type,'prompt',q.prompt,'imagePath',q.image_path,'points',q.points,'required',q.is_required,'position',q.position)
    || case when q.type='MATCHING' then jsonb_build_object('matching',q.type_config->'matching') when q.type='MULTI_PART' then jsonb_build_object('multiPart',jsonb_build_object('parts',(select jsonb_agg(p-'numericMode'-'numericAnswer'-'numericTolerance'-'numericMin'-'numericMax'||jsonb_build_object('numeric',jsonb_build_object('mode',p->'numericMode','exactValue',p->'numericAnswer','tolerance',p->'numericTolerance','rangeMin',p->'numericMin','rangeMax',p->'numericMax'),'options',coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(nullif(o->>'id',''),o->>'clientId',o->>'key'),'text',o->>'text','isCorrect',(o->>'isCorrect')::boolean,'position',(o->>'position')::integer) order by (o->>'position')::integer) from jsonb_array_elements(p->'options') o),'[]'::jsonb)) order by (p->>'position')::integer) from jsonb_array_elements(q.type_config->'multiPart'->'parts') p))) else jsonb_build_object('numeric',jsonb_build_object('mode',q.numeric_mode,'exactValue',q.numeric_answer,'tolerance',q.numeric_tolerance,'rangeMin',q.numeric_min,'rangeMax',q.numeric_max),'options',coalesce((select jsonb_agg(jsonb_build_object('key',o.id,'text',o.text,'isCorrect',o.is_correct,'position',o.position) order by o.position) from public.test_question_options o where o.question_id=q.id),'[]'::jsonb)) end
    order by q.position),'[]'::jsonb)) into v_snapshot from public.tests t join public.test_questions q on q.test_id=t.id where t.id=v_test_id group by t.id;
  insert into public.test_assignments(id,student_id,source_test_id,title,snapshot,deadline_at,max_attempts,show_correct_answers_after_close,assigned_by) values(v_assignment_id,p_student_id,v_test_id,btrim(p_title),v_snapshot,p_deadline_at,1,p_show_correct_answers_after_close,p_assigned_by);
  return jsonb_build_object('status','created','test_id',v_test_id,'assignment_id',v_assignment_id);
end;
$$;

revoke all on function public.create_composite_test_assignment_atomic(uuid,uuid[],text,integer,text,boolean,timestamptz,boolean,uuid) from public,anon,authenticated;
grant execute on function public.create_composite_test_assignment_atomic(uuid,uuid[],text,integer,text,boolean,timestamptz,boolean,uuid) to service_role;

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
  if v_assignment.deadline_at is not null and v_assignment.deadline_at<=now() then raise exception using errcode='P0001',message='TEST_ASSIGNMENT_DEADLINE_PASSED'; end if;
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

revoke all on function public.submit_student_test_attempt_atomic(uuid) from public,anon,authenticated;
grant execute on function public.submit_student_test_attempt_atomic(uuid) to service_role;

commit;
