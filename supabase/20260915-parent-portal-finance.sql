alter type public.user_role add value if not exists 'PARENT';

begin;

alter table public.profiles
  add column if not exists parent_id uuid null references public.profiles(id) on delete set null;

create index if not exists profiles_parent_id_idx on public.profiles(parent_id) where parent_id is not null;

alter table public.profiles drop constraint if exists profiles_parent_only_for_students;
alter table public.profiles add constraint profiles_parent_only_for_students
  check (parent_id is null or role = 'STUDENT');

create or replace function public.validate_profile_parent_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.profiles parent where parent.id = new.parent_id and parent.role = 'PARENT'
  ) then
    raise exception using errcode = '23514', message = 'parent_id must reference a PARENT profile';
  end if;
  if tg_op = 'UPDATE' and old.role = 'PARENT' and new.role <> 'PARENT'
     and exists (select 1 from public.profiles child where child.parent_id = old.id) then
    raise exception using errcode = '23514', message = 'linked parent role cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_validate_parent_role on public.profiles;
create trigger profiles_validate_parent_role
before insert or update of parent_id, role on public.profiles
for each row execute function public.validate_profile_parent_role();

create table public.student_finance_settings (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  rate_per_60_kzt integer not null check (rate_per_60_kzt between 1 and 100000000),
  billing_started_at timestamptz not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);

create table public.student_financial_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  entry_type text not null check (entry_type in ('PAYMENT','LESSON_CHARGE','ADJUSTMENT')),
  amount_kzt bigint not null,
  lesson_id uuid null references public.student_lessons(id) on delete set null,
  duration_minutes_snapshot integer null check (duration_minutes_snapshot is null or duration_minutes_snapshot > 0),
  rate_per_60_kzt_snapshot integer null check (rate_per_60_kzt_snapshot is null or rate_per_60_kzt_snapshot > 0),
  note text null check (note is null or length(note) <= 500),
  created_by uuid null references public.profiles(id),
  operation_key uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (entry_type = 'LESSON_CHARGE' and lesson_id is not null and duration_minutes_snapshot is not null and rate_per_60_kzt_snapshot is not null and amount_kzt <= 0)
    or (entry_type <> 'LESSON_CHARGE' and lesson_id is null and duration_minutes_snapshot is null and rate_per_60_kzt_snapshot is null)
  ),
  check (entry_type <> 'PAYMENT' or amount_kzt > 0)
);

create unique index student_financial_entries_lesson_unique
  on public.student_financial_entries(lesson_id) where entry_type = 'LESSON_CHARGE';
create unique index student_financial_entries_operation_unique
  on public.student_financial_entries(created_by, operation_key) where operation_key is not null;
create index student_financial_entries_student_created_idx
  on public.student_financial_entries(student_id, created_at desc, id desc);

alter table public.student_finance_settings enable row level security;
alter table public.student_financial_entries enable row level security;
revoke all on public.student_finance_settings, public.student_financial_entries from public, anon, authenticated;
grant all on public.student_finance_settings, public.student_financial_entries to service_role;

create or replace function public.reconcile_student_finance_atomic(p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.student_finance_settings%rowtype;
  v_lesson record;
  v_entry public.student_financial_entries%rowtype;
  v_duration integer;
  v_charge bigint;
  v_created integer := 0;
  v_updated integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':student-finance', 9151));
  select * into v_settings from public.student_finance_settings where student_id = p_student_id for update;
  if not found then return jsonb_build_object('status','no_settings','created',0,'updated',0); end if;

  for v_lesson in
    select id, starts_at, ends_at, status_override, deleted_at
    from public.student_lessons
    where student_id = p_student_id
      and ends_at >= v_settings.billing_started_at
      and ends_at <= clock_timestamp()
    order by ends_at, id
    for update
  loop
    select * into v_entry from public.student_financial_entries
    where lesson_id = v_lesson.id and entry_type = 'LESSON_CHARGE' for update;

    if found then
      v_charge := round(v_entry.rate_per_60_kzt_snapshot::numeric * v_entry.duration_minutes_snapshot / 60)::bigint;
      if v_lesson.deleted_at is not null or v_lesson.status_override is not null then
        if v_entry.amount_kzt <> 0 then
          update public.student_financial_entries set amount_kzt = 0, updated_at = now() where id = v_entry.id;
          v_updated := v_updated + 1;
        end if;
      elsif v_entry.amount_kzt = 0 and v_charge <> 0 then
        update public.student_financial_entries set amount_kzt = -v_charge, updated_at = now() where id = v_entry.id;
        v_updated := v_updated + 1;
      end if;
    elsif v_lesson.deleted_at is null and v_lesson.status_override is null then
      v_duration := round(extract(epoch from (v_lesson.ends_at - v_lesson.starts_at)) / 60)::integer;
      if v_duration > 0 then
        v_charge := round(v_settings.rate_per_60_kzt::numeric * v_duration / 60)::bigint;
        insert into public.student_financial_entries(
          student_id, entry_type, amount_kzt, lesson_id,
          duration_minutes_snapshot, rate_per_60_kzt_snapshot, note
        ) values (
          p_student_id, 'LESSON_CHARGE', -v_charge, v_lesson.id,
          v_duration, v_settings.rate_per_60_kzt, 'Проведённый урок'
        ) on conflict (lesson_id) where entry_type = 'LESSON_CHARGE' do nothing;
        if found then v_created := v_created + 1; end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('status','reconciled','created',v_created,'updated',v_updated);
