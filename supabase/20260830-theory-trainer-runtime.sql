begin;

create table public.trainer_theory_question_progress (
  assignment_id uuid not null references public.trainer_assignments(id) on delete cascade,
  question_key text not null check (question_key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  question_fingerprint text not null check (question_fingerprint ~ '^[0-9a-f]{64}$'),
  correct_count integer not null default 0 check (correct_count between 0 and 3),
  last_answered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (assignment_id, question_key)
);

create table public.trainer_theory_tasks (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.trainer_assignments(id) on delete cascade,
  question_key text not null check (question_key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  question_fingerprint text not null check (question_fingerprint ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  answered_at timestamptz,
  selected_option integer check (selected_option between 0 and 3),
  is_correct boolean
);
create index trainer_theory_tasks_assignment_issued_idx on public.trainer_theory_tasks(assignment_id, issued_at desc);

create table public.trainer_theory_completion_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  owner_admin_id uuid not null,
  source_trainer_id uuid,
  title_snapshot text not null check (char_length(btrim(title_snapshot)) between 1 and 120),
  question_count_snapshot integer not null check (question_count_snapshot > 0),
  required_points_snapshot integer not null check (required_points_snapshot = question_count_snapshot * 3),
  assigned_at timestamptz,
  completed_at timestamptz not null default now(),
  unique(student_id, owner_admin_id, source_trainer_id)
);
create index trainer_theory_completion_student_idx on public.trainer_theory_completion_history(student_id, completed_at desc);
create index trainer_theory_completion_owner_student_idx on public.trainer_theory_completion_history(owner_admin_id, student_id);

alter table public.trainer_theory_question_progress enable row level security;
alter table public.trainer_theory_tasks enable row level security;
alter table public.trainer_theory_completion_history enable row level security;
revoke all on table public.trainer_theory_question_progress, public.trainer_theory_tasks, public.trainer_theory_completion_history from public, anon, authenticated;
grant select, insert, update, delete on table public.trainer_theory_question_progress, public.trainer_theory_tasks, public.trainer_theory_completion_history to service_role;

create function public.record_theory_answer_atomic(p_student_id uuid, p_assignment_id uuid, p_task_id uuid, p_selected_option integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare a public.trainer_assignments%rowtype; t public.trainer_theory_tasks%rowtype; tr public.trainers%rowtype; q jsonb; is_ok boolean; count_after integer; q_count integer; earned integer;
begin
  if p_selected_option not between 0 and 3 then return jsonb_build_object('status','invalid_answer'); end if;
  select * into a from public.trainer_assignments where id=p_assignment_id and student_id=p_student_id for update;
  if not found then return jsonb_build_object('status','assignment_not_found'); end if;
  select * into tr from public.trainers where id=a.trainer_id and type='THEORY' and status='PUBLISHED' for share;
  if not found then return jsonb_build_object('status','trainer_not_found'); end if;
  select * into t from public.trainer_theory_tasks where id=p_task_id and assignment_id=a.id for update;
  if not found then return jsonb_build_object('status','task_not_found'); end if;
  if t.answered_at is not null then return jsonb_build_object('status','already_answered'); end if;
  select value into q from jsonb_array_elements(tr.definition->'questions') where value->>'key'=t.question_key limit 1;
  if q is null or q->>'fingerprint' is distinct from t.question_fingerprint then
    update public.trainer_theory_tasks set answered_at=now(),selected_option=p_selected_option,is_correct=false where id=t.id;
    return jsonb_build_object('status','stale');
  end if;
  is_ok := (q->>'correctOption')::integer = p_selected_option;
  update public.trainer_theory_tasks set answered_at=now(),selected_option=p_selected_option,is_correct=is_ok where id=t.id;
  if is_ok then
    insert into public.trainer_theory_question_progress(assignment_id,question_key,question_fingerprint,correct_count,last_answered_at)
    values(a.id,t.question_key,t.question_fingerprint,1,now())
    on conflict(assignment_id,question_key) do update set question_fingerprint=excluded.question_fingerprint, correct_count=case when trainer_theory_question_progress.question_fingerprint=excluded.question_fingerprint then least(3,trainer_theory_question_progress.correct_count+1) else 1 end,last_answered_at=now(),updated_at=now()
    returning correct_count into count_after;
  else
    select coalesce(correct_count,0) into count_after from public.trainer_theory_question_progress where assignment_id=a.id and question_key=t.question_key and question_fingerprint=t.question_fingerprint;
    count_after:=coalesce(count_after,0);
  end if;
  q_count:=jsonb_array_length(tr.definition->'questions');
  if q_count<1 then return jsonb_build_object('status','invalid_definition'); end if;
  select coalesce(sum(least(3,coalesce(p.correct_count,0))),0)::integer into earned from jsonb_array_elements(tr.definition->'questions') cq left join public.trainer_theory_question_progress p on p.assignment_id=a.id and p.question_key=cq->>'key' and p.question_fingerprint=cq->>'fingerprint';
  if earned=q_count*3 then
    insert into public.trainer_theory_completion_history(student_id,owner_admin_id,source_trainer_id,title_snapshot,question_count_snapshot,required_points_snapshot,assigned_at)
    values(a.student_id,a.owner_admin_id,tr.id,tr.title,q_count,q_count*3,a.assigned_at) on conflict(student_id,owner_admin_id,source_trainer_id) do nothing;
    delete from public.trainer_assignments where id=a.id;
    return jsonb_build_object('status','recorded','correct',is_ok,'correct_option',(q->>'correctOption')::integer,'explanation',q->>'explanation','question_count',count_after,'earned',earned,'required',q_count*3,'progress_percent',100,'trainer_completed',true);
  end if;
  return jsonb_build_object('status','recorded','correct',is_ok,'correct_option',(q->>'correctOption')::integer,'explanation',q->>'explanation','question_count',count_after,'earned',earned,'required',q_count*3,'progress_percent',round(earned::numeric/(q_count*3)*100),'trainer_completed',false);
end; $$;

create function public.save_theory_trainer_atomic(p_owner_admin_id uuid,p_trainer_id uuid,p_expected_revision integer,p_title text,p_definition jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare tr public.trainers%rowtype; a public.trainer_assignments%rowtype; q_count integer; earned integer;
begin
  select * into tr from public.trainers where id=p_trainer_id and owner_admin_id=p_owner_admin_id and type='THEORY' for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if tr.content_revision<>p_expected_revision then return jsonb_build_object('status','stale'); end if;
  if jsonb_typeof(p_definition)<>'object' or jsonb_typeof(p_definition->'questions')<>'array' or jsonb_array_length(p_definition->'questions')<1 then return jsonb_build_object('status','invalid'); end if;
  update public.trainers set title=p_title,definition=p_definition,content_revision=content_revision+1,updated_at=now() where id=tr.id;
  delete from public.trainer_theory_question_progress p using public.trainer_assignments x
  where p.assignment_id=x.id and x.trainer_id=tr.id and not exists(select 1 from jsonb_array_elements(p_definition->'questions') nq where nq->>'key'=p.question_key and nq->>'fingerprint'=p.question_fingerprint);
  q_count:=jsonb_array_length(p_definition->'questions');
  for a in select * from public.trainer_assignments where trainer_id=tr.id for update loop
    select coalesce(sum(least(3,coalesce(p.correct_count,0))),0)::integer into earned from jsonb_array_elements(p_definition->'questions') q left join public.trainer_theory_question_progress p on p.assignment_id=a.id and p.question_key=q->>'key' and p.question_fingerprint=q->>'fingerprint';
    if earned=q_count*3 then
      insert into public.trainer_theory_completion_history(student_id,owner_admin_id,source_trainer_id,title_snapshot,question_count_snapshot,required_points_snapshot,assigned_at)
      values(a.student_id,a.owner_admin_id,tr.id,p_title,q_count,q_count*3,a.assigned_at) on conflict(student_id,owner_admin_id,source_trainer_id) do nothing;
      delete from public.trainer_assignments where id=a.id;
    end if;
  end loop;
  return jsonb_build_object('status','saved','content_revision',p_expected_revision+1);
end; $$;

create function public.get_theory_student_summary(p_student_id uuid,p_owner_admin_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public,pg_temp stable as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.sort_at desc),'[]'::jsonb) from (
    select 'ACTIVE'::text kind,a.id assignment_id,t.id source_trainer_id,t.title,a.assigned_at sort_at,null::timestamptz completed_at,
      jsonb_array_length(t.definition->'questions') question_count,
      coalesce((select sum(least(3,coalesce(p.correct_count,0))) from jsonb_array_elements(t.definition->'questions') q left join public.trainer_theory_question_progress p on p.assignment_id=a.id and p.question_key=q->>'key' and p.question_fingerprint=q->>'fingerprint'),0)::integer earned
    from public.trainer_assignments a join public.trainers t on t.id=a.trainer_id and t.type='THEORY' and t.status='PUBLISHED'
    where a.student_id=p_student_id and (p_owner_admin_id is null or a.owner_admin_id=p_owner_admin_id)
    union all
    select 'COMPLETED',null,h.source_trainer_id,h.title_snapshot,coalesce(h.assigned_at,h.completed_at),h.completed_at,h.question_count_snapshot,h.required_points_snapshot
    from public.trainer_theory_completion_history h where h.student_id=p_student_id and (p_owner_admin_id is null or h.owner_admin_id=p_owner_admin_id)
  ) s;
$$;

create function public.notify_theory_completed_v1() returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare n text; begin select coalesce(nullif(btrim(full_name),''),email,'Ученик') into n from public.profiles where id=new.student_id; perform public.insert_notification_v1(new.owner_admin_id,'TRAINER_COMPLETED',n||' завершил тренажёр',new.title_snapshot,'/admin/students/'||new.student_id::text||'?tab=trainers','THEORY_COMPLETED:'||new.id::text); return new; end; $$;
create trigger notifications_theory_completed_v1 after insert on public.trainer_theory_completion_history for each row execute function public.notify_theory_completed_v1();

revoke all on function public.record_theory_answer_atomic(uuid,uuid,uuid,integer), public.save_theory_trainer_atomic(uuid,uuid,integer,text,jsonb), public.get_theory_student_summary(uuid,uuid), public.notify_theory_completed_v1() from public,anon,authenticated;
grant execute on function public.record_theory_answer_atomic(uuid,uuid,uuid,integer), public.save_theory_trainer_atomic(uuid,uuid,integer,text,jsonb), public.get_theory_student_summary(uuid,uuid) to service_role;

commit;
