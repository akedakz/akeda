begin;

create table public.formula_recall_topics (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 120),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_admin_id)
);
create unique index formula_recall_topics_owner_title_key on public.formula_recall_topics(owner_admin_id, lower(title));
create unique index formula_recall_topics_owner_sort_key on public.formula_recall_topics(owner_admin_id, sort_order);

create table public.formula_recall_formulas (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id uuid not null references public.profiles(id) on delete restrict,
  topic_id uuid not null,
  canonical_expression text not null check (canonical_expression = btrim(canonical_expression) and char_length(canonical_expression) between 1 and 4000),
  sort_order integer not null check (sort_order >= 0),
  content_revision integer not null default 1 check (content_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (topic_id, owner_admin_id) references public.formula_recall_topics(id, owner_admin_id) on delete restrict,
  unique (id, owner_admin_id)
);
create index formula_recall_formulas_topic_sort_idx on public.formula_recall_formulas(owner_admin_id, topic_id, sort_order);

create table public.formula_recall_conditions (
  id uuid primary key default gen_random_uuid(),
  formula_id uuid not null references public.formula_recall_formulas(id) on delete cascade,
  text text not null check (text = btrim(text) and char_length(text) between 1 and 500),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (formula_id, sort_order)
);

create table public.formula_recall_alternatives (
  id uuid primary key default gen_random_uuid(),
  formula_id uuid not null references public.formula_recall_formulas(id) on delete cascade,
  expression text not null check (expression = btrim(expression) and char_length(expression) between 1 and 4000),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (formula_id, sort_order),
  unique (formula_id, expression)
);

alter table public.formula_recall_topics enable row level security;
alter table public.formula_recall_formulas enable row level security;
alter table public.formula_recall_conditions enable row level security;
alter table public.formula_recall_alternatives enable row level security;
revoke all on table public.formula_recall_topics, public.formula_recall_formulas, public.formula_recall_conditions, public.formula_recall_alternatives from public, anon, authenticated;
grant select, insert, update, delete on table public.formula_recall_topics, public.formula_recall_formulas, public.formula_recall_conditions, public.formula_recall_alternatives to service_role;

create function public.create_formula_recall_topic_atomic(p_owner_admin_id uuid, p_title text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare normalized text:=btrim(p_title); created_id uuid;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  if normalized='' or char_length(normalized)>120 then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':formula-recall-topics',8202));
  insert into public.formula_recall_topics(owner_admin_id,title,sort_order)
  values(p_owner_admin_id,normalized,coalesce((select max(sort_order)+1 from public.formula_recall_topics where owner_admin_id=p_owner_admin_id),0)) returning id into created_id;
  return jsonb_build_object('status','created','id',created_id);
exception when unique_violation then return jsonb_build_object('status','duplicate');
end; $$;