end;
$$;

create or replace function public.set_student_finance_rate_atomic(p_student_id uuid, p_admin_id uuid, p_rate_per_60_kzt integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_rate_per_60_kzt not between 1 and 100000000
     or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT')
     or not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then
    return jsonb_build_object('status','invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':student-finance', 9151));
  if exists(select 1 from public.student_finance_settings where student_id=p_student_id) then
    perform public.reconcile_student_finance_atomic(p_student_id);
    update public.student_finance_settings
      set rate_per_60_kzt=p_rate_per_60_kzt, updated_at=now(), updated_by=p_admin_id
      where student_id=p_student_id;
  else
    insert into public.student_finance_settings(student_id,rate_per_60_kzt,billing_started_at,updated_by)
    values(p_student_id,p_rate_per_60_kzt,clock_timestamp(),p_admin_id);
  end if;
  return jsonb_build_object('status','saved');
end;
$$;

create or replace function public.add_student_financial_entry_atomic(
  p_student_id uuid, p_admin_id uuid, p_entry_type text, p_amount_kzt bigint, p_note text, p_operation_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_existing public.student_financial_entries%rowtype;
begin
  if p_operation_key is null or p_entry_type not in ('PAYMENT','ADJUSTMENT')
     or p_amount_kzt = 0 or (p_entry_type='PAYMENT' and p_amount_kzt < 0)
     or abs(p_amount_kzt) > 1000000000 or length(coalesce(p_note,'')) > 500
     or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT')
     or not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then
    return jsonb_build_object('status','invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_admin_id::text || ':' || p_operation_key::text, 9152));
  select * into v_existing from public.student_financial_entries where created_by=p_admin_id and operation_key=p_operation_key;
  if found then
    return case when v_existing.student_id=p_student_id and v_existing.entry_type=p_entry_type
      and v_existing.amount_kzt=p_amount_kzt and coalesce(v_existing.note,'')=coalesce(nullif(btrim(p_note),''),'')
      then jsonb_build_object('status','saved','id',v_existing.id,'replayed',true)
      else jsonb_build_object('status','conflict') end;
  end if;
  insert into public.student_financial_entries(student_id,entry_type,amount_kzt,note,created_by,operation_key)
  values(p_student_id,p_entry_type,p_amount_kzt,nullif(btrim(p_note),''),p_admin_id,p_operation_key)
  returning id into v_id;
  return jsonb_build_object('status','saved','id',v_id,'replayed',false);
end;
$$;

revoke execute on function public.reconcile_student_finance_atomic(uuid) from public, anon, authenticated;
revoke execute on function public.set_student_finance_rate_atomic(uuid,uuid,integer) from public, anon, authenticated;
revoke execute on function public.add_student_financial_entry_atomic(uuid,uuid,text,bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.reconcile_student_finance_atomic(uuid) to service_role;
grant execute on function public.set_student_finance_rate_atomic(uuid,uuid,integer) to service_role;
grant execute on function public.add_student_financial_entry_atomic(uuid,uuid,text,bigint,text,uuid) to service_role;

commit;
