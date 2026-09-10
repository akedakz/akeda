begin;

create table public.student_payment_settings (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  default_lesson_price_kzt integer not null check (default_lesson_price_kzt between 1 and 10000000),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id)
);

create table public.student_financial_ledger (
  id uuid primary key default gen_random_uuid(),
  student_id uuid null references public.profiles(id) on delete set null,
  student_name_snapshot text not null check (length(btrim(student_name_snapshot)) between 1 and 120),
  entry_type text not null check (entry_type in ('PAYMENT','LESSON_CHARGE','ADJUSTMENT')),
  amount_kzt integer not null check (amount_kzt <> 0 and abs(amount_kzt) <= 100000000),
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  lesson_id uuid null references public.student_lessons(id) on delete set null,
  reverses_entry_id uuid null references public.student_financial_ledger(id),
  operation_key uuid null,
  comment text null check (comment is null or length(comment) <= 500),
  check ((entry_type = 'PAYMENT' and amount_kzt > 0 and lesson_id is null)
      or (entry_type = 'LESSON_CHARGE' and amount_kzt < 0)
      or entry_type = 'ADJUSTMENT'),
  check (reverses_entry_id is null or entry_type = 'ADJUSTMENT')
);

create unique index student_financial_one_charge_per_lesson
  on public.student_financial_ledger(lesson_id)
  where entry_type = 'LESSON_CHARGE';
create unique index student_financial_one_reversal
  on public.student_financial_ledger(reverses_entry_id)
  where reverses_entry_id is not null;
create unique index student_financial_operation_idempotency
  on public.student_financial_ledger(created_by, operation_key)
  where operation_key is not null;
create index student_financial_student_effective_idx
  on public.student_financial_ledger(student_id, effective_at desc, id desc);
create index student_financial_type_effective_idx
  on public.student_financial_ledger(entry_type, effective_at desc);

alter table public.student_payment_settings enable row level security;
alter table public.student_financial_ledger enable row level security;
revoke all on public.student_payment_settings, public.student_financial_ledger from public, anon, authenticated;
grant all on public.student_payment_settings, public.student_financial_ledger to service_role;

create or replace function public.set_student_lesson_price_atomic(p_student_id uuid, p_admin_id uuid, p_price_kzt integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_price_kzt not between 1 and 10000000
     or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT')
     or not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then
    return jsonb_build_object('status','invalid');
  end if;
  insert into public.student_payment_settings(student_id,default_lesson_price_kzt,updated_by)
  values(p_student_id,p_price_kzt,p_admin_id)
  on conflict(student_id) do update set default_lesson_price_kzt=excluded.default_lesson_price_kzt,updated_at=now(),updated_by=excluded.updated_by;
  return jsonb_build_object('status','saved');
end; $$;

create or replace function public.add_student_payment_atomic(p_student_id uuid,p_admin_id uuid,p_amount_kzt integer,p_effective_date date,p_comment text,p_operation_key uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_existing public.student_financial_ledger%rowtype;
begin
  if p_operation_key is null or p_amount_kzt not between 1 and 100000000 or p_effective_date is null
     or p_effective_date > (clock_timestamp() at time zone 'Asia/Almaty')::date
     or length(coalesce(p_comment,''))>500
     or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT')
     or not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_admin_id::text||':'||p_operation_key::text,7201));
  select * into v_existing from public.student_financial_ledger where created_by=p_admin_id and operation_key=p_operation_key;
  if found then
    return case when v_existing.student_id=p_student_id and v_existing.entry_type='PAYMENT' and v_existing.amount_kzt=p_amount_kzt
      and (v_existing.effective_at at time zone 'Asia/Almaty')::date=p_effective_date
      and coalesce(v_existing.comment,'')=coalesce(nullif(btrim(p_comment),''),'')
      then jsonb_build_object('status','created','id',v_existing.id,'replayed',true)
      else jsonb_build_object('status','conflict') end;
  end if;
  insert into public.student_financial_ledger(student_id,student_name_snapshot,entry_type,amount_kzt,effective_at,created_by,operation_key,comment)
  select p_student_id,full_name,'PAYMENT',p_amount_kzt,(p_effective_date + time '12:00') at time zone 'Asia/Almaty',p_admin_id,p_operation_key,nullif(btrim(p_comment),'')
  from public.profiles where id=p_student_id returning id into v_id;
  return jsonb_build_object('status','created','id',v_id,'replayed',false);
