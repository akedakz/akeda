begin;

create function public.delete_completed_trainer_result_atomic(p_owner_admin_id uuid, p_student_id uuid, p_completion_id uuid, p_trainer_type text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  source_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN') then
    return jsonb_build_object('status', 'admin_not_found');
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT') then
    return jsonb_build_object('status', 'student_not_found');
  end if;
  if p_trainer_type not in ('QUICK_PROBLEMS', 'THEORY') then
    return jsonb_build_object('status', 'invalid_type');
  end if;

  if p_trainer_type = 'THEORY' then
    select source_trainer_id into source_id from public.trainer_theory_completion_history
    where id = p_completion_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id;
  else
    select source_trainer_id into source_id from public.trainer_completion_history
    where id = p_completion_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id and trainer_type = 'QUICK_PROBLEMS';
  end if;
  if not found then return jsonb_build_object('status', 'completion_not_found'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':' || coalesce(source_id::text, 'completion:' || p_completion_id::text), 8201));

  if p_trainer_type = 'THEORY' then
    perform 1 from public.trainer_theory_completion_history
    where id = p_completion_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id for update;
    if not found then return jsonb_build_object('status', 'completion_not_found'); end if;
    delete from public.trainer_theory_completion_history where id = p_completion_id;
  else
    perform 1 from public.trainer_completion_history
    where id = p_completion_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id and trainer_type = 'QUICK_PROBLEMS' for update;
    if not found then return jsonb_build_object('status', 'completion_not_found'); end if;
    delete from public.trainer_completion_history where id = p_completion_id;
  end if;

  return jsonb_build_object('status', 'deleted');
end;
$$;

create or replace function public.get_theory_student_summary(p_student_id uuid,p_owner_admin_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public,pg_temp stable as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.sort_at desc),'[]'::jsonb) from (
    select 'ACTIVE'::text kind,a.id assignment_id,null::uuid completion_id,t.id source_trainer_id,t.title,a.assigned_at sort_at,null::timestamptz completed_at,
      jsonb_array_length(t.definition->'questions') question_count,
      coalesce((select sum(least(3,coalesce(p.correct_count,0))) from jsonb_array_elements(t.definition->'questions') q left join public.trainer_theory_question_progress p on p.assignment_id=a.id and p.question_key=q->>'key' and p.question_fingerprint=q->>'fingerprint'),0)::integer earned,
      false can_restart
    from public.trainer_assignments a join public.trainers t on t.id=a.trainer_id and t.type='THEORY' and t.status='PUBLISHED'
    where a.student_id=p_student_id and (p_owner_admin_id is null or a.owner_admin_id=p_owner_admin_id)
    union all
    select 'COMPLETED',null,h.id,h.source_trainer_id,h.title_snapshot,coalesce(h.assigned_at,h.completed_at),h.completed_at,h.question_count_snapshot,h.required_points_snapshot,
      exists(select 1 from public.trainers t where t.id=h.source_trainer_id and t.owner_admin_id=h.owner_admin_id and t.type='THEORY' and t.status='PUBLISHED')
    from public.trainer_theory_completion_history h where h.student_id=p_student_id and (p_owner_admin_id is null or h.owner_admin_id=p_owner_admin_id)
  ) s;
$$;

revoke all on function public.delete_completed_trainer_result_atomic(uuid, uuid, uuid, text), public.get_theory_student_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_completed_trainer_result_atomic(uuid, uuid, uuid, text), public.get_theory_student_summary(uuid, uuid) to service_role;

commit;