create function public.rename_formula_recall_topic_atomic(p_owner_admin_id uuid, p_topic_id uuid, p_title text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare normalized text:=btrim(p_title);
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  if normalized='' or char_length(normalized)>120 then return jsonb_build_object('status','invalid'); end if;
  update public.formula_recall_topics set title=normalized,updated_at=now() where id=p_topic_id and owner_admin_id=p_owner_admin_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','renamed');
exception when unique_violation then return jsonb_build_object('status','duplicate');
end; $$;

create function public.delete_formula_recall_topic_atomic(p_owner_admin_id uuid, p_topic_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  perform 1 from public.formula_recall_topics where id=p_topic_id and owner_admin_id=p_owner_admin_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if exists(select 1 from public.formula_recall_formulas where owner_admin_id=p_owner_admin_id and topic_id=p_topic_id) then return jsonb_build_object('status','not_empty'); end if;
  delete from public.formula_recall_topics where id=p_topic_id and owner_admin_id=p_owner_admin_id;
  return jsonb_build_object('status','deleted');
end; $$;

create function public.save_formula_recall_formula_atomic(
  p_owner_admin_id uuid, p_formula_id uuid, p_topic_id uuid, p_expected_revision integer,
  p_canonical_expression text, p_conditions jsonb, p_alternatives jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  formula_row public.formula_recall_formulas; formula_id_value uuid; canonical text:=btrim(p_canonical_expression);
  item jsonb; item_id uuid; item_text text; item_order integer; next_revision integer;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  if canonical='' or char_length(canonical)>4000 or coalesce(jsonb_typeof(p_conditions),'null')<>'array' or jsonb_array_length(p_conditions)<1 or jsonb_array_length(p_conditions)>30 or coalesce(jsonb_typeof(p_alternatives),'null')<>'array' or jsonb_array_length(p_alternatives)>20 then return jsonb_build_object('status','invalid'); end if;
  perform 1 from public.formula_recall_topics where id=p_topic_id and owner_admin_id=p_owner_admin_id for update;
  if not found then return jsonb_build_object('status','topic_not_found'); end if;

  for item in select value from jsonb_array_elements(p_conditions) loop
    item_id:=(item->>'id')::uuid; item_text:=btrim(item->>'text');
    if item_text is null or item_text='' or char_length(item_text)>500 then return jsonb_build_object('status','invalid'); end if;
    if exists(select 1 from public.formula_recall_conditions where id=item_id and formula_id<>coalesce(p_formula_id,'00000000-0000-0000-0000-000000000000'::uuid)) then return jsonb_build_object('status','invalid_child'); end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_conditions))<>(select count(distinct value->>'id') from jsonb_array_elements(p_conditions)) then return jsonb_build_object('status','invalid_child'); end if;
  for item in select value from jsonb_array_elements(p_alternatives) loop
    item_id:=(item->>'id')::uuid; item_text:=btrim(item->>'expression');
    if item_text is null or item_text='' or char_length(item_text)>4000 or item_text=canonical then return jsonb_build_object('status','duplicate_expression'); end if;
    if exists(select 1 from public.formula_recall_alternatives where id=item_id and formula_id<>coalesce(p_formula_id,'00000000-0000-0000-0000-000000000000'::uuid)) then return jsonb_build_object('status','invalid_child'); end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_alternatives))<>(select count(distinct value->>'id') from jsonb_array_elements(p_alternatives)) or (select count(*) from jsonb_array_elements(p_alternatives))<>(select count(distinct btrim(value->>'expression')) from jsonb_array_elements(p_alternatives)) then return jsonb_build_object('status','duplicate_expression'); end if;

  if p_formula_id is null then
    if p_expected_revision is not null then return jsonb_build_object('status','invalid'); end if;
    perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':'||p_topic_id::text||':formula-recall-formulas',8202));
    insert into public.formula_recall_formulas(owner_admin_id,topic_id,canonical_expression,sort_order)
    values(p_owner_admin_id,p_topic_id,canonical,coalesce((select max(sort_order)+1 from public.formula_recall_formulas where owner_admin_id=p_owner_admin_id and topic_id=p_topic_id),0)) returning * into formula_row;
  else
    select * into formula_row from public.formula_recall_formulas where id=p_formula_id and owner_admin_id=p_owner_admin_id for update;
    if not found then return jsonb_build_object('status','not_found'); end if;
    if p_expected_revision is null or formula_row.content_revision<>p_expected_revision then return jsonb_build_object('status','stale'); end if;
    perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':'||p_topic_id::text||':formula-recall-formulas',8202));
    update public.formula_recall_formulas set topic_id=p_topic_id,canonical_expression=canonical,
      sort_order=case when topic_id<>p_topic_id then coalesce((select max(f.sort_order)+1 from public.formula_recall_formulas f where f.owner_admin_id=p_owner_admin_id and f.topic_id=p_topic_id),0) else sort_order end,
      content_revision=content_revision+1,updated_at=now() where id=formula_row.id returning * into formula_row;
  end if;
  formula_id_value:=formula_row.id; next_revision:=formula_row.content_revision;

  update public.formula_recall_conditions set sort_order=sort_order+1000 where formula_id=formula_id_value;
  delete from public.formula_recall_conditions c where c.formula_id=formula_id_value and not exists(select 1 from jsonb_array_elements(p_conditions) x where (x->>'id')::uuid=c.id);
  item_order:=0;
  for item in select value from jsonb_array_elements(p_conditions) loop
    insert into public.formula_recall_conditions(id,formula_id,text,sort_order) values((item->>'id')::uuid,formula_id_value,btrim(item->>'text'),item_order)
    on conflict(id) do update set text=excluded.text,sort_order=excluded.sort_order,updated_at=now(); item_order:=item_order+1;
  end loop;
  update public.formula_recall_alternatives set sort_order=sort_order+1000 where formula_id=formula_id_value;
  delete from public.formula_recall_alternatives a where a.formula_id=formula_id_value and not exists(select 1 from jsonb_array_elements(p_alternatives) x where (x->>'id')::uuid=a.id);
  item_order:=0;
  for item in select value from jsonb_array_elements(p_alternatives) loop
    insert into public.formula_recall_alternatives(id,formula_id,expression,sort_order) values((item->>'id')::uuid,formula_id_value,btrim(item->>'expression'),item_order)
    on conflict(id) do update set expression=excluded.expression,sort_order=excluded.sort_order,updated_at=now(); item_order:=item_order+1;
  end loop;
  return jsonb_build_object('status','saved','formula_id',formula_id_value,'content_revision',next_revision);
exception when invalid_text_representation then return jsonb_build_object('status','invalid_child');
end; $$;

create function public.delete_formula_recall_formula_atomic(p_owner_admin_id uuid, p_formula_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  delete from public.formula_recall_formulas where id=p_formula_id and owner_admin_id=p_owner_admin_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','deleted');
end; $$;

revoke all on function public.create_formula_recall_topic_atomic(uuid,text), public.rename_formula_recall_topic_atomic(uuid,uuid,text), public.delete_formula_recall_topic_atomic(uuid,uuid), public.save_formula_recall_formula_atomic(uuid,uuid,uuid,integer,text,jsonb,jsonb), public.delete_formula_recall_formula_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_formula_recall_topic_atomic(uuid,text), public.rename_formula_recall_topic_atomic(uuid,uuid,text), public.delete_formula_recall_topic_atomic(uuid,uuid), public.save_formula_recall_formula_atomic(uuid,uuid,uuid,integer,text,jsonb,jsonb), public.delete_formula_recall_formula_atomic(uuid,uuid) to service_role;

commit;
