alter table public.student_lessons add column if not exists deleted_at timestamptz null;
create index if not exists student_lessons_student_active_starts_idx on public.student_lessons(student_id, starts_at) where deleted_at is null;

create or replace function public.soft_delete_student_lesson(p_student_id uuid, p_lesson_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_lesson_id uuid;
begin
  update public.student_lessons
    set deleted_at = now(), updated_at = now()
    where id = p_lesson_id and student_id = p_student_id and deleted_at is null and ends_at <= now()
    returning id into v_lesson_id;
  if v_lesson_id is null then return false; end if;
  delete from public.lesson_homework_records where lesson_id = v_lesson_id and student_id = p_student_id;
  return true;
end;
$$;
revoke all on function public.soft_delete_student_lesson(uuid, uuid) from public, anon, authenticated;
grant execute on function public.soft_delete_student_lesson(uuid, uuid) to service_role;
