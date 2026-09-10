begin;

-- New admin batch entry points; existing runtime functions remain unchanged.
create function public.assign_trainers_batch_atomic(p_owner_admin_id uuid, p_student_id uuid, p_trainer_type text, p_trainer_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare trainer_id uuid; result jsonb; inserted_count integer := 0;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN')
    or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then
    return jsonb_build_object('status','forbidden');
  end if;
  if p_trainer_type is null or p_trainer_type not in ('QUICK_PROBLEMS','THEORY')
    or p_trainer_ids is null or cardinality(p_trainer_ids) not between 1 and 500
    or (select count(distinct id) from unnest(p_trainer_ids) ids(id)) <> cardinality(p_trainer_ids) then
    return jsonb_build_object('status','invalid');
  end if;
  -- Same locks as legacy assign/restart, acquired deterministically for the batch.
  for trainer_id in select id from unnest(p_trainer_ids) ids(id) order by id loop
    perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':' || trainer_id::text,8201));
  end loop;
  perform 1 from public.trainers where id=any(p_trainer_ids) order by id for share;
  if (select count(*) from public.trainers where id=any(p_trainer_ids) and owner_admin_id=p_owner_admin_id
      and type=p_trainer_type and (type<>'THEORY' or status='PUBLISHED')) <> cardinality(p_trainer_ids) then
    return jsonb_build_object('status','invalid_trainer');
  end if;
  if p_trainer_type='THEORY' and exists(select 1 from public.trainer_theory_completion_history
    where student_id=p_student_id and owner_admin_id=p_owner_admin_id and source_trainer_id=any(p_trainer_ids)) then
    return jsonb_build_object('status','already_completed');
  end if;
  for trainer_id in select id from unnest(p_trainer_ids) ids(id) order by id loop
    result := public.assign_trainer_atomic(p_owner_admin_id,p_student_id,trainer_id);
    if result->>'status'='created' then inserted_count := inserted_count+1;
    elsif result->>'status' is distinct from 'already_assigned' then
      -- An exception rolls back every preceding assignment in this invocation.
      raise exception using errcode='P0001', message='TRAINER_BATCH_REJECTED';
    end if;
  end loop;
  return jsonb_build_object('status','assigned','inserted',inserted_count);
end; $$;

create function public.unassign_formula_recall_formulas_batch_atomic(p_owner_admin_id uuid, p_student_id uuid, p_assignment_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare deleted_count integer;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN')
    or not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then
    return jsonb_build_object('status','forbidden');
  end if;
  if p_assignment_ids is null or cardinality(p_assignment_ids) not between 1 and 500
    or (select count(distinct id) from unnest(p_assignment_ids) ids(id)) <> cardinality(p_assignment_ids) then
    return jsonb_build_object('status','invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':formula-recall-runtime',8404));
  if exists(select 1 from public.formula_recall_student_formulas where id=any(p_assignment_ids)
    and (student_id<>p_student_id or owner_admin_id<>p_owner_admin_id)) then
    return jsonb_build_object('status','forbidden');
  end if;
  -- Preserve legacy unassign order: runtime -> formulas -> assignments -> tasks -> retries.
  perform 1 from public.formula_recall_formulas where id in
    (select formula_id from public.formula_recall_student_formulas where id=any(p_assignment_ids)
      and student_id=p_student_id and owner_admin_id=p_owner_admin_id) order by id for share;
  perform 1 from public.formula_recall_student_formulas where id=any(p_assignment_ids)
    and student_id=p_student_id and owner_admin_id=p_owner_admin_id order by id for update;
  perform 1 from public.formula_recall_tasks where student_formula_id=any(p_assignment_ids)
    and student_id=p_student_id and owner_admin_id=p_owner_admin_id order by id for update;
  perform 1 from public.formula_recall_retries where student_formula_id=any(p_assignment_ids)
    and student_id=p_student_id and owner_admin_id=p_owner_admin_id order by id for update;
  -- Same DELETE/cascades as single unassign; absent IDs are safe duplicate replays.
  delete from public.formula_recall_student_formulas where id=any(p_assignment_ids)
    and student_id=p_student_id and owner_admin_id=p_owner_admin_id;
  get diagnostics deleted_count=row_count;
  return jsonb_build_object('status','unassigned','deleted',deleted_count);
end; $$;

revoke all on function public.assign_trainers_batch_atomic(uuid,uuid,text,uuid[]),
  public.unassign_formula_recall_formulas_batch_atomic(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.assign_trainers_batch_atomic(uuid,uuid,text,uuid[]),
  public.unassign_formula_recall_formulas_batch_atomic(uuid,uuid,uuid[]) to service_role;

commit;
