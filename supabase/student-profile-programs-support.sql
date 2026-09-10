create table if not exists public.learning_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists learning_programs_active_name_unique on public.learning_programs(lower(btrim(name))) where is_active;

create table if not exists public.student_learning_programs (
  student_id uuid not null references public.profiles(id) on delete cascade,
  program_id uuid not null references public.learning_programs(id),
  created_at timestamptz not null default now(),
  primary key(student_id, program_id)
);
create index if not exists student_learning_programs_program_idx on public.student_learning_programs(program_id);

create or replace function public.validate_student_learning_program() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=new.student_id and role='STUDENT') then raise exception 'invalid student'; end if;
  if (select count(*) from public.student_learning_programs where student_id=new.student_id) >= 2 then raise exception 'program limit exceeded'; end if;
  return new;
end;$$;
drop trigger if exists student_learning_programs_validate on public.student_learning_programs;
create trigger student_learning_programs_validate before insert on public.student_learning_programs for each row execute function public.validate_student_learning_program();

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check(category in ('PAGE','MATERIAL','TEST','DATA','OTHER')),
  message text not null check(length(btrim(message)) between 10 and 2000),
  status text not null default 'NEW' check(status in ('NEW','VIEWED','RESOLVED')),
  created_at timestamptz not null default now(),
  viewed_at timestamptz null,
  resolved_at timestamptz null
);
create index if not exists support_messages_status_created_idx on public.support_messages(status,created_at desc);
create index if not exists support_messages_student_created_idx on public.support_messages(student_id,created_at desc);

alter table public.learning_programs enable row level security;
alter table public.student_learning_programs enable row level security;
alter table public.support_messages enable row level security;
grant all on public.learning_programs,public.student_learning_programs,public.support_messages to service_role;
revoke all on public.learning_programs,public.student_learning_programs,public.support_messages from anon,authenticated;
revoke all on function public.validate_student_learning_program() from public,anon,authenticated;
grant execute on function public.validate_student_learning_program() to service_role;

create or replace function public.replace_student_learning_programs(p_student_id uuid,p_program_ids uuid[]) returns void language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.profiles where id=p_student_id and role='STUDENT' for update;
  if not found then raise exception 'invalid student'; end if;
  if cardinality(p_program_ids)>2 or cardinality(p_program_ids)<>(select count(distinct id) from unnest(p_program_ids) selected(id)) then raise exception 'invalid program set'; end if;
  if exists(select 1 from unnest(p_program_ids) selected(id) left join public.learning_programs program on program.id=selected.id and program.is_active where program.id is null) then raise exception 'inactive program'; end if;
  delete from public.student_learning_programs where student_id=p_student_id;
  insert into public.student_learning_programs(student_id,program_id) select p_student_id,id from unnest(p_program_ids) selected(id);
end;$$;
revoke all on function public.replace_student_learning_programs(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.replace_student_learning_programs(uuid,uuid[]) to service_role;
