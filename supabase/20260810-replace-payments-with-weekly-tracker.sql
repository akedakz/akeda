begin;

drop function if exists public.set_student_lesson_price_atomic(uuid,uuid,integer);
drop function if exists public.add_student_payment_atomic(uuid,uuid,integer,date,text,uuid);
drop function if exists public.set_lesson_attendance_and_charge_atomic(uuid,uuid,uuid,text);
drop function if exists public.reverse_student_financial_entry_atomic(uuid,uuid,uuid,text,uuid);
drop function if exists public.get_student_finance_summary(uuid,integer);
drop function if exists public.get_admin_payments_overview();
drop table if exists public.student_financial_ledger;
drop table if exists public.student_payment_settings;

create table public.weekly_payment_rows (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id uuid not null references public.profiles(id),
  week_start date not null check (extract(isodow from week_start) = 1),
  student_name text not null check (length(btrim(student_name)) between 1 and 120),
  subject text not null check (length(btrim(subject)) between 1 and 120),
  price_per_lesson_kzt integer not null default 0 check (price_per_lesson_kzt between 0 and 10000000),
  lessons_count integer not null default 0 check (lessons_count between 0 and 1000),
  amount_due_kzt bigint generated always as (price_per_lesson_kzt::bigint * lessons_count::bigint) stored,
  paid boolean not null default false,
  paid_at timestamptz null,
  notes text null check (notes is null or length(notes) <= 500),
  sort_order integer not null default 0 check (sort_order between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((paid and paid_at is not null) or (not paid and paid_at is null))
);

create index weekly_payment_rows_owner_week_idx
  on public.weekly_payment_rows(owner_admin_id, week_start, sort_order, id);
create index weekly_payment_rows_owner_paid_at_idx
  on public.weekly_payment_rows(owner_admin_id, paid_at)
  where paid;
create index weekly_payment_rows_owner_student_name_idx
  on public.weekly_payment_rows(owner_admin_id, lower(btrim(student_name)));

alter table public.weekly_payment_rows enable row level security;
revoke all on public.weekly_payment_rows from public, anon, authenticated;
grant all on public.weekly_payment_rows to service_role;

create function public.set_weekly_payment_paid_atomic(
  p_owner_admin_id uuid,
  p_row_id uuid,
  p_paid boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.weekly_payment_rows%rowtype;
begin
  if p_paid is null or not exists (
    select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN'
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select * into v_row
  from public.weekly_payment_rows
  where id = p_row_id and owner_admin_id = p_owner_admin_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_row.paid = p_paid then
    return jsonb_build_object('status', 'saved', 'paid', v_row.paid, 'paid_at', v_row.paid_at, 'replayed', true);
  end if;

  update public.weekly_payment_rows
  set paid = p_paid,
      paid_at = case when p_paid then clock_timestamp() else null end,
      updated_at = now()
  where id = p_row_id
  returning * into v_row;

  return jsonb_build_object('status', 'saved', 'paid', v_row.paid, 'paid_at', v_row.paid_at, 'replayed', false);
end;
$$;

create function public.copy_previous_weekly_payments_atomic(
  p_owner_admin_id uuid,
  p_week_start date
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if extract(isodow from p_week_start) <> 1 or not exists (
    select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN'
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text || ':' || p_week_start::text, 7301));

  if exists (
    select 1 from public.weekly_payment_rows
    where owner_admin_id = p_owner_admin_id and week_start = p_week_start
  ) then
    return jsonb_build_object('status', 'target_not_empty');
  end if;

  insert into public.weekly_payment_rows(
    owner_admin_id, week_start, student_name, subject,
    price_per_lesson_kzt, lessons_count, paid, paid_at, notes, sort_order
  )
  select owner_admin_id, p_week_start, student_name, subject,
    price_per_lesson_kzt, lessons_count, false, null, notes, sort_order
  from public.weekly_payment_rows
  where owner_admin_id = p_owner_admin_id
    and week_start = p_week_start - 7
  order by sort_order, id;

  get diagnostics v_count = row_count;
  return jsonb_build_object('status', 'copied', 'count', v_count);
end;
$$;

create function public.get_weekly_payments_dashboard(
  p_owner_admin_id uuid,
  p_week_start date
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with bounds as (
    select
      ((statement_timestamp() at time zone 'Asia/Almaty')::date
        - (extract(isodow from statement_timestamp() at time zone 'Asia/Almaty')::integer - 1))::date as current_week_start,
      date_trunc('month', statement_timestamp() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty' as month_start,
      (date_trunc('month', statement_timestamp() at time zone 'Asia/Almaty') + interval '1 month') at time zone 'Asia/Almaty' as next_month_start,
      date_trunc('year', statement_timestamp() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty' as year_start,
      (date_trunc('year', statement_timestamp() at time zone 'Asia/Almaty') + interval '1 year') at time zone 'Asia/Almaty' as next_year_start
  ), selected_rows as (
    select * from public.weekly_payment_rows
    where owner_admin_id = p_owner_admin_id and week_start = p_week_start
  ), selected_totals as (
    select coalesce(sum(amount_due_kzt), 0)::bigint as due,
      coalesce(sum(amount_due_kzt) filter (where paid), 0)::bigint as received
    from selected_rows
  ), actual_totals as (
    select
      coalesce(sum(row.amount_due_kzt) filter (
        where row.paid_at >= (bounds.current_week_start::timestamp at time zone 'Asia/Almaty')
          and row.paid_at < ((bounds.current_week_start + 7)::timestamp at time zone 'Asia/Almaty')
      ), 0)::bigint as week_received,
      coalesce(sum(row.amount_due_kzt) filter (
        where row.paid_at >= bounds.month_start and row.paid_at < bounds.next_month_start
      ), 0)::bigint as month_received,
      coalesce(sum(row.amount_due_kzt) filter (
        where row.paid_at >= bounds.year_start and row.paid_at < bounds.next_year_start
      ), 0)::bigint as year_received
    from public.weekly_payment_rows row cross join bounds
    where row.owner_admin_id = p_owner_admin_id and row.paid
  ), student_totals as (
    select lower(btrim(student_name)) as normalized_name,
      (array_agg(btrim(student_name) order by paid_at desc, id desc))[1] as display_name,
      sum(amount_due_kzt)::bigint as total_paid_kzt,
      max(paid_at) as last_paid_at
    from public.weekly_payment_rows
    where owner_admin_id = p_owner_admin_id and paid
    group by lower(btrim(student_name))
  )
  select case when exists (
    select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN'
  ) then jsonb_build_object(
    'status', 'ok',
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'student_name', student_name, 'subject', subject,
      'price_per_lesson_kzt', price_per_lesson_kzt, 'lessons_count', lessons_count,
      'amount_due_kzt', amount_due_kzt, 'paid', paid, 'paid_at', paid_at,
      'notes', notes, 'sort_order', sort_order
    ) order by sort_order, id) from selected_rows), '[]'::jsonb),
    'selected_week', (select jsonb_build_object(
      'due_kzt', due, 'received_kzt', received, 'remaining_kzt', due - received,
      'percentage', case when due = 0 then 0 else round(received::numeric * 100 / due) end
    ) from selected_totals),
    'actual_received', (select jsonb_build_object(
      'week_kzt', week_received, 'month_kzt', month_received, 'year_kzt', year_received
    ) from actual_totals),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
      'name', display_name, 'total_paid_kzt', total_paid_kzt, 'last_paid_at', last_paid_at
    ) order by total_paid_kzt desc, display_name) from student_totals), '[]'::jsonb)
  ) else jsonb_build_object('status', 'forbidden') end;
$$;

revoke all on function public.set_weekly_payment_paid_atomic(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.copy_previous_weekly_payments_atomic(uuid,date) from public, anon, authenticated;
revoke all on function public.get_weekly_payments_dashboard(uuid,date) from public, anon, authenticated;
grant execute on function public.set_weekly_payment_paid_atomic(uuid,uuid,boolean) to service_role;
grant execute on function public.copy_previous_weekly_payments_atomic(uuid,date) to service_role;
grant execute on function public.get_weekly_payments_dashboard(uuid,date) to service_role;

commit;
