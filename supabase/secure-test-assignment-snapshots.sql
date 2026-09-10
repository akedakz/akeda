begin;

-- Assignment snapshots contain grading secrets. Students access assignment
-- metadata and safe question projections through trusted server-side code.
revoke select on table public.test_assignments from anon, authenticated;

drop policy if exists "students read own test assignments"
  on public.test_assignments;

-- Keep the canonical snapshot available to trusted application code and the
-- SECURITY DEFINER grading functions, which execute with privileged ownership.
grant select, insert, update, delete on table public.test_assignments
  to service_role;

commit;
