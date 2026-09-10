create table if not exists public.student_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  duration_minutes integer not null check (duration_minutes between 15 and 300),
  valid_from date not null,
  valid_until date null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);
create unique index if not exists student_schedule_slots_active_unique on public.student_schedule_slots(student_id, weekday, start_time) where valid_until is null;
create index if not exists student_schedule_slots_student_dates_idx on public.student_schedule_slots(student_id, valid_from, valid_until);

create table if not exists public.student_lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  schedule_slot_id uuid null references public.student_schedule_slots(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status_override text null check (status_override is null or status_override in ('CANCELLED_BY_TEACHER','CANCELLED_BY_STUDENT','NO_SHOW','LATE_CANCELLED')),
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique(student_id, starts_at)
);
create index if not exists student_lessons_student_starts_idx on public.student_lessons(student_id, starts_at);
create index if not exists student_lessons_student_active_starts_idx on public.student_lessons(student_id, starts_at) where deleted_at is null;

create table if not exists public.lesson_homework_records (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.student_lessons(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  grade smallint null check (grade between 0 and 10),
  comment text null check (comment is null or length(comment) <= 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lesson_homework_records_student_idx on public.lesson_homework_records(student_id);
create index if not exists lesson_homework_records_lesson_idx on public.lesson_homework_records(lesson_id);

alter table public.student_schedule_slots enable row level security;
alter table public.student_lessons enable row level security;
alter table public.lesson_homework_records enable row level security;
grant all on public.student_schedule_slots, public.student_lessons, public.lesson_homework_records to service_role;

create or replace function public.replace_student_schedule(p_student_id uuid, p_created_by uuid, p_effective_from date, p_slots jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb;
begin
  if jsonb_typeof(p_slots) <> 'array' then raise exception 'slots must be an array'; end if;
  -- A version created again on the same Almaty calendar date has not become
  -- historical yet: replace it instead of creating a chain of one-day rows.
  delete from public.student_schedule_slots
    where student_id = p_student_id and valid_until is null and valid_from >= p_effective_from;
  -- Older active versions end on the calendar day before the new version.
  update public.student_schedule_slots set valid_until = p_effective_from - 1, updated_at = now()
    where student_id = p_student_id and valid_until is null;
  for item in select value from jsonb_array_elements(p_slots) loop
    insert into public.student_schedule_slots(student_id, weekday, start_time, duration_minutes, valid_from, created_by)
    values (p_student_id, (item->>'weekday')::smallint, (item->>'startTime')::time, (item->>'durationMinutes')::integer, p_effective_from, p_created_by);
  end loop;
  -- Rebuild only lessons that have not started and carry no manual data.
  delete from public.student_lessons lesson
    where lesson.student_id = p_student_id and lesson.starts_at > now() and lesson.status_override is null
      and not exists (select 1 from public.lesson_homework_records homework where homework.lesson_id = lesson.id);
end;
$$;
revoke all on function public.replace_student_schedule(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_student_schedule(uuid, uuid, date, jsonb) to service_role;

create or replace function public.soft_delete_student_lesson(p_student_id uuid, p_lesson_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_lesson_id uuid;
begin
  update public.student_lessons
    set deleted_at = now(), updated_at = now()
    where id = p_lesson_id and student_id = p_student_id and deleted_at is null and ends_at <= now()
    returning id into v_lesson_id;
  if v_lesson_id is null then return false; end if;
  delete from public.lesson_homework_records where lesson_id = v_lesson_id and student_id = p_student_id;
  return true;
end;
$$;
revoke all on function public.soft_delete_student_lesson(uuid, uuid) from public, anon, authenticated;
grant execute on function public.soft_delete_student_lesson(uuid, uuid) to service_role;
