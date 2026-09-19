begin;

create table public.student_payment_claim_allocations (
  claim_id uuid not null references public.student_payment_claims(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  amount_kzt bigint not null check (amount_kzt > 0),
  financial_entry_id uuid not null references public.student_financial_entries(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (claim_id, student_id),
  unique (financial_entry_id)
);

create index student_payment_claim_allocations_student_idx
  on public.student_payment_claim_allocations(student_id, created_at desc);

alter table public.student_payment_claim_allocations enable row level security;
revoke all on public.student_payment_claim_allocations from public, anon, authenticated;
grant all on public.student_payment_claim_allocations to service_role;

create or replace function public.review_student_payment_claim_atomic(
  p_claim_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_review_note text,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.student_payment_claims%rowtype;
  v_allocation record;
  v_entry_id uuid;
  v_first_entry_id uuid;
  v_count integer;
  v_distinct_count integer;
  v_total bigint;
  v_student_ids jsonb := '[]'::jsonb;
begin
  if p_claim_id is null
     or p_admin_id is null
     or p_decision not in ('CONFIRM','REJECT')
     or length(coalesce(p_review_note,'')) > 500
     or not exists (
       select 1 from public.profiles where id = p_admin_id and role = 'ADMIN'
     ) then
    return jsonb_build_object('status','invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_claim_id::text || ':payment-claim', 9161));

  select * into v_claim
  from public.student_payment_claims
  where id = p_claim_id
  for update;

  if not found then
    return jsonb_build_object('status','not_found');
  end if;

  if v_claim.status <> 'PENDING' then
    select coalesce(jsonb_agg(a.student_id order by a.student_id), '[]'::jsonb)
      into v_student_ids
    from public.student_payment_claim_allocations a
    where a.claim_id = v_claim.id;
    return jsonb_build_object(
      'status', lower(v_claim.status),
      'student_ids', v_student_ids,
      'replayed', true
    );
  end if;

  if p_decision = 'REJECT' then
    update public.student_payment_claims
    set status = 'REJECTED', reviewed_by = p_admin_id, reviewed_at = now(),
        review_note = nullif(btrim(p_review_note),'')
    where id = p_claim_id;
    return jsonb_build_object('status','rejected','student_ids',jsonb_build_array(v_claim.student_id),'replayed',false);
  end if;

  if p_allocations is null
     or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) < 1
     or jsonb_array_length(p_allocations) > 20
     or exists (
       select 1 from jsonb_array_elements(p_allocations) item
       where jsonb_typeof(item) <> 'object'
          or coalesce(item->>'student_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or coalesce(item->>'amount_kzt','') !~ '^[1-9][0-9]*$'
     ) then
    return jsonb_build_object('status','invalid_allocations');
  end if;

  select count(*), count(distinct item->>'student_id'), sum((item->>'amount_kzt')::bigint)
    into v_count, v_distinct_count, v_total
  from jsonb_array_elements(p_allocations) item;

  if v_count <> v_distinct_count or v_total <> v_claim.amount_kzt then
    return jsonb_build_object('status','invalid_allocations');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_allocations) item
    left join public.profiles student on student.id = (item->>'student_id')::uuid
    where student.id is null
       or student.role <> 'STUDENT'
       or student.parent_id is distinct from v_claim.reported_by
  ) then
    return jsonb_build_object('status','invalid_allocations');
  end if;

  for v_allocation in
    select (item->>'student_id')::uuid as student_id,
           (item->>'amount_kzt')::bigint as amount_kzt
    from jsonb_array_elements(p_allocations) item
    order by item->>'student_id'
  loop
    insert into public.student_financial_entries(
      student_id, entry_type, amount_kzt, note, created_by
    ) values (
      v_allocation.student_id, 'PAYMENT', v_allocation.amount_kzt,
      'Kaspi · подтверждено по заявке', p_admin_id
    ) returning id into v_entry_id;

    insert into public.student_payment_claim_allocations(
      claim_id, student_id, amount_kzt, financial_entry_id
    ) values (
      v_claim.id, v_allocation.student_id, v_allocation.amount_kzt, v_entry_id
    );

    if v_first_entry_id is null then v_first_entry_id := v_entry_id; end if;
    v_student_ids := v_student_ids || to_jsonb(v_allocation.student_id);
  end loop;

  update public.student_payment_claims
  set status = 'CONFIRMED', reviewed_by = p_admin_id, reviewed_at = now(),
      review_note = nullif(btrim(p_review_note),''), financial_entry_id = v_first_entry_id
  where id = p_claim_id;

  return jsonb_build_object(
    'status','confirmed', 'student_ids',v_student_ids,
    'financial_entry_id',v_first_entry_id, 'replayed',false
  );
end;
$$;

revoke execute on function public.review_student_payment_claim_atomic(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.review_student_payment_claim_atomic(uuid,uuid,text,text,jsonb)
  to service_role;

commit;
