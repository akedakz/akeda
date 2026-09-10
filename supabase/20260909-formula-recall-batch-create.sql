begin;

create table public.formula_recall_batch_requests (
  owner_admin_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  topic_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (owner_admin_id, request_id),
  foreign key (topic_id, owner_admin_id) references public.formula_recall_topics(id, owner_admin_id) on delete cascade
);

comment on table public.formula_recall_batch_requests is
  'Idempotency records for Formula Recall batch creation. No automatic cleanup is scheduled; rows may be pruned only after the accepted client retry window.';

alter table public.formula_recall_batch_requests enable row level security;
revoke all on table public.formula_recall_batch_requests from public, anon, authenticated, service_role;

create function public.save_formula_recall_formulas_batch_atomic(
  p_owner_admin_id uuid,
  p_topic_id uuid,
  p_request_id uuid,
  p_formulas jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  formula_item jsonb;
  formula_number bigint;
  condition_item jsonb;
  condition_number bigint;
  alternative_item jsonb;
  alternative_number bigint;
  normalized_conditions jsonb;
  normalized_alternatives jsonb;
  normalized_formulas jsonb := '[]'::jsonb;
  normalized_payload jsonb;
  normalized_hash text;
  stored_request public.formula_recall_batch_requests;
  save_result jsonb;
  result_payload jsonb;
  formula_ids jsonb := '[]'::jsonb;
  failure_index integer := null;
  failure_code text := null;
  failure_field text := null;
  has_stored_request boolean := false;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then
    return jsonb_build_object('status','forbidden');
  end if;
  if p_request_id is null then
    return jsonb_build_object('status','invalid_batch');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':'||p_request_id::text||':formula-recall-batch',8202));
  select * into stored_request from public.formula_recall_batch_requests
    where owner_admin_id=p_owner_admin_id and request_id=p_request_id;
  has_stored_request := found;

  if p_topic_id is null or coalesce(jsonb_typeof(p_formulas),'null') <> 'array' then
    if has_stored_request then return jsonb_build_object('status','request_conflict'); end if;
    return jsonb_build_object('status','invalid_batch');
  end if;
  if jsonb_array_length(p_formulas) not between 1 and 50 or char_length(p_formulas::text) > 250000 then
    if has_stored_request then return jsonb_build_object('status','request_conflict'); end if;
    return jsonb_build_object('status','invalid_batch');
  end if;

  for formula_item, formula_number in
    select value, ordinality from jsonb_array_elements(p_formulas) with ordinality
  loop
    if jsonb_typeof(formula_item) <> 'object'
      or coalesce(jsonb_typeof(formula_item->'canonical_expression'),'null') <> 'string'
      or coalesce(jsonb_typeof(formula_item->'conditions'),'null') <> 'array'
      or coalesce(jsonb_typeof(formula_item->'alternatives'),'null') <> 'array' then
      if has_stored_request then return jsonb_build_object('status','request_conflict'); end if;
      return jsonb_build_object('status','invalid_formula','formula_index',formula_number-1,'field','formula','code','invalid_shape');
    end if;

    normalized_conditions := '[]'::jsonb;
    for condition_item, condition_number in
      select value, ordinality from jsonb_array_elements(formula_item->'conditions') with ordinality
    loop
      if jsonb_typeof(condition_item) <> 'object'
        or coalesce(jsonb_typeof(condition_item->'id'),'null') <> 'string'
        or coalesce(jsonb_typeof(condition_item->'text'),'null') <> 'string' then
        if has_stored_request then return jsonb_build_object('status','request_conflict'); end if;
        return jsonb_build_object('status','invalid_formula','formula_index',formula_number-1,'field','conditions','code','invalid_shape');
      end if;
      normalized_conditions := normalized_conditions || jsonb_build_array(jsonb_build_object(
        'id', lower(btrim(condition_item->>'id')),
        'text', btrim(condition_item->>'text')
      ));
    end loop;

    normalized_alternatives := '[]'::jsonb;
    for alternative_item, alternative_number in
      select value, ordinality from jsonb_array_elements(formula_item->'alternatives') with ordinality
    loop
      if jsonb_typeof(alternative_item) <> 'object'
        or coalesce(jsonb_typeof(alternative_item->'id'),'null') <> 'string'
        or coalesce(jsonb_typeof(alternative_item->'expression'),'null') <> 'string' then
        if has_stored_request then return jsonb_build_object('status','request_conflict'); end if;
        return jsonb_build_object('status','invalid_formula','formula_index',formula_number-1,'field','alternatives','code','invalid_shape');
      end if;
      normalized_alternatives := normalized_alternatives || jsonb_build_array(jsonb_build_object(
        'id', lower(btrim(alternative_item->>'id')),
        'expression', btrim(alternative_item->>'expression')
      ));
    end loop;

    normalized_formulas := normalized_formulas || jsonb_build_array(jsonb_build_object(
      'canonical_expression', btrim(formula_item->>'canonical_expression'),
      'conditions', normalized_conditions,
      'alternatives', normalized_alternatives
    ));
  end loop;

  normalized_payload := jsonb_build_object('topic_id',p_topic_id::text,'formulas',normalized_formulas);
  normalized_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized_payload::text,'UTF8')),'hex');

  if has_stored_request then
    if stored_request.payload_hash <> normalized_hash then
      return jsonb_build_object('status','request_conflict');
    end if;
    return jsonb_set(stored_request.result,'{status}','"already_saved"'::jsonb,false);
  end if;

  perform 1 from public.formula_recall_topics where id=p_topic_id and owner_admin_id=p_owner_admin_id for update;
  if not found then return jsonb_build_object('status','topic_not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':'||p_topic_id::text||':formula-recall-formulas',8202));

  begin
    for formula_item, formula_number in
      select value, ordinality from jsonb_array_elements(normalized_formulas) with ordinality
    loop
      save_result := public.save_formula_recall_formula_atomic(
        p_owner_admin_id,
        null,
        p_topic_id,
        null,
        formula_item->>'canonical_expression',
        formula_item->'conditions',
        formula_item->'alternatives'
      );
      if save_result->>'status' is distinct from 'saved' then
        failure_index := (formula_number-1)::integer;
        failure_code := coalesce(save_result->>'status','save_failed');
        failure_field := case failure_code
          when 'duplicate_expression' then 'alternatives'
          when 'invalid_child' then 'conditions_or_alternatives'
          when 'invalid' then 'formula'
          else 'formula'
        end;
        raise exception using errcode='FRB01', message='FORMULA_BATCH_REJECTED';
      end if;
      formula_ids := formula_ids || jsonb_build_array(save_result->'formula_id');
    end loop;

    result_payload := jsonb_build_object('status','saved','formula_ids',formula_ids);
    insert into public.formula_recall_batch_requests(owner_admin_id,request_id,topic_id,payload_hash,result)
      values(p_owner_admin_id,p_request_id,p_topic_id,normalized_hash,result_payload);
    return result_payload;
  exception
    when sqlstate 'FRB01' then
      return jsonb_build_object('status','invalid_formula','formula_index',failure_index,'field',failure_field,'code',failure_code);
    when others then
      return jsonb_build_object('status','save_failed');
  end;
end;
$$;

revoke all on function public.save_formula_recall_formulas_batch_atomic(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_formula_recall_formulas_batch_atomic(uuid,uuid,uuid,jsonb) to service_role;

commit;
