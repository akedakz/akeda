-- Phase 1 foundation for the system "Mistake Review" trainer.
-- Apply after 20260904-test-folder-delete-depth-hotfix.sql.
begin;

alter table public.test_questions add column logical_question_id uuid;
update public.test_questions set logical_question_id=id where logical_question_id is null;
alter table public.test_questions alter column logical_question_id set default gen_random_uuid();
alter table public.test_questions alter column logical_question_id set not null;
create index test_questions_logical_question_id_idx on public.test_questions(logical_question_id);

create function public.protect_test_question_logical_identity()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.logical_question_id is distinct from old.logical_question_id then
    raise exception using errcode='55000',message='TEST_QUESTION_LOGICAL_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger protect_test_question_logical_identity
before update of logical_question_id on public.test_questions
for each row execute function public.protect_test_question_logical_identity();
revoke all on function public.protect_test_question_logical_identity() from public,anon,authenticated,service_role;

create sequence public.student_mistake_activation_sequence_seq as bigint;
revoke all on sequence public.student_mistake_activation_sequence_seq from public,anon,authenticated,service_role;

create table public.student_mistakes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  owner_admin_id uuid not null references public.profiles(id) on delete cascade,
  logical_question_id uuid not null,
  status text not null check(status in ('ACTIVE','CORRECTED','REMOVED_BY_ADMIN')),
  current_question_snapshot jsonb not null check(jsonb_typeof(current_question_snapshot)='object'),
  latest_failed_answer jsonb,
  latest_source_assignment_id uuid,
  latest_source_attempt_id uuid,
  latest_source_question_key text not null check(nullif(btrim(latest_source_question_key),'') is not null),
  latest_assignment_title_snapshot text not null,
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  activated_at timestamptz not null,
  activation_sequence bigint not null,
  activation_version integer not null default 1 check(activation_version>0),
  corrected_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  reactivation_count integer not null default 0 check(reactivation_count>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id,logical_question_id),
  check(first_failed_at<=last_failed_at)
);
create index student_mistakes_active_queue_idx on public.student_mistakes(student_id,activation_sequence,id) where status='ACTIVE';
create index student_mistakes_owner_student_idx on public.student_mistakes(owner_admin_id,student_id);

