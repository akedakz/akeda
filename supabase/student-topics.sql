create table if not exists public.topic_templates (
  id uuid primary key default gen_random_uuid(), title text not null check (length(btrim(title)) between 1 and 150),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists topic_templates_creator_title_unique on public.topic_templates(created_by, lower(btrim(title)));

create table if not exists public.topic_template_items (
  id uuid primary key default gen_random_uuid(), template_id uuid not null references public.topic_templates(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200), sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists topic_template_items_order_idx on public.topic_template_items(template_id, sort_order);

create table if not exists public.student_topics (
  id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200), sort_order integer not null check (sort_order >= 0), completed_at timestamptz null,
  source_template_id uuid null references public.topic_templates(id) on delete set null,
  source_template_item_id uuid null references public.topic_template_items(id) on delete set null,
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists student_topics_order_idx on public.student_topics(student_id, sort_order);
alter table public.topic_templates enable row level security; alter table public.topic_template_items enable row level security; alter table public.student_topics enable row level security;
grant all on public.topic_templates, public.topic_template_items, public.student_topics to service_role;

create or replace function public.reorder_student_topics(p_student_id uuid,p_ids uuid[]) returns void language plpgsql security definer set search_path=public as $$
begin
  if cardinality(p_ids)<>(select count(*) from student_topics where student_id=p_student_id) or exists(select 1 from unnest(p_ids) id left join student_topics t on t.id=id and t.student_id=p_student_id where t.id is null) then raise exception 'invalid topic set'; end if;
  update student_topics set sort_order=sort_order+100000 where student_id=p_student_id;
  update student_topics t set sort_order=x.ord-1,updated_at=now() from unnest(p_ids) with ordinality x(id,ord) where t.id=x.id and t.student_id=p_student_id;
end;$$;
create or replace function public.reorder_topic_template_items(p_template_id uuid,p_ids uuid[]) returns void language plpgsql security definer set search_path=public as $$
begin
  if cardinality(p_ids)<>(select count(*) from topic_template_items where template_id=p_template_id) or exists(select 1 from unnest(p_ids) id left join topic_template_items t on t.id=id and t.template_id=p_template_id where t.id is null) then raise exception 'invalid item set'; end if;
  update topic_template_items set sort_order=sort_order+100000 where template_id=p_template_id;
  update topic_template_items t set sort_order=x.ord-1,updated_at=now() from unnest(p_ids) with ordinality x(id,ord) where t.id=x.id and t.template_id=p_template_id;
  update topic_templates set updated_at=now() where id=p_template_id;
end;$$;
create or replace function public.create_template_from_student(p_student_id uuid,p_title text,p_created_by uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; begin if not exists(select 1 from student_topics where student_id=p_student_id) then raise exception 'empty plan'; end if;
  insert into topic_templates(title,created_by) values(btrim(p_title),p_created_by) returning id into v_id;
  insert into topic_template_items(template_id,title,sort_order) select v_id,title,row_number() over(order by sort_order,id)-1 from student_topics where student_id=p_student_id order by sort_order,id; return v_id; end;$$;
create or replace function public.apply_topic_template(p_student_id uuid,p_template_id uuid,p_mode text,p_created_by uuid) returns void language plpgsql security definer set search_path=public as $$
declare v_start integer; begin if p_mode not in('replace','append') then raise exception 'invalid mode'; end if; if not exists(select 1 from topic_templates where id=p_template_id) then raise exception 'missing template'; end if;
  if p_mode='replace' then delete from student_topics where student_id=p_student_id; v_start:=0; else select coalesce(max(sort_order)+1,0) into v_start from student_topics where student_id=p_student_id; end if;
  insert into student_topics(student_id,title,sort_order,source_template_id,source_template_item_id,created_by)
    select p_student_id,i.title,v_start+row_number() over(order by i.sort_order,i.id)-1,p_template_id,i.id,p_created_by from topic_template_items i where i.template_id=p_template_id order by i.sort_order,i.id;
end;$$;
revoke all on function public.reorder_student_topics(uuid,uuid[]), public.reorder_topic_template_items(uuid,uuid[]), public.create_template_from_student(uuid,text,uuid), public.apply_topic_template(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.reorder_student_topics(uuid,uuid[]), public.reorder_topic_template_items(uuid,uuid[]), public.create_template_from_student(uuid,text,uuid), public.apply_topic_template(uuid,uuid,text,uuid) to service_role;
