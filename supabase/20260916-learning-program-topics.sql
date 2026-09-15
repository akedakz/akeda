create table if not exists public.learning_program_topics (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.learning_programs(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, sort_order),
  unique (id, program_id)
);

create index if not exists learning_program_topics_program_idx
  on public.learning_program_topics(program_id, sort_order);

create table if not exists public.student_learning_program_topic_progress (
  student_id uuid not null,
  program_id uuid not null,
  program_topic_id uuid not null,
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, program_topic_id),
  foreign key (student_id, program_id)
    references public.student_learning_programs(student_id, program_id)
    on delete cascade,
  foreign key (program_topic_id, program_id)
    references public.learning_program_topics(id, program_id)
    on delete cascade
);

create index if not exists student_learning_program_topic_progress_program_idx
  on public.student_learning_program_topic_progress(student_id, program_id, completed_at);

alter table public.learning_program_topics enable row level security;
alter table public.student_learning_program_topic_progress enable row level security;

grant all on public.learning_program_topics, public.student_learning_program_topic_progress to service_role;
revoke all on public.learning_program_topics, public.student_learning_program_topic_progress from anon, authenticated;

create or replace function public.reorder_learning_program_topics(
  p_program_id uuid,
  p_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_program_id is null or p_ids is null then
    raise exception 'invalid input';
  end if;

  select count(*) into v_count
  from public.learning_program_topics
  where program_id = p_program_id;

  if cardinality(p_ids) <> v_count
     or cardinality(p_ids) <> (
       select count(distinct item_id)
       from unnest(p_ids) as selected(item_id)
     )
     or exists (
       select 1
       from unnest(p_ids) as selected(item_id)
       left join public.learning_program_topics topic
         on topic.id = selected.item_id
        and topic.program_id = p_program_id
       where topic.id is null
     ) then
    raise exception 'invalid topic order';
  end if;

  update public.learning_program_topics
  set sort_order = sort_order + 1000000,
      updated_at = now()
  where program_id = p_program_id;

  with ordered as (
    select item_id, ordinality - 1 as new_sort_order
    from unnest(p_ids) with ordinality as selected(item_id, ordinality)
  )
  update public.learning_program_topics topic
  set sort_order = ordered.new_sort_order,
      updated_at = now()
  from ordered
  where topic.id = ordered.item_id
    and topic.program_id = p_program_id;

  update public.learning_programs
  set updated_at = now()
  where id = p_program_id;
end;
$$;

revoke all on function public.reorder_learning_program_topics(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_learning_program_topics(uuid, uuid[]) to service_role;

create or replace function public.toggle_student_learning_program_topic(
  p_student_id uuid,
  p_program_topic_id uuid
) returns table (
  program_id uuid,
  program_topic_id uuid,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program_id uuid;
  v_completed_at timestamptz;
begin
  select topic.program_id
  into v_program_id
  from public.learning_program_topics topic
  where topic.id = p_program_topic_id;

  if v_program_id is null then
    raise exception 'topic not found';
  end if;

  if not exists (
    select 1
    from public.student_learning_programs assignment
    where assignment.student_id = p_student_id
      and assignment.program_id = v_program_id
  ) then
    raise exception 'program not assigned';
  end if;

  select progress.completed_at
  into v_completed_at
  from public.student_learning_program_topic_progress progress
  where progress.student_id = p_student_id
    and progress.program_topic_id = p_program_topic_id;

  if found then
    delete from public.student_learning_program_topic_progress
    where student_id = p_student_id
      and program_topic_id = p_program_topic_id;

    return query
    select v_program_id, p_program_topic_id, null::timestamptz;
  end if;

  v_completed_at := clock_timestamp();

  insert into public.student_learning_program_topic_progress (
    student_id,
    program_id,
    program_topic_id,
    completed_at,
    updated_at
  ) values (
    p_student_id,
    v_program_id,
    p_program_topic_id,
    v_completed_at,
    v_completed_at
  );

  return query
  select v_program_id, p_program_topic_id, v_completed_at;
end;
$$;

revoke all on function public.toggle_student_learning_program_topic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.toggle_student_learning_program_topic(uuid, uuid) to service_role;


-- Preserve progress when an admin edits a student's program selection.
-- The previous implementation deleted every assignment and reinserted it,
-- which would also delete progress rows through the foreign key cascade.
create or replace function public.replace_student_learning_programs(
  p_student_id uuid,
  p_program_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.profiles
  where id = p_student_id
    and role = 'STUDENT'
  for update;

  if not found then
    raise exception 'invalid student';
  end if;

  if p_program_ids is null
     or cardinality(p_program_ids) > 2
     or cardinality(p_program_ids) <> (
       select count(distinct id)
       from unnest(p_program_ids) selected(id)
     ) then
    raise exception 'invalid program set';
  end if;

  if exists (
    select 1
    from unnest(p_program_ids) selected(id)
    left join public.learning_programs program
      on program.id = selected.id
    where program.id is null
       or (
         not program.is_active
         and not exists (
           select 1
           from public.student_learning_programs existing
           where existing.student_id = p_student_id
             and existing.program_id = selected.id
         )
       )
  ) then
    raise exception 'inactive program';
  end if;

  delete from public.student_learning_programs
  where student_id = p_student_id
    and not (program_id = any(p_program_ids));

  insert into public.student_learning_programs(student_id, program_id)
  select p_student_id, id
  from unnest(p_program_ids) selected(id)
  on conflict (student_id, program_id) do nothing;
end;
$$;

revoke all on function public.replace_student_learning_programs(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.replace_student_learning_programs(uuid, uuid[]) to service_role;
