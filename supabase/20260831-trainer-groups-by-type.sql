begin;

alter table public.trainer_groups add column trainer_type text;

drop index public.trainer_groups_owner_title_key;
drop index public.trainer_groups_owner_sort_key;

delete from public.trainer_groups g
where not exists (select 1 from public.trainers t where t.group_id = g.id);

update public.trainer_groups g set trainer_type = (
  select min(t.type) from public.trainers t where t.group_id = g.id
);

do $$
declare
  mixed record;
  theory_group_id uuid;
begin
  for mixed in
    select g.id, g.owner_admin_id, g.title, g.sort_order
    from public.trainer_groups g
    where exists (select 1 from public.trainers t where t.group_id=g.id and t.type='QUICK_PROBLEMS')
      and exists (select 1 from public.trainers t where t.group_id=g.id and t.type='THEORY')
  loop
    update public.trainer_groups set trainer_type='QUICK_PROBLEMS' where id=mixed.id;
    insert into public.trainer_groups(owner_admin_id,trainer_type,title,sort_order)
    values(mixed.owner_admin_id,'THEORY',mixed.title,mixed.sort_order)
    returning id into theory_group_id;
    update public.trainers set group_id=theory_group_id where group_id=mixed.id and type='THEORY';
  end loop;
end;
$$;

alter table public.trainer_groups
  alter column trainer_type set not null,
  add constraint trainer_groups_type_check check (trainer_type in ('QUICK_PROBLEMS','THEORY'));

create unique index trainer_groups_owner_type_title_key
  on public.trainer_groups(owner_admin_id,trainer_type,lower(title));
create unique index trainer_groups_owner_type_sort_key
  on public.trainer_groups(owner_admin_id,trainer_type,sort_order);

create function public.validate_trainer_group_type()
returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.group_id is not null and not exists (
    select 1 from public.trainer_groups g
    where g.id=new.group_id and g.owner_admin_id=new.owner_admin_id and g.trainer_type=new.type
  ) then raise exception using errcode='23514', message='Trainer group owner/type mismatch'; end if;
  return new;
end; $$;
create trigger trainers_validate_group_type
before insert or update of group_id,owner_admin_id,type on public.trainers
for each row execute function public.validate_trainer_group_type();

drop function public.create_trainer_group_atomic(uuid,text);
drop function public.rename_trainer_group_atomic(uuid,uuid,text);
drop function public.delete_trainer_group_atomic(uuid,uuid);
drop function public.move_trainer_to_group_atomic(uuid,uuid,uuid);

create function public.create_trainer_group_atomic(p_owner_admin_id uuid,p_trainer_type text,p_title text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare normalized text:=btrim(p_title); created_id uuid;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  if p_trainer_type not in ('QUICK_PROBLEMS','THEORY') then return jsonb_build_object('status','invalid_type'); end if;
  if normalized='' or char_length(normalized)>120 then return jsonb_build_object('status','invalid_title'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':'||p_trainer_type||':trainer-groups',8202));
  insert into public.trainer_groups(owner_admin_id,trainer_type,title,sort_order)
  values(p_owner_admin_id,p_trainer_type,normalized,coalesce((select max(sort_order)+1 from public.trainer_groups where owner_admin_id=p_owner_admin_id and trainer_type=p_trainer_type),0))
  returning id into created_id;
  return jsonb_build_object('status','created','id',created_id);
exception when unique_violation then return jsonb_build_object('status','duplicate');
end; $$;

create function public.rename_trainer_group_atomic(p_owner_admin_id uuid,p_group_id uuid,p_trainer_type text,p_title text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare normalized text:=btrim(p_title);
begin
  if p_trainer_type not in ('QUICK_PROBLEMS','THEORY') then return jsonb_build_object('status','invalid_type'); end if;
  if normalized='' or char_length(normalized)>120 then return jsonb_build_object('status','invalid_title'); end if;
  update public.trainer_groups set title=normalized,updated_at=now()
  where id=p_group_id and owner_admin_id=p_owner_admin_id and trainer_type=p_trainer_type;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','renamed');
exception when unique_violation then return jsonb_build_object('status','duplicate');
end; $$;

create function public.delete_trainer_group_atomic(p_owner_admin_id uuid,p_group_id uuid,p_trainer_type text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if p_trainer_type not in ('QUICK_PROBLEMS','THEORY') then return jsonb_build_object('status','invalid_type'); end if;
  delete from public.trainer_groups where id=p_group_id and owner_admin_id=p_owner_admin_id and trainer_type=p_trainer_type;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','deleted');
end; $$;

create function public.move_trainer_to_group_atomic(p_owner_admin_id uuid,p_trainer_id uuid,p_group_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare trainer_type_value text;
begin
  select type into trainer_type_value from public.trainers where id=p_trainer_id and owner_admin_id=p_owner_admin_id for update;
  if not found then return jsonb_build_object('status','trainer_not_found'); end if;
  if p_group_id is not null and not exists(select 1 from public.trainer_groups where id=p_group_id and owner_admin_id=p_owner_admin_id and trainer_type=trainer_type_value) then return jsonb_build_object('status','group_not_found'); end if;
  update public.trainers set group_id=p_group_id where id=p_trainer_id and owner_admin_id=p_owner_admin_id;
  return jsonb_build_object('status','moved');
end; $$;

revoke all on function public.create_trainer_group_atomic(uuid,text,text),public.rename_trainer_group_atomic(uuid,uuid,text,text),public.delete_trainer_group_atomic(uuid,uuid,text),public.move_trainer_to_group_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_trainer_group_atomic(uuid,text,text),public.rename_trainer_group_atomic(uuid,uuid,text,text),public.delete_trainer_group_atomic(uuid,uuid,text),public.move_trainer_to_group_atomic(uuid,uuid,uuid) to service_role;

commit;
