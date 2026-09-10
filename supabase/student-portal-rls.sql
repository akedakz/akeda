alter table public.student_schedule_slots enable row level security;
alter table public.student_lessons enable row level security;
alter table public.lesson_homework_records enable row level security;
alter table public.test_assignments enable row level security;
alter table public.test_attempts enable row level security;

grant select on public.student_schedule_slots, public.student_lessons, public.lesson_homework_records, public.test_assignments, public.test_attempts to authenticated;

drop policy if exists "students read own schedule slots" on public.student_schedule_slots;
create policy "students read own schedule slots" on public.student_schedule_slots for select to authenticated using (auth.uid() = student_id);

drop policy if exists "students read own lessons" on public.student_lessons;
create policy "students read own lessons" on public.student_lessons for select to authenticated using (auth.uid() = student_id);

drop policy if exists "students read own homework" on public.lesson_homework_records;
create policy "students read own homework" on public.lesson_homework_records for select to authenticated using (auth.uid() = student_id);

drop policy if exists "students read own test assignments" on public.test_assignments;
create policy "students read own test assignments" on public.test_assignments for select to authenticated using (auth.uid() = student_id);

drop policy if exists "students read own test attempts" on public.test_attempts;
create policy "students read own test attempts" on public.test_attempts for select to authenticated using (auth.uid() = student_id);
