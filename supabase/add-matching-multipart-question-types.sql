-- Run this migration before enable-matching-multipart-test-flow.sql.
alter type public.question_type add value if not exists 'MATCHING';
alter type public.question_type add value if not exists 'MULTI_PART';

alter table public.test_questions
  add column if not exists type_config jsonb null;
