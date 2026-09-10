begin;

create function public.restart_completed_theory_trainer_atomic(p_owner_admin_id uuid, p_student_id uuid, p_completion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  completion public.trainer_theory_completion_history%rowtype;
  source_id uuid;
  source_trainer public.trainers%rowtype;
  assignment_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_owner_admin_id and role = 'ADMIN') then
    return jsonb_build_object('status', 'admin_not_found');
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT') then
    return jsonb_build_object('status', 'student_not_found');
  end if;

  select source_trainer_id into source_id
  from public.trainer_theory_completion_history
  where id = p_completion_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id;
  if not found then return jsonb_build_object('status', 'completion_not_found'); end if;
  if source_id is null then return jsonb_build_object('status', 'trainer_not_found'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':' || source_id::text, 8201));

  select * into completion
  from public.trainer_theory_completion_history
  where id = p_completion_id and student_id = p_student_id and owner_admin_id = p_owner_admin_id
  for update;
  if not found then return jsonb_build_object('status', 'completion_not_found'); end if;

  select * into source_trainer
  from public.trainers
  where id = completion.source_trainer_id and owner_admin_id = p_owner_admin_id and type = 'THEORY'
  for share;
  if not found then return jsonb_build_object('status', 'trainer_not_found'); end if;
  if source_trainer.status <> 'PUBLISHED' then return jsonb_build_object('status', 'trainer_not_published'); end if;
  if jsonb_typeof(source_trainer.definition->'questions') <> 'array' or jsonb_array_length(source_trainer.definition->'questions') < 1 then
    return jsonb_build_object('status', 'trainer_not_published');
  end if;
  if exists (select 1 from public.trainer_assignments where student_id = p_student_id and trainer_id = source_trainer.id) then
    return jsonb_build_object('status', 'already_assigned');
  end if;

  perform set_config('nsp.restart_trainer_key', p_student_id::text || ':' || source_trainer.id::text, true);
  delete from public.trainer_theory_completion_history where id = completion.id;
  insert into public.trainer_assignments(trainer_id, student_id, owner_admin_id)
  values(source_trainer.id, p_student_id, p_owner_admin_id)
  returning id into assignment_id;

  return jsonb_build_object('status', 'restarted', 'assignment_id', assignment_id);
end;
$$;

revoke all on function public.restart_completed_theory_trainer_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.restart_completed_theory_trainer_atomic(uuid, uuid, uuid) to service_role;

commit;
