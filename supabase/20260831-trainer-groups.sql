begin;

create table public.trainer_groups (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 120),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index trainer_groups_owner_title_key on public.trainer_groups(owner_admin_id, lower(title));
create unique index trainer_groups_owner_sort_key on public.trainer_groups(owner_admin_id, sort_order);
alter table public.trainer_groups enable row level security;
revoke all on table public.trainer_groups from public, anon, authenticated;
grant select, insert, update, delete on table public.trainer_groups to service_role;

alter table public.trainers add column group_id uuid references public.trainer_groups(id) on delete set null;
create index trainers_owner_group_idx on public.trainers(owner_admin_id, group_id);

create function public.create_trainer_group_atomic(p_owner_admin_id uuid, p_title text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare normalized text := btrim(p_title); created public.trainer_groups;
begin
  if not exists(select 1 from public.profiles where id=p_owner_admin_id and role='ADMIN') then return jsonb_build_object('status','forbidden'); end if;
  if normalized='' or char_length(normalized)>120 then return jsonb_build_object('status','invalid_title'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text || ':trainer-groups', 8202));
  insert into public.trainer_groups(owner_admin_id,title,sort_order)
  values(p_owner_admin_id,normalized,coalesce((select max(sort_order)+1 from public.trainer_groups where owner_admin_id=p_owner_admin_id),0))
  returning * into created;
  return jsonb_build_object('status','created','id',created.id);
exception when unique_violation then return jsonb_build_object('status','duplicate');
end; $$;

create function public.rename_trainer_group_atomic(p_owner_admin_id uuid, p_group_id uuid, p_title text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare normalized text := btrim(p_title);
begin
  if normalized='' or char_length(normalized)>120 then return jsonb_build_object('status','invalid_title'); end if;
  update public.trainer_groups set title=normalized,updated_at=now() where id=p_group_id and owner_admin_id=p_owner_admin_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','renamed');
exception when unique_violation then return jsonb_build_object('status','duplicate');
end; $$;

create function public.delete_trainer_group_atomic(p_owner_admin_id uuid, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  delete from public.trainer_groups where id=p_group_id and owner_admin_id=p_owner_admin_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','deleted');
end; $$;

create function public.move_trainer_to_group_atomic(p_owner_admin_id uuid, p_trainer_id uuid, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if p_group_id is not null and not exists(select 1 from public.trainer_groups where id=p_group_id and owner_admin_id=p_owner_admin_id) then return jsonb_build_object('status','group_not_found'); end if;
  update public.trainers set group_id=p_group_id where id=p_trainer_id and owner_admin_id=p_owner_admin_id;
  if not found then return jsonb_build_object('status','trainer_not_found'); end if;
  return jsonb_build_object('status','moved');
end; $$;

create or replace function public.get_theory_student_summary(p_student_id uuid,p_owner_admin_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public,pg_temp stable as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.sort_at desc),'[]'::jsonb) from (
    select 'ACTIVE'::text kind,a.id assignment_id,null::uuid completion_id,t.id source_trainer_id,t.group_id,t.title,a.assigned_at sort_at,null::timestamptz completed_at,
      jsonb_array_length(t.definition->'questions') question_count,
      coalesce((select sum(least(3,coalesce(p.correct_count,0))) from jsonb_array_elements(t.definition->'questions') q left join public.trainer_theory_question_progress p on p.assignment_id=a.id and p.question_key=q->>'key' and p.question_fingerprint=q->>'fingerprint'),0)::integer earned,
      false can_restart
    from public.trainer_assignments a join public.trainers t on t.id=a.trainer_id and t.type='THEORY' and t.status='PUBLISHED'
    where a.student_id=p_student_id and (p_owner_admin_id is null or a.owner_admin_id=p_owner_admin_id)
    union all
    select 'COMPLETED',null,h.id,h.source_trainer_id,t.group_id,h.title_snapshot,coalesce(h.assigned_at,h.completed_at),h.completed_at,h.question_count_snapshot,h.required_points_snapshot,
      (t.id is not null and t.owner_admin_id=h.owner_admin_id and t.type='THEORY' and t.status='PUBLISHED')
    from public.trainer_theory_completion_history h left join public.trainers t on t.id=h.source_trainer_id
    where h.student_id=p_student_id and (p_owner_admin_id is null or h.owner_admin_id=p_owner_admin_id)
  ) s;
$$;

revoke all on function public.create_trainer_group_atomic(uuid,text),public.rename_trainer_group_atomic(uuid,uuid,text),public.delete_trainer_group_atomic(uuid,uuid),public.move_trainer_to_group_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_trainer_group_atomic(uuid,text),public.rename_trainer_group_atomic(uuid,uuid,text),public.delete_trainer_group_atomic(uuid,uuid),public.move_trainer_to_group_atomic(uuid,uuid,uuid) to service_role;

commit;
