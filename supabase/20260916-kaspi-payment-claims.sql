begin;

create table public.student_payment_claims (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  reported_by uuid not null references public.profiles(id) on delete cascade,
  amount_kzt bigint not null check (amount_kzt between 1 and 1000000000),
  status text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','REJECTED')),
  created_at timestamptz not null default now(),
  reviewed_by uuid null references public.profiles(id) on delete set null,
  reviewed_at timestamptz null,
  review_note text null check (review_note is null or length(review_note) <= 500),
  financial_entry_id uuid null references public.student_financial_entries(id) on delete set null,
  check (
    (status = 'PENDING' and reviewed_by is null and reviewed_at is null and financial_entry_id is null)
    or
    (status = 'REJECTED' and reviewed_by is not null and reviewed_at is not null and financial_entry_id is null)
    or
    (status = 'CONFIRMED' and reviewed_by is not null and reviewed_at is not null and financial_entry_id is not null)
  )
);

create unique index student_payment_claims_one_pending_per_reporter
  on public.student_payment_claims(student_id, reported_by)
  where status = 'PENDING';

create index student_payment_claims_pending_created_idx
  on public.student_payment_claims(created_at desc)
  where status = 'PENDING';

create index student_payment_claims_student_created_idx
  on public.student_payment_claims(student_id, created_at desc);

alter table public.student_payment_claims enable row level security;
revoke all on public.student_payment_claims from public, anon, authenticated;
grant all on public.student_payment_claims to service_role;

create or replace function public.review_student_payment_claim_atomic(
  p_claim_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_review_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.student_payment_claims%rowtype;
  v_entry_id uuid;
begin
  if p_claim_id is null
     or p_admin_id is null
     or p_decision not in ('CONFIRM','REJECT')
     or length(coalesce(p_review_note,'')) > 500
     or not exists (
       select 1
       from public.profiles
       where id = p_admin_id and role = 'ADMIN'
     ) then
    return jsonb_build_object('status','invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_claim_id::text || ':payment-claim', 9161));

  select *
  into v_claim
  from public.student_payment_claims
  where id = p_claim_id
  for update;

  if not found then
    return jsonb_build_object('status','not_found');
  end if;

  if v_claim.status <> 'PENDING' then
    return jsonb_build_object(
      'status', lower(v_claim.status),
      'student_id', v_claim.student_id,
      'replayed', true
    );
  end if;

  if p_decision = 'REJECT' then
    update public.student_payment_claims
    set status = 'REJECTED',
        reviewed_by = p_admin_id,
        reviewed_at = now(),
        review_note = nullif(btrim(p_review_note),'')
    where id = p_claim_id;

    return jsonb_build_object(
      'status','rejected',
      'student_id',v_claim.student_id,
      'replayed',false
    );
  end if;

  insert into public.student_financial_entries(
    student_id,
    entry_type,
    amount_kzt,
    note,
    created_by,
    operation_key
  )
  values(
    v_claim.student_id,
    'PAYMENT',
    v_claim.amount_kzt,
    'Kaspi · подтверждено по заявке',
    p_admin_id,
    v_claim.id
  )
  returning id into v_entry_id;

  update public.student_payment_claims
  set status = 'CONFIRMED',
      reviewed_by = p_admin_id,
      reviewed_at = now(),
      review_note = nullif(btrim(p_review_note),''),
      financial_entry_id = v_entry_id
  where id = p_claim_id;

  return jsonb_build_object(
    'status','confirmed',
    'student_id',v_claim.student_id,
    'financial_entry_id',v_entry_id,
    'replayed',false
  );
end;
$$;

revoke execute on function public.review_student_payment_claim_atomic(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_student_payment_claim_atomic(uuid,uuid,text,text) to service_role;

commit;