end; $$;

create or replace function public.set_lesson_attendance_and_charge_atomic(p_student_id uuid,p_lesson_id uuid,p_admin_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_lesson public.student_lessons%rowtype; v_price integer; v_charge_id uuid;
begin
  if p_status not in ('ATTENDED','NO_SHOW','LATE_CANCELLED') or not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_lesson_id::text,7202));
  select * into v_lesson from public.student_lessons where id=p_lesson_id and student_id=p_student_id and deleted_at is null for update;
  if not found or v_lesson.ends_at>clock_timestamp() then return jsonb_build_object('status','lesson_not_found'); end if;
  update public.student_lessons set status_override=case when p_status='ATTENDED' then null else p_status end,updated_at=now() where id=p_lesson_id;
  if p_status<>'ATTENDED' then return jsonb_build_object('status','saved'); end if;
  select id into v_charge_id from public.student_financial_ledger where lesson_id=p_lesson_id and entry_type='LESSON_CHARGE';
  if found then return jsonb_build_object('status','already_charged','entry_id',v_charge_id); end if;
  select default_lesson_price_kzt into v_price from public.student_payment_settings where student_id=p_student_id;
  if v_price is null then return jsonb_build_object('status','saved_without_price'); end if;
  insert into public.student_financial_ledger(student_id,student_name_snapshot,entry_type,amount_kzt,effective_at,created_by,lesson_id,comment)
  select p_student_id,full_name,'LESSON_CHARGE',-v_price,v_lesson.ends_at,p_admin_id,p_lesson_id,'Проведённое занятие'
  from public.profiles where id=p_student_id returning id into v_charge_id;
  return jsonb_build_object('status','charged','entry_id',v_charge_id,'amount_kzt',-v_price);
end; $$;

create or replace function public.reverse_student_financial_entry_atomic(p_student_id uuid,p_entry_id uuid,p_admin_id uuid,p_comment text,p_operation_key uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_original public.student_financial_ledger%rowtype; v_id uuid; v_existing public.student_financial_ledger%rowtype;
begin
  if p_operation_key is null or length(coalesce(p_comment,''))>500 or not exists(select 1 from public.profiles where id=p_admin_id and role='ADMIN') then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_admin_id::text||':'||p_operation_key::text,7204));
  perform pg_advisory_xact_lock(hashtextextended(p_entry_id::text,7203));
  select * into v_original from public.student_financial_ledger where id=p_entry_id and student_id=p_student_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_original.entry_type not in ('PAYMENT','LESSON_CHARGE') then return jsonb_build_object('status','not_reversible'); end if;
  select * into v_existing from public.student_financial_ledger where created_by=p_admin_id and operation_key=p_operation_key;
  if found then
    return case when v_existing.student_id=p_student_id and v_existing.entry_type='ADJUSTMENT'
      and v_existing.amount_kzt=-v_original.amount_kzt and v_existing.reverses_entry_id=p_entry_id
      and coalesce(v_existing.comment,'')=coalesce(nullif(btrim(p_comment),''),'Отмена операции')
      then jsonb_build_object('status','reversed','id',v_existing.id,'replayed',true)
      else jsonb_build_object('status','conflict') end;
  end if;
  select * into v_existing from public.student_financial_ledger where reverses_entry_id=p_entry_id;
  if found then return jsonb_build_object('status','already_reversed','id',v_existing.id); end if;
  insert into public.student_financial_ledger(student_id,student_name_snapshot,entry_type,amount_kzt,effective_at,created_by,reverses_entry_id,operation_key,comment)
  values(p_student_id,v_original.student_name_snapshot,'ADJUSTMENT',-v_original.amount_kzt,clock_timestamp(),p_admin_id,p_entry_id,p_operation_key,coalesce(nullif(btrim(p_comment),''),'Отмена операции')) returning id into v_id;
  return jsonb_build_object('status','reversed','id',v_id,'replayed',false);
end; $$;

