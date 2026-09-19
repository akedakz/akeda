begin;

create table public.learning_program_sections (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.learning_programs(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, sort_order),
  unique (id, program_id)
);

create index learning_program_sections_program_idx
  on public.learning_program_sections(program_id, sort_order);

alter table public.learning_program_sections enable row level security;
revoke all on public.learning_program_sections from public, anon, authenticated;
grant all on public.learning_program_sections to service_role;

insert into public.learning_program_sections(program_id, title, sort_order)
select distinct topic.program_id, 'Основной раздел', 0
from public.learning_program_topics topic;

alter table public.learning_program_topics add column section_id uuid;

update public.learning_program_topics topic
set section_id = section.id
from public.learning_program_sections section
where section.program_id = topic.program_id
  and section.sort_order = 0;

alter table public.learning_program_topics alter column section_id set not null;
alter table public.learning_program_topics
  add constraint learning_program_topics_section_fk
  foreign key (section_id, program_id)
  references public.learning_program_sections(id, program_id)
  on delete restrict;

alter table public.learning_program_topics
  drop constraint learning_program_topics_program_id_sort_order_key;
alter table public.learning_program_topics
  add constraint learning_program_topics_section_sort_key unique (section_id, sort_order);

drop function public.reorder_learning_program_topics(uuid, uuid[]);

create function public.reorder_learning_program_sections(p_program_id uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_program_id is null or p_ids is null
     or cardinality(p_ids) <> (select count(*) from public.learning_program_sections where program_id=p_program_id)
     or cardinality(p_ids) <> (select count(distinct id) from unnest(p_ids) selected(id))
     or exists (
       select 1 from unnest(p_ids) selected(id)
       left join public.learning_program_sections section on section.id=selected.id and section.program_id=p_program_id
       where section.id is null
     ) then raise exception 'invalid section order'; end if;

  update public.learning_program_sections set sort_order=sort_order+1000000,updated_at=now() where program_id=p_program_id;
  with ordered as (select id,ordinality-1 position from unnest(p_ids) with ordinality selected(id,ordinality))
  update public.learning_program_sections section set sort_order=ordered.position,updated_at=now()
  from ordered where section.id=ordered.id and section.program_id=p_program_id;
  update public.learning_programs set updated_at=now() where id=p_program_id;
end;$$;

create function public.reorder_learning_program_section_topics(p_program_id uuid, p_section_id uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_program_id is null or p_section_id is null or p_ids is null
     or not exists (select 1 from public.learning_program_sections where id=p_section_id and program_id=p_program_id)
     or cardinality(p_ids) <> (select count(*) from public.learning_program_topics where program_id=p_program_id and section_id=p_section_id)
     or cardinality(p_ids) <> (select count(distinct id) from unnest(p_ids) selected(id))
     or exists (
       select 1 from unnest(p_ids) selected(id)
       left join public.learning_program_topics topic
         on topic.id=selected.id and topic.program_id=p_program_id and topic.section_id=p_section_id
       where topic.id is null
     ) then raise exception 'invalid topic order'; end if;

  update public.learning_program_topics set sort_order=sort_order+1000000,updated_at=now()
  where program_id=p_program_id and section_id=p_section_id;
  with ordered as (select id,ordinality-1 position from unnest(p_ids) with ordinality selected(id,ordinality))
  update public.learning_program_topics topic set sort_order=ordered.position,updated_at=now()
  from ordered where topic.id=ordered.id and topic.program_id=p_program_id and topic.section_id=p_section_id;
  update public.learning_programs set updated_at=now() where id=p_program_id;
end;$$;

revoke all on function public.reorder_learning_program_sections(uuid,uuid[]),
  public.reorder_learning_program_section_topics(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_learning_program_sections(uuid,uuid[]),
  public.reorder_learning_program_section_topics(uuid,uuid,uuid[]) to service_role;

commit;
