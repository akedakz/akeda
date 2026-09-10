begin;

create or replace function public.move_trainer_group_atomic(
  p_owner_admin_id uuid,
  p_group_id uuid,
  p_trainer_type text,
  p_direction integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  current_row public.trainer_groups;
  neighbor_row public.trainer_groups;
  temporary_order integer;
begin
  if p_trainer_type not in ('QUICK_PROBLEMS','THEORY') or p_direction not in (-1,1) then
    return jsonb_build_object('status','invalid');
  end if;
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then
    return jsonb_build_object('status','forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':'||p_trainer_type||':trainer-groups',8202));
  select * into current_row from public.trainer_groups
  where id=p_group_id and owner_admin_id=p_owner_admin_id and trainer_type=p_trainer_type for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if p_direction=-1 then
    select * into neighbor_row from public.trainer_groups
    where owner_admin_id=p_owner_admin_id and trainer_type=p_trainer_type and sort_order<current_row.sort_order
    order by sort_order desc limit 1 for update;
  else
    select * into neighbor_row from public.trainer_groups
    where owner_admin_id=p_owner_admin_id and trainer_type=p_trainer_type and sort_order>current_row.sort_order
    order by sort_order limit 1 for update;
  end if;
  if not found then return jsonb_build_object('status','boundary'); end if;
  select coalesce(max(sort_order),-1)+1 into temporary_order from public.trainer_groups
  where owner_admin_id=p_owner_admin_id and trainer_type=p_trainer_type;
  update public.trainer_groups set sort_order=temporary_order,updated_at=now() where id=current_row.id;
  update public.trainer_groups set sort_order=current_row.sort_order,updated_at=now() where id=neighbor_row.id;
  update public.trainer_groups set sort_order=neighbor_row.sort_order,updated_at=now() where id=current_row.id;
  return jsonb_build_object('status','moved');
end; $$;

create or replace function public.move_formula_recall_topic_atomic(
  p_owner_admin_id uuid,
  p_topic_id uuid,
  p_direction integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  current_row public.formula_recall_topics;
  neighbor_row public.formula_recall_topics;
  temporary_order integer;
begin
  if p_direction not in (-1,1) then return jsonb_build_object('status','invalid'); end if;
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then
    return jsonb_build_object('status','forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':formula-recall-topics',8202));
  select * into current_row from public.formula_recall_topics
  where id=p_topic_id and owner_admin_id=p_owner_admin_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if p_direction=-1 then
    select * into neighbor_row from public.formula_recall_topics
    where owner_admin_id=p_owner_admin_id and sort_order<current_row.sort_order
    order by sort_order desc limit 1 for update;
  else
    select * into neighbor_row from public.formula_recall_topics
    where owner_admin_id=p_owner_admin_id and sort_order>current_row.sort_order
    order by sort_order limit 1 for update;
  end if;
  if not found then return jsonb_build_object('status','boundary'); end if;
  select coalesce(max(sort_order),-1)+1 into temporary_order from public.formula_recall_topics where owner_admin_id=p_owner_admin_id;
  update public.formula_recall_topics set sort_order=temporary_order,updated_at=now() where id=current_row.id;
  update public.formula_recall_topics set sort_order=current_row.sort_order,updated_at=now() where id=neighbor_row.id;
  update public.formula_recall_topics set sort_order=neighbor_row.sort_order,updated_at=now() where id=current_row.id;
  return jsonb_build_object('status','moved');
end; $$;

revoke all on function public.move_trainer_group_atomic(uuid,uuid,text,integer), public.move_formula_recall_topic_atomic(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.move_trainer_group_atomic(uuid,uuid,text,integer), public.move_formula_recall_topic_atomic(uuid,uuid,integer) to service_role;

commit;