create table public.student_mistake_occurrences (
  id uuid primary key default gen_random_uuid(),
  mistake_id uuid not null references public.student_mistakes(id) on delete cascade,
  logical_question_id uuid not null,
  source_attempt_id uuid not null,
  source_assignment_id uuid not null,
  source_question_key text not null check(nullif(btrim(source_question_key),'') is not null),
  assignment_title_snapshot text not null,
  failed_answer_snapshot jsonb,
  question_snapshot jsonb not null check(jsonb_typeof(question_snapshot)='object'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(source_attempt_id,source_question_key)
);
create index student_mistake_occurrences_mistake_time_idx on public.student_mistake_occurrences(mistake_id,occurred_at,id);

create table public.student_mistake_correction_attempts (
  id uuid primary key default gen_random_uuid(),
  mistake_id uuid not null references public.student_mistakes(id) on delete cascade,
  activation_version integer not null check(activation_version>0),
  submitted_answer jsonb not null,
  is_correct boolean not null,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique(mistake_id,request_id)
);

create table public.student_mistake_image_refs (
  mistake_id uuid not null references public.student_mistakes(id) on delete cascade,
  storage_path text not null check(nullif(btrim(storage_path),'') is not null),
  created_at timestamptz not null default now(),
  primary key(mistake_id,storage_path)
);
create index student_mistake_image_refs_storage_path_idx on public.student_mistake_image_refs(storage_path);

alter table public.student_mistakes enable row level security;
alter table public.student_mistake_occurrences enable row level security;
alter table public.student_mistake_correction_attempts enable row level security;
alter table public.student_mistake_image_refs enable row level security;
revoke all on public.student_mistakes,public.student_mistake_occurrences,
  public.student_mistake_correction_attempts,public.student_mistake_image_refs from public,anon,authenticated;
grant select on public.student_mistakes,public.student_mistake_occurrences,
  public.student_mistake_correction_attempts,public.student_mistake_image_refs to service_role;

create function public.protect_student_mistake_occurrence_immutable()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception using errcode='55000',message='STUDENT_MISTAKE_OCCURRENCE_IMMUTABLE';
end;
$$;
create trigger protect_student_mistake_occurrence_immutable
before update on public.student_mistake_occurrences
for each row execute function public.protect_student_mistake_occurrence_immutable();
revoke all on function public.protect_student_mistake_occurrence_immutable() from public,anon,authenticated,service_role;

-- The effective composite writer was renamed to this internal overload by
-- 20260810-test-consistency-and-idempotency.sql. Preserve its behavior while
-- copying the source logical identity and emitting it into the V2 snapshot.
create or replace function public.create_composite_test_assignment_atomic_unkeyed(
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
  insert into public.test_questions(id,test_id,logical_question_id,type,prompt,image_path,points,is_required,position,numeric_mode,numeric_answer,numeric_tolerance,numeric_min,numeric_max,type_config)
  select m.target_id,v_test_id,q.logical_question_id,q.type,q.prompt,q.image_path,q.points,q.is_required,m.target_position,q.numeric_mode,q.numeric_answer,q.numeric_tolerance,q.numeric_min,q.numeric_max,q.type_config from composite_question_map m join public.test_questions q on q.id=m.source_id;
  insert into public.test_question_options(id,question_id,text,is_correct,position) select gen_random_uuid(),m.target_id,o.text,o.is_correct,o.position from composite_question_map m join public.test_question_options o on o.question_id=m.source_id;
  select jsonb_build_object('version',2,'sourceTestId',t.id,'createdBy',p_assigned_by,'title',t.title,'description',coalesce(t.description,''),'questions',coalesce(jsonb_agg(
    jsonb_build_object('key',q.id,'logicalQuestionId',q.logical_question_id,'type',q.type,'prompt',q.prompt,'imagePath',q.image_path,'points',q.points,'required',q.is_required,'position',q.position)
    || case when q.type='MATCHING' then jsonb_build_object('matching',q.type_config->'matching') when q.type='MULTI_PART' then jsonb_build_object('multiPart',jsonb_build_object('parts',(select jsonb_agg(p-'numericMode'-'numericAnswer'-'numericTolerance'-'numericMin'-'numericMax'||jsonb_build_object('numeric',jsonb_build_object('mode',p->'numericMode','exactValue',p->'numericAnswer','tolerance',p->'numericTolerance','rangeMin',p->'numericMin','rangeMax',p->'numericMax'),'options',coalesce((select jsonb_agg(jsonb_build_object('key',coalesce(nullif(o->>'id',''),o->>'clientId',o->>'key'),'text',o->>'text','isCorrect',(o->>'isCorrect')::boolean,'position',(o->>'position')::integer) order by (o->>'position')::integer) from jsonb_array_elements(p->'options') o),'[]'::jsonb)) order by (p->>'position')::integer) from jsonb_array_elements(q.type_config->'multiPart'->'parts') p))) else jsonb_build_object('numeric',jsonb_build_object('mode',q.numeric_mode,'exactValue',q.numeric_answer,'tolerance',q.numeric_tolerance,'rangeMin',q.numeric_min,'rangeMax',q.numeric_max),'options',coalesce((select jsonb_agg(jsonb_build_object('key',o.id,'text',o.text,'isCorrect',o.is_correct,'position',o.position) order by o.position) from public.test_question_options o where o.question_id=q.id),'[]'::jsonb)) end
    order by q.position),'[]'::jsonb)) into v_snapshot from public.tests t join public.test_questions q on q.test_id=t.id where t.id=v_test_id group by t.id;
  insert into public.test_assignments(id,student_id,source_test_id,title,snapshot,deadline_at,max_attempts,show_correct_answers_after_close,assigned_by) values(v_assignment_id,p_student_id,v_test_id,btrim(p_title),v_snapshot,p_deadline_at,1,p_show_correct_answers_after_close,p_assigned_by);
  return jsonb_build_object('status','created','test_id',v_test_id,'assignment_id',v_assignment_id);
end;
$$;
revoke all on function public.create_composite_test_assignment_atomic_unkeyed(uuid,uuid[],text,integer,text,boolean,timestamptz,boolean,uuid) from public,anon,authenticated,service_role;

create function public.capture_final_test_mistakes()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_assignment public.test_assignments%rowtype;
  v_question jsonb;
  v_answer jsonb;
  v_logical_question_id uuid;
  v_mistake public.student_mistakes%rowtype;
  v_failed_at timestamptz:=coalesce(new.submitted_at,clock_timestamp());
  v_paths text[];
  v_path text;
begin
  if old.submitted_at is not null or new.submitted_at is null then return new; end if;
  select * into v_assignment from public.test_assignments
  where id=new.assignment_id and student_id=new.student_id;
  if not found then raise exception using errcode='23503',message='MISTAKE_ASSIGNMENT_OWNERSHIP_MISMATCH'; end if;
  if not exists(select 1 from public.profiles where id=new.student_id and role='STUDENT')
     or not exists(select 1 from public.profiles where id=v_assignment.assigned_by and role='ADMIN') then
    raise exception using errcode='42501',message='MISTAKE_PROFILE_OWNERSHIP_INVALID';
  end if;

  select coalesce(array_agg(path order by path),array[]::text[]) into v_paths from (
    select distinct btrim(question->>'imagePath') path
    from jsonb_array_elements(v_assignment.snapshot->'questions') questions(question)
    join public.test_attempt_answers answer on answer.attempt_id=new.id
      and answer.question_key=question->>'key' and answer.is_correct=false
    where nullif(btrim(question->>'imagePath'),'') is not null
  ) images;
  -- Grading already holds the attempt and assignment rows. Never wait here:
  -- a source delete can hold an image lock while its SET NULL FK action waits
  -- for that assignment row. A serialization failure leaves the whole final
  -- grading transaction retryable and avoids an inverted-lock deadlock.
  foreach v_path in array v_paths loop
    if not pg_try_advisory_xact_lock(hashtextextended('nsp:test-lifecycle:image:'||v_path,0)) then
      raise exception using errcode='40001',message='MISTAKE_IMAGE_LOCK_BUSY';
    end if;
  end loop;
  perform public.lock_test_lifecycle_images(v_paths);
  if exists(select 1 from public.test_image_cleanup_claims claim where claim.storage_path=any(v_paths)) then
    raise exception using errcode='55000',message='MISTAKE_IMAGE_CLEANUP_CLAIMED';
  end if;

  for v_question,v_answer in
    select question,answer.answer
    from jsonb_array_elements(v_assignment.snapshot->'questions') with ordinality questions(question,ordinality)
    join public.test_attempt_answers answer on answer.attempt_id=new.id
      and answer.question_key=question->>'key' and answer.is_correct=false
    order by questions.ordinality,question->>'key'
  loop
    begin
      v_logical_question_id:=coalesce(nullif(v_question->>'logicalQuestionId','')::uuid,nullif(v_question->>'key','')::uuid);
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='MISTAKE_LOGICAL_QUESTION_ID_INVALID';
    end;
    if v_logical_question_id is null then raise exception using errcode='22023',message='MISTAKE_LOGICAL_QUESTION_ID_MISSING'; end if;

    if exists(select 1 from public.student_mistake_occurrences
      where source_attempt_id=new.id and source_question_key=v_question->>'key') then continue; end if;

    insert into public.student_mistakes(student_id,owner_admin_id,logical_question_id,status,
      current_question_snapshot,latest_failed_answer,latest_source_assignment_id,latest_source_attempt_id,
      latest_source_question_key,latest_assignment_title_snapshot,first_failed_at,last_failed_at,activated_at,activation_sequence)
    values(new.student_id,v_assignment.assigned_by,v_logical_question_id,'ACTIVE',v_question,v_answer,
      v_assignment.id,new.id,v_question->>'key',v_assignment.title,v_failed_at,v_failed_at,v_failed_at,
      nextval('public.student_mistake_activation_sequence_seq'))
    on conflict(student_id,logical_question_id) do nothing;

    select * into v_mistake from public.student_mistakes
    where student_id=new.student_id and logical_question_id=v_logical_question_id for update;
    if v_mistake.owner_admin_id is distinct from v_assignment.assigned_by then
      raise exception using errcode='42501',message='MISTAKE_OWNER_MISMATCH';
    end if;
    if exists(select 1 from public.student_mistake_occurrences
      where source_attempt_id=new.id and source_question_key=v_question->>'key') then continue; end if;

    if v_mistake.latest_source_attempt_id is distinct from new.id
       or v_mistake.latest_source_question_key is distinct from v_question->>'key' then
      if v_mistake.status='ACTIVE' then
        update public.student_mistakes set current_question_snapshot=v_question,latest_failed_answer=v_answer,
          latest_source_assignment_id=v_assignment.id,latest_source_attempt_id=new.id,
          latest_source_question_key=v_question->>'key',latest_assignment_title_snapshot=v_assignment.title,
          last_failed_at=v_failed_at,updated_at=now() where id=v_mistake.id;
      else
        update public.student_mistakes set status='ACTIVE',current_question_snapshot=v_question,
          latest_failed_answer=v_answer,latest_source_assignment_id=v_assignment.id,latest_source_attempt_id=new.id,
          latest_source_question_key=v_question->>'key',latest_assignment_title_snapshot=v_assignment.title,
          last_failed_at=v_failed_at,activated_at=v_failed_at,
          activation_sequence=nextval('public.student_mistake_activation_sequence_seq'),
          activation_version=activation_version+1,reactivation_count=reactivation_count+1,
          corrected_at=null,removed_at=null,removed_by=null,updated_at=now() where id=v_mistake.id;
      end if;
    end if;

    insert into public.student_mistake_occurrences(mistake_id,logical_question_id,source_attempt_id,
      source_assignment_id,source_question_key,assignment_title_snapshot,failed_answer_snapshot,
      question_snapshot,occurred_at)
    values(v_mistake.id,v_logical_question_id,new.id,v_assignment.id,v_question->>'key',v_assignment.title,
      v_answer,v_question,v_failed_at) on conflict(source_attempt_id,source_question_key) do nothing;

    insert into public.student_mistake_image_refs(mistake_id,storage_path)
    select v_mistake.id,btrim(v_question->>'imagePath')
    where nullif(btrim(v_question->>'imagePath'),'') is not null
    on conflict do nothing;
  end loop;
  return new;
end;
$$;
create trigger capture_final_test_mistakes
after update of submitted_at on public.test_attempts
for each row when(old.submitted_at is null and new.submitted_at is not null)
execute function public.capture_final_test_mistakes();
revoke all on function public.capture_final_test_mistakes() from public,anon,authenticated,service_role;

create or replace function public.claim_test_image_cleanup_candidates(p_paths text[])
returns text[] language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_paths text[];
begin
  select coalesce(array_agg(path order by path),array[]::text[]) into v_paths
  from (select distinct btrim(path) path from unnest(coalesce(p_paths,array[]::text[])) paths(path)
    where nullif(btrim(path),'') is not null) normalized;
  perform public.lock_test_lifecycle_images(v_paths);
  insert into public.test_image_cleanup_claims(storage_path)
  select path from unnest(v_paths) candidates(path)
  where not exists(select 1 from public.test_questions q where q.image_path=path)
    and not exists(select 1 from public.test_assignment_image_refs r where r.storage_path=path)
    and not exists(select 1 from public.student_mistake_image_refs r where r.storage_path=path)
  on conflict do nothing;
  return coalesce((select array_agg(path order by path) from unnest(v_paths) candidates(path)
    where exists(select 1 from public.test_image_cleanup_claims c where c.storage_path=path)
      and not exists(select 1 from public.test_questions q where q.image_path=path)
      and not exists(select 1 from public.test_assignment_image_refs r where r.storage_path=path)
      and not exists(select 1 from public.student_mistake_image_refs r where r.storage_path=path)),array[]::text[]);
end;
$$;
revoke all on function public.claim_test_image_cleanup_candidates(text[]) from public,anon,authenticated,service_role;

create function public.student_mistake_image_paths_for_deletion(p_student_id uuid,p_admin_id uuid)
returns text[] language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN')
     or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then
    return array[]::text[];
  end if;
  return coalesce((select array_agg(distinct r.storage_path order by r.storage_path)
    from public.student_mistakes m join public.student_mistake_image_refs r on r.mistake_id=m.id
    where m.student_id=p_student_id),array[]::text[]);
end;
$$;

create function public.student_mistake_image_cleanup_after_student_deletion(p_student_id uuid,p_paths text[],p_admin_id uuid)
returns text[] language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN')
     or exists(select 1 from public.profiles where id=p_student_id) then
    return array[]::text[];
  end if;
  return public.claim_test_image_cleanup_candidates(p_paths);
end;
$$;

revoke all on function public.student_mistake_image_paths_for_deletion(uuid,uuid) from public,anon,authenticated;
revoke all on function public.student_mistake_image_cleanup_after_student_deletion(uuid,text[],uuid) from public,anon,authenticated;
grant execute on function public.student_mistake_image_paths_for_deletion(uuid,uuid),
  public.student_mistake_image_cleanup_after_student_deletion(uuid,text[],uuid) to service_role;

commit;
