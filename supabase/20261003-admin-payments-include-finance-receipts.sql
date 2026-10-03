begin;

create or replace function public.get_weekly_payments_dashboard(
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
  ), received_events as (
    select
      row.amount_due_kzt::bigint as amount_kzt,
      row.paid_at as received_at,
      btrim(row.student_name) as display_name,
      lower(btrim(row.student_name)) as normalized_name
    from public.weekly_payment_rows row
    where row.owner_admin_id = p_owner_admin_id and row.paid

    union all

    select
      entry.amount_kzt::bigint as amount_kzt,
      entry.created_at as received_at,
      coalesce(nullif(btrim(student.full_name), ''), student.email, 'Ученик') as display_name,
      lower(btrim(coalesce(nullif(student.full_name, ''), student.email, 'Ученик'))) as normalized_name
    from public.student_financial_entries entry
    join public.profiles student
      on student.id = entry.student_id and student.role = 'STUDENT'
    where entry.created_by = p_owner_admin_id
      and entry.entry_type = 'PAYMENT'
      and entry.amount_kzt > 0
  ), actual_totals as (
    select
      coalesce(sum(event.amount_kzt) filter (
        where event.received_at >= (bounds.current_week_start::timestamp at time zone 'Asia/Almaty')
          and event.received_at < ((bounds.current_week_start + 7)::timestamp at time zone 'Asia/Almaty')
      ), 0)::bigint as week_received,
      coalesce(sum(event.amount_kzt) filter (
        where event.received_at >= bounds.month_start and event.received_at < bounds.next_month_start
      ), 0)::bigint as month_received,
      coalesce(sum(event.amount_kzt) filter (
        where event.received_at >= bounds.year_start and event.received_at < bounds.next_year_start
      ), 0)::bigint as year_received
    from received_events event cross join bounds
  ), student_totals as (
    select normalized_name,
      (array_agg(display_name order by received_at desc))[1] as display_name,
      sum(amount_kzt)::bigint as total_paid_kzt,
      max(received_at) as last_paid_at
    from received_events
    group by normalized_name
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

revoke all on function public.get_weekly_payments_dashboard(uuid,date) from public, anon, authenticated;
grant execute on function public.get_weekly_payments_dashboard(uuid,date) to service_role;

commit;