create or replace function public.get_student_finance_summary(p_student_id uuid,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  with bounds as (select date_trunc('month',statement_timestamp() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty' as month_start), entries as (
    select * from public.student_financial_ledger where student_id=p_student_id order by effective_at desc,id desc limit least(greatest(p_limit,1),100)
  ), active_originals as (
    select original.* from public.student_financial_ledger original
    where original.student_id=p_student_id and original.entry_type in ('PAYMENT','LESSON_CHARGE')
      and not exists(select 1 from public.student_financial_ledger reversal where reversal.reverses_entry_id=original.id)
  ) select jsonb_build_object(
    'price_kzt',(select default_lesson_price_kzt from public.student_payment_settings where student_id=p_student_id),
    'balance_kzt',coalesce((select sum(amount_kzt) from public.student_financial_ledger where student_id=p_student_id),0),
    'paid_month_kzt',coalesce((select sum(amount_kzt) from active_originals,bounds where entry_type='PAYMENT' and effective_at>=month_start),0),
    'charged_month_kzt',coalesce(-(select sum(amount_kzt) from active_originals,bounds where entry_type='LESSON_CHARGE' and effective_at>=month_start),0),
    'last_payment_at',(select max(effective_at) from active_originals where entry_type='PAYMENT'),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',entry_type,'amount_kzt',amount_kzt,'effective_at',effective_at,'comment',comment,'lesson_id',lesson_id,'reverses_entry_id',reverses_entry_id) order by effective_at desc,id desc) from entries),'[]'::jsonb)
  ); $$;

create or replace function public.get_admin_payments_overview()
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  with bounds as (select date_trunc('month',statement_timestamp() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty' as month_start), ledger_totals as (
    select student_id,sum(amount_kzt)::bigint balance_kzt from public.student_financial_ledger where student_id is not null group by student_id
  ), active_payments as (
    select original.student_id,original.amount_kzt,original.effective_at from public.student_financial_ledger original
    where original.entry_type='PAYMENT' and original.student_id is not null
      and not exists(select 1 from public.student_financial_ledger reversal where reversal.reverses_entry_id=original.id)
  ), payment_stats as (
    select student_id,max(effective_at) last_payment_at,
      coalesce(sum(amount_kzt) filter(where effective_at>=(select month_start from bounds)),0)::bigint paid_month_kzt
    from active_payments group by student_id
  ), balances as (
    select p.id,p.full_name,p.student_status,coalesce(t.balance_kzt,0)::bigint balance_kzt,s.default_lesson_price_kzt,
      stats.last_payment_at,coalesce(stats.paid_month_kzt,0)::bigint paid_month_kzt
    from public.profiles p left join public.student_payment_settings s on s.student_id=p.id
    left join ledger_totals t on t.student_id=p.id left join payment_stats stats on stats.student_id=p.id
    where p.role='STUDENT'
  ) select jsonb_build_object('debt_kzt',coalesce(-sum(balance_kzt) filter(where balance_kzt<0),0),'credit_kzt',coalesce(sum(balance_kzt) filter(where balance_kzt>0),0),'paid_month_kzt',coalesce(sum(paid_month_kzt),0),
    'students',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'status',student_status,'balance_kzt',balance_kzt,'price_kzt',default_lesson_price_kzt,'last_payment_at',last_payment_at) order by (balance_kzt>=0),balance_kzt,full_name),'[]'::jsonb)) from balances; $$;

revoke all on function public.set_student_lesson_price_atomic(uuid,uuid,integer),public.add_student_payment_atomic(uuid,uuid,integer,date,text,uuid),public.set_lesson_attendance_and_charge_atomic(uuid,uuid,uuid,text),public.reverse_student_financial_entry_atomic(uuid,uuid,uuid,text,uuid),public.get_student_finance_summary(uuid,integer),public.get_admin_payments_overview() from public,anon,authenticated;
grant execute on function public.set_student_lesson_price_atomic(uuid,uuid,integer),public.add_student_payment_atomic(uuid,uuid,integer,date,text,uuid),public.set_lesson_attendance_and_charge_atomic(uuid,uuid,uuid,text),public.reverse_student_financial_entry_atomic(uuid,uuid,uuid,text,uuid),public.get_student_finance_summary(uuid,integer),public.get_admin_payments_overview() to service_role;

commit;
