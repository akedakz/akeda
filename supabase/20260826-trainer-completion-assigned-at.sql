begin;

alter table public.trainer_completion_history
  add column assigned_at timestamptz;

comment on column public.trainer_completion_history.assigned_at is
  'Original trainer_assignments.assigned_at snapshot. Null only for legacy completion rows created before this column existed.';

create function public.snapshot_trainer_completion_assigned_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.assigned_at is null then
    select assignment.assigned_at
      into new.assigned_at
      from public.trainer_assignments assignment
     where assignment.student_id = new.student_id
       and assignment.owner_admin_id = new.owner_admin_id
       and assignment.trainer_id = new.source_trainer_id;
  end if;
  return new;
end;
$$;

create trigger trainer_completion_snapshot_assigned_at
before insert on public.trainer_completion_history
for each row execute function public.snapshot_trainer_completion_assigned_at();

commit;
