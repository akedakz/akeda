begin;

create table public.formula_recall_student_formulas (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  formula_id uuid not null references public.formula_recall_formulas(id) on delete cascade,
  clean_recall_count smallint not null default 0 check (clean_recall_count between 0 and 3),
  target_content_revision integer not null check (target_content_revision > 0),
  target_canonical_expression text not null check (char_length(target_canonical_expression) between 1 and 4000),
  last_condition_id uuid references public.formula_recall_conditions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, formula_id),
  unique (id, student_id),
  foreign key (formula_id, owner_admin_id) references public.formula_recall_formulas(id, owner_admin_id) on delete cascade
);
create index formula_recall_student_formulas_owner_student_idx on public.formula_recall_student_formulas(owner_admin_id, student_id);

create table public.formula_recall_student_state (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  completed_sequence bigint not null default 0 check (completed_sequence >= 0),
  last_formula_id uuid,
  updated_at timestamptz not null default now()
);

create table public.formula_recall_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  student_formula_id uuid not null,
  formula_id uuid not null references public.formula_recall_formulas(id) on delete cascade,
  condition_id uuid references public.formula_recall_conditions(id) on delete set null,
  condition_text_snapshot text not null check (char_length(condition_text_snapshot) between 1 and 500),
  canonical_expression_snapshot text not null check (char_length(canonical_expression_snapshot) between 1 and 4000),
  alternative_expressions_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(alternative_expressions_snapshot) = 'array'),
  formula_content_revision_snapshot integer not null check (formula_content_revision_snapshot > 0),
  topic_id_snapshot uuid,
  topic_title_snapshot text not null check (char_length(topic_title_snapshot) between 1 and 120),
  practice_topic_id uuid,
  state text not null default 'AWAITING_ANSWER' check (state in ('AWAITING_ANSWER','REVEALED','RETRY_AFTER_HINT','CORRECT_CLEAN','CORRECT_HINTED','DONE')),
  hinted boolean not null default false,
  credit_awarded boolean not null default false,
  issued_sequence bigint not null check (issued_sequence > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (student_formula_id, student_id) references public.formula_recall_student_formulas(id, student_id) on delete cascade,
  foreign key (formula_id, owner_admin_id) references public.formula_recall_formulas(id, owner_admin_id) on delete cascade
);
create unique index formula_recall_tasks_one_active_student_idx on public.formula_recall_tasks(student_id)
  where state <> 'DONE';
create index formula_recall_tasks_student_created_idx on public.formula_recall_tasks(student_id, created_at desc);

create table public.formula_recall_retries (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  student_formula_id uuid not null unique,
  formula_id uuid not null references public.formula_recall_formulas(id) on delete cascade,
  condition_id uuid references public.formula_recall_conditions(id) on delete set null,
  condition_text_snapshot text not null check (char_length(condition_text_snapshot) between 1 and 500),
  target_content_revision integer not null check (target_content_revision > 0),
  target_canonical_expression text not null check (char_length(target_canonical_expression) between 1 and 4000),
  eligible_after_sequence bigint not null check (eligible_after_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_formula_id, student_id) references public.formula_recall_student_formulas(id, student_id) on delete cascade,
  foreign key (formula_id, owner_admin_id) references public.formula_recall_formulas(id, owner_admin_id) on delete cascade
);
create index formula_recall_retries_student_due_idx on public.formula_recall_retries(student_id, eligible_after_sequence);

alter table public.formula_recall_student_formulas enable row level security;
alter table public.formula_recall_student_state enable row level security;
alter table public.formula_recall_tasks enable row level security;
alter table public.formula_recall_retries enable row level security;
revoke all on table public.formula_recall_student_formulas, public.formula_recall_student_state, public.formula_recall_tasks, public.formula_recall_retries from public, anon, authenticated;
grant select, insert, update, delete on table public.formula_recall_student_formulas, public.formula_recall_student_state, public.formula_recall_tasks, public.formula_recall_retries to service_role;

