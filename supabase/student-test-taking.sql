create unique index if not exists test_attempts_one_active_per_assignment
  on public.test_attempts(assignment_id, student_id)
  where submitted_at is null;

create unique index if not exists test_attempts_assignment_number_unique
  on public.test_attempts(assignment_id, attempt_number);

create unique index if not exists test_attempt_answers_attempt_question_unique
  on public.test_attempt_answers(attempt_id, question_key);

alter table public.test_attempt_answers enable row level security;
grant select on public.test_attempt_answers to authenticated;
drop policy if exists "students read own test attempt answers" on public.test_attempt_answers;
create policy "students read own test attempt answers" on public.test_attempt_answers
  for select to authenticated using (
    exists (
      select 1 from public.test_attempts attempt
      where attempt.id = attempt_id and attempt.student_id = auth.uid()
    )
  );
