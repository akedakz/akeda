-- Apply after student-materials.sql if that migration has already been run.
-- RLS bypass and SQL table privileges are separate; the server-only loader and
-- actions use the service-role client after validating the current STUDENT.

grant select, insert, update, delete
on table public.student_material_pins, public.student_material_views
to service_role;

create or replace function public.record_student_material_view(
  p_student_id uuid,
  p_material_item_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.student_material_views (student_id, material_item_id)
  values (p_student_id, p_material_item_id)
  on conflict (student_id, material_item_id) do update
  set last_opened_at = now(),
      open_count = public.student_material_views.open_count + 1;
$$;

revoke all on function public.record_student_material_view(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.record_student_material_view(uuid, uuid)
to service_role;