create function public.assign_formula_recall_formulas_atomic(p_owner_admin_id uuid, p_student_id uuid, p_formula_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare requested_count integer; inserted_count integer;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN')
     or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','forbidden'); end if;
  if p_formula_ids is null or cardinality(p_formula_ids)<1 or cardinality(p_formula_ids)>500 then return jsonb_build_object('status','invalid'); end if;
  select count(distinct requested.id) into requested_count from unnest(p_formula_ids) as requested(id);
  if requested_count<>cardinality(p_formula_ids) or requested_count<>(select count(*) from public.formula_recall_formulas where owner_admin_id=p_owner_admin_id and id=any(p_formula_ids)) then return jsonb_build_object('status','invalid_formula'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-assign',8404));
  insert into public.formula_recall_student_formulas(owner_admin_id,student_id,formula_id,target_content_revision,target_canonical_expression)
  select p_owner_admin_id,p_student_id,f.id,f.content_revision,f.canonical_expression from public.formula_recall_formulas f where f.owner_admin_id=p_owner_admin_id and f.id=any(p_formula_ids)
  on conflict(student_id,formula_id) do nothing;
  get diagnostics inserted_count=row_count;
  insert into public.formula_recall_student_state(student_id) values(p_student_id) on conflict do nothing;
  return jsonb_build_object('status','assigned','inserted',inserted_count);
end; $$;

create function public.unassign_formula_recall_formula_atomic(p_owner_admin_id uuid, p_student_id uuid, p_student_formula_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare assignment_meta public.formula_recall_student_formulas; locked_assignment public.formula_recall_student_formulas;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  select * into assignment_meta from public.formula_recall_student_formulas where id=p_student_formula_id and student_id=p_student_id and owner_admin_id=p_owner_admin_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-runtime',8404));
  perform 1 from public.formula_recall_formulas where id=assignment_meta.formula_id and owner_admin_id=p_owner_admin_id for share;
  if not found then return jsonb_build_object('status','not_found'); end if;
  select * into locked_assignment from public.formula_recall_student_formulas
  where id=p_student_formula_id and student_id=p_student_id and owner_admin_id=p_owner_admin_id and formula_id=assignment_meta.formula_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform 1 from public.formula_recall_tasks where student_formula_id=locked_assignment.id order by id for update;
  perform 1 from public.formula_recall_retries where student_formula_id=locked_assignment.id for update;
  delete from public.formula_recall_student_formulas where id=locked_assignment.id;
  return jsonb_build_object('status','unassigned');
end; $$;

create function public.issue_formula_recall_task_atomic(p_student_id uuid, p_topic_id uuid default null, p_advance boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  runtime public.formula_recall_student_state; active public.formula_recall_tasks; picked_assignment public.formula_recall_student_formulas;
  picked_retry public.formula_recall_retries; picked_formula public.formula_recall_formulas; picked_condition public.formula_recall_conditions;
  condition_text_value text; condition_id_value uuid; alternatives_value jsonb; topic_title_value text; next_sequence bigint;
begin
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','forbidden'); end if;
  if p_advance is null then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-runtime',8404));
  insert into public.formula_recall_student_state(student_id) values(p_student_id) on conflict do nothing;
  select * into active from public.formula_recall_tasks where student_id=p_student_id and state<>'DONE';
  if found then
    perform 1 from public.formula_recall_formulas where id=active.formula_id and owner_admin_id=active.owner_admin_id for share;
    if not found then return jsonb_build_object('status','unavailable'); end if;
    select * into picked_assignment from public.formula_recall_student_formulas
    where id=active.student_formula_id and student_id=p_student_id and formula_id=active.formula_id for update;
    if not found then return jsonb_build_object('status','unavailable'); end if;
    select * into active from public.formula_recall_tasks
    where id=active.id and student_id=p_student_id and student_formula_id=picked_assignment.id and formula_id=picked_assignment.formula_id and state<>'DONE' for update;
    if not found then return jsonb_build_object('status','unavailable'); end if;
    select * into runtime from public.formula_recall_student_state where student_id=p_student_id for update;
    if p_advance and active.state in ('CORRECT_CLEAN','CORRECT_HINTED') then
      update public.formula_recall_tasks set state='DONE',completed_at=now(),updated_at=now() where id=active.id;
      update public.formula_recall_student_state set completed_sequence=completed_sequence+1,last_formula_id=active.formula_id,updated_at=now() where student_id=p_student_id returning * into runtime;
    else return jsonb_build_object('status','resumed','task_id',active.id); end if;
  else
    select * into runtime from public.formula_recall_student_state where student_id=p_student_id for update;
  end if;

  select r.* into picked_retry from public.formula_recall_retries r
  join public.formula_recall_student_formulas sf on sf.id=r.student_formula_id
  join public.formula_recall_formulas f on f.id=sf.formula_id
  where r.student_id=p_student_id and r.target_canonical_expression=sf.target_canonical_expression
    and (p_topic_id is null or f.topic_id=p_topic_id) and r.eligible_after_sequence<=runtime.completed_sequence
  order by random() limit 1;

  if picked_retry.id is not null then select * into picked_assignment from public.formula_recall_student_formulas where id=picked_retry.student_formula_id;
  else
    select sf.* into picked_assignment from public.formula_recall_student_formulas sf
    join public.formula_recall_formulas f on f.id=sf.formula_id
    where sf.student_id=p_student_id and sf.clean_recall_count<3 and (p_topic_id is null or f.topic_id=p_topic_id)
      and not exists(select 1 from public.formula_recall_retries r where r.student_formula_id=sf.id)
    order by (sf.formula_id=runtime.last_formula_id),random() limit 1;
    if picked_assignment.id is null then
      select r.* into picked_retry from public.formula_recall_retries r
      join public.formula_recall_student_formulas sf on sf.id=r.student_formula_id
      join public.formula_recall_formulas f on f.id=sf.formula_id
      where r.student_id=p_student_id and r.target_canonical_expression=sf.target_canonical_expression and (p_topic_id is null or f.topic_id=p_topic_id)
      order by random() limit 1;
      if picked_retry.id is not null then select * into picked_assignment from public.formula_recall_student_formulas where id=picked_retry.student_formula_id; end if;
    end if;
  end if;
  if picked_assignment.id is null then
    if exists(select 1 from public.formula_recall_student_formulas where student_id=p_student_id) then return jsonb_build_object('status','complete'); end if;
    return jsonb_build_object('status','empty');
  end if;

  select * into picked_formula from public.formula_recall_formulas where id=picked_assignment.formula_id and owner_admin_id=picked_assignment.owner_admin_id for share;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  select * into picked_assignment from public.formula_recall_student_formulas
  where id=picked_assignment.id and student_id=p_student_id and formula_id=picked_formula.id and owner_admin_id=picked_formula.owner_admin_id for update;
  if not found then return jsonb_build_object('status','unavailable'); end if;
  if picked_retry.id is not null then
    select * into picked_retry from public.formula_recall_retries
    where id=picked_retry.id and student_id=p_student_id and student_formula_id=picked_assignment.id
      and formula_id=picked_formula.id and target_canonical_expression=picked_assignment.target_canonical_expression for update;
    if not found then return jsonb_build_object('status','unavailable'); end if;
  end if;
  if picked_retry.id is not null then condition_id_value:=picked_retry.condition_id; condition_text_value:=picked_retry.condition_text_snapshot;
  else
    select c.* into picked_condition from public.formula_recall_conditions c where c.formula_id=picked_formula.id
      order by (c.id=picked_assignment.last_condition_id),random() limit 1;
    if picked_condition.id is null then return jsonb_build_object('status','unavailable'); end if;
    condition_id_value:=picked_condition.id; condition_text_value:=picked_condition.text;
  end if;
  select coalesce(jsonb_agg(a.expression order by a.sort_order),'[]'::jsonb) into alternatives_value from public.formula_recall_alternatives a where a.formula_id=picked_formula.id;
  select title into topic_title_value from public.formula_recall_topics where id=picked_formula.topic_id;
  select coalesce(max(issued_sequence),0)+1 into next_sequence from public.formula_recall_tasks where student_id=p_student_id;
  insert into public.formula_recall_tasks(owner_admin_id,student_id,student_formula_id,formula_id,condition_id,condition_text_snapshot,canonical_expression_snapshot,alternative_expressions_snapshot,formula_content_revision_snapshot,topic_id_snapshot,topic_title_snapshot,practice_topic_id,issued_sequence)
  values(picked_assignment.owner_admin_id,p_student_id,picked_assignment.id,picked_formula.id,condition_id_value,condition_text_value,picked_formula.canonical_expression,alternatives_value,picked_formula.content_revision,picked_formula.topic_id,topic_title_value,p_topic_id,next_sequence) returning * into active;
  update public.formula_recall_student_formulas set last_condition_id=condition_id_value,updated_at=now() where id=picked_assignment.id;
  if picked_retry.id is not null then delete from public.formula_recall_retries where id=picked_retry.id; end if;
  return jsonb_build_object('status','issued','task_id',active.id);
end; $$;

create function public.submit_formula_recall_answer_atomic(p_student_id uuid, p_task_id uuid, p_is_correct boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare task_meta public.formula_recall_tasks; task public.formula_recall_tasks; assigned public.formula_recall_student_formulas; runtime public.formula_recall_student_state; awarded boolean:=false;
begin
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','forbidden'); end if;
  if p_is_correct is null then return jsonb_build_object('status','invalid'); end if;
  select * into task_meta from public.formula_recall_tasks where id=p_task_id and student_id=p_student_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-runtime',8404));
  perform 1 from public.formula_recall_formulas where id=task_meta.formula_id and owner_admin_id=task_meta.owner_admin_id for share;
  if not found then return jsonb_build_object('status','unassigned'); end if;
  select * into assigned from public.formula_recall_student_formulas
  where id=task_meta.student_formula_id and student_id=p_student_id and formula_id=task_meta.formula_id and owner_admin_id=task_meta.owner_admin_id for update;
  if not found then return jsonb_build_object('status','unassigned'); end if;
  select * into task from public.formula_recall_tasks
  where id=p_task_id and student_id=p_student_id and student_formula_id=assigned.id and formula_id=assigned.formula_id and owner_admin_id=assigned.owner_admin_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if task.state in ('CORRECT_CLEAN','CORRECT_HINTED') then return jsonb_build_object('status','already_completed','state',task.state,'credit_awarded',task.credit_awarded); end if;
  if task.state='REVEALED' and not p_is_correct then return jsonb_build_object('status','already_revealed','state',task.state); end if;
  if task.state not in ('AWAITING_ANSWER','RETRY_AFTER_HINT') then return jsonb_build_object('status','invalid_state','state',task.state); end if;
  select * into runtime from public.formula_recall_student_state where student_id=p_student_id for update;
  if not p_is_correct then
    update public.formula_recall_tasks set state='REVEALED',hinted=true,updated_at=now() where id=task.id;
    if task.canonical_expression_snapshot=assigned.target_canonical_expression then
      insert into public.formula_recall_retries(owner_admin_id,student_id,student_formula_id,formula_id,condition_id,condition_text_snapshot,target_content_revision,target_canonical_expression,eligible_after_sequence)
      values(task.owner_admin_id,p_student_id,assigned.id,task.formula_id,task.condition_id,task.condition_text_snapshot,assigned.target_content_revision,assigned.target_canonical_expression,runtime.completed_sequence+4)
      on conflict(student_formula_id) do update set condition_id=excluded.condition_id,condition_text_snapshot=excluded.condition_text_snapshot,target_content_revision=excluded.target_content_revision,target_canonical_expression=excluded.target_canonical_expression,eligible_after_sequence=excluded.eligible_after_sequence,updated_at=now();
    end if;
    return jsonb_build_object('status','revealed','state','REVEALED');
  end if;
  if task.state='AWAITING_ANSWER' and not task.hinted and not task.credit_awarded and task.canonical_expression_snapshot=assigned.target_canonical_expression then
    update public.formula_recall_student_formulas set clean_recall_count=least(3,clean_recall_count+1),updated_at=now() where id=assigned.id;
    awarded:=true;
  end if;
  update public.formula_recall_tasks set state=case when task.hinted or task.state='RETRY_AFTER_HINT' or task.canonical_expression_snapshot<>assigned.target_canonical_expression then 'CORRECT_HINTED' else 'CORRECT_CLEAN' end,
    credit_awarded=awarded,updated_at=now() where id=task.id;
  return jsonb_build_object('status','correct','state',case when task.hinted or task.state='RETRY_AFTER_HINT' or task.canonical_expression_snapshot<>assigned.target_canonical_expression then 'CORRECT_HINTED' else 'CORRECT_CLEAN' end,'credit_awarded',awarded);
end; $$;

create function public.acknowledge_formula_recall_hint_atomic(p_student_id uuid, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then return jsonb_build_object('status','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-runtime',8404));
  if exists(select 1 from public.formula_recall_tasks where id=p_task_id and student_id=p_student_id and state='RETRY_AFTER_HINT') then return jsonb_build_object('status','already_acknowledged'); end if;
  update public.formula_recall_tasks set state='RETRY_AFTER_HINT',hinted=true,updated_at=now()
  where id=p_task_id and student_id=p_student_id and state='REVEALED';
  if not found then return jsonb_build_object('status','invalid_state'); end if;
  return jsonb_build_object('status','acknowledged');
end; $$;

create function public.protect_formula_recall_task_snapshot()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.owner_admin_id is distinct from old.owner_admin_id or new.student_id is distinct from old.student_id
     or new.student_formula_id is distinct from old.student_formula_id or new.formula_id is distinct from old.formula_id
     or new.condition_text_snapshot is distinct from old.condition_text_snapshot
     or (new.condition_id is distinct from old.condition_id and not (old.condition_id is not null and new.condition_id is null))
     or new.canonical_expression_snapshot is distinct from old.canonical_expression_snapshot
     or new.alternative_expressions_snapshot is distinct from old.alternative_expressions_snapshot
     or new.formula_content_revision_snapshot is distinct from old.formula_content_revision_snapshot
     or new.topic_id_snapshot is distinct from old.topic_id_snapshot or new.topic_title_snapshot is distinct from old.topic_title_snapshot
     or new.practice_topic_id is distinct from old.practice_topic_id or new.issued_sequence is distinct from old.issued_sequence
  then raise exception 'formula recall task snapshot is immutable'; end if;
  return new;
end; $$;
create trigger formula_recall_task_snapshot_immutable before update on public.formula_recall_tasks
for each row execute function public.protect_formula_recall_task_snapshot();

create function public.protect_formula_recall_retry_condition_snapshot()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.condition_text_snapshot is distinct from old.condition_text_snapshot
     or (new.condition_id is distinct from old.condition_id and not (old.condition_id is not null and new.condition_id is null))
  then raise exception 'formula recall retry condition snapshot is immutable'; end if;
  return new;
end; $$;
create trigger formula_recall_retry_condition_snapshot_immutable before update on public.formula_recall_retries
for each row execute function public.protect_formula_recall_retry_condition_snapshot();

create function public.reset_formula_recall_mastery_on_canonical_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.canonical_expression is distinct from old.canonical_expression then
    update public.formula_recall_student_formulas set clean_recall_count=0,target_content_revision=new.content_revision,target_canonical_expression=new.canonical_expression,updated_at=now() where formula_id=new.id;
    delete from public.formula_recall_retries where formula_id=new.id;
  end if;
  return new;
end; $$;
create trigger formula_recall_canonical_change_reset after update of canonical_expression on public.formula_recall_formulas
for each row execute function public.reset_formula_recall_mastery_on_canonical_change();

revoke all on function public.assign_formula_recall_formulas_atomic(uuid,uuid,uuid[]), public.unassign_formula_recall_formula_atomic(uuid,uuid,uuid), public.issue_formula_recall_task_atomic(uuid,uuid,boolean), public.submit_formula_recall_answer_atomic(uuid,uuid,boolean), public.acknowledge_formula_recall_hint_atomic(uuid,uuid), public.protect_formula_recall_task_snapshot(), public.protect_formula_recall_retry_condition_snapshot(), public.reset_formula_recall_mastery_on_canonical_change() from public,anon,authenticated;
grant execute on function public.assign_formula_recall_formulas_atomic(uuid,uuid,uuid[]), public.unassign_formula_recall_formula_atomic(uuid,uuid,uuid), public.issue_formula_recall_task_atomic(uuid,uuid,boolean), public.submit_formula_recall_answer_atomic(uuid,uuid,boolean), public.acknowledge_formula_recall_hint_atomic(uuid,uuid) to service_role;

commit;
