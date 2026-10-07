begin;

create table if not exists public.learning_program_skill_generators (
  id uuid primary key default gen_random_uuid(),
  program_topic_id uuid not null unique references public.learning_program_topics(id) on delete cascade,
  generator_key text not null check (generator_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_skill_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  program_topic_id uuid not null references public.learning_program_topics(id) on delete cascade,
  generator_id uuid not null references public.learning_program_skill_generators(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN','COMPLETED')),
  total_questions integer not null check (total_questions between 1 and 50),
  correct_answers integer not null default 0 check (correct_answers between 0 and 50),
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  check ((status='OPEN' and completed_at is null) or (status='COMPLETED' and completed_at is not null))
);

create table if not exists public.learning_skill_practice_tasks (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.learning_skill_practice_attempts(id) on delete cascade,
  position integer not null check (position between 1 and 50),
  prompt text not null check (char_length(prompt) between 1 and 500),
  difficulty text not null check (difficulty in ('BASIC','CORE','CHALLENGE')),
  parameters jsonb not null check (jsonb_typeof(parameters) = 'object'),
  expected_answer text not null check (char_length(expected_answer) between 1 and 100),
  submitted_answer text null check (submitted_answer is null or char_length(submitted_answer) <= 100),
  is_correct boolean null,
  answered_at timestamptz null,
  created_at timestamptz not null default now(),
  unique(attempt_id, position),
  check (
    (answered_at is null and submitted_answer is null and is_correct is null)
    or
    (answered_at is not null and submitted_answer is not null and is_correct is not null)
  )
);

create index if not exists learning_skill_practice_attempts_profile_created_idx
  on public.learning_skill_practice_attempts(profile_id, created_at desc);
create index if not exists learning_skill_practice_tasks_attempt_idx
  on public.learning_skill_practice_tasks(attempt_id, position);

alter table public.learning_program_skill_generators enable row level security;
alter table public.learning_skill_practice_attempts enable row level security;
alter table public.learning_skill_practice_tasks enable row level security;

revoke all on public.learning_program_skill_generators, public.learning_skill_practice_attempts, public.learning_skill_practice_tasks
  from public, anon, authenticated;
grant all on public.learning_program_skill_generators, public.learning_skill_practice_attempts, public.learning_skill_practice_tasks
  to service_role;

insert into public.learning_programs(id, name, is_active)
values ('9c1a7f6e-5f8d-4a0e-b145-5c773521d601', 'NIS 5–6 · прототип навыков', true)
on conflict (id) do nothing;

insert into public.learning_program_sections(id, program_id, title, sort_order)
values (
  'a4d2c8b1-8f69-4a93-9ea8-2ec943178602',
  '9c1a7f6e-5f8d-4a0e-b145-5c773521d601',
  'Делимость и теория чисел',
  0
)
on conflict (id) do nothing;

insert into public.learning_program_topics(id, program_id, section_id, title, sort_order)
values (
  'b6f3d9a2-2c51-4e8d-8f72-3e51a2b67903',
  '9c1a7f6e-5f8d-4a0e-b145-5c773521d601',
  'a4d2c8b1-8f69-4a93-9ea8-2ec943178602',
  '2.6 Находить наибольший общий делитель (НОД)',
  0
)
on conflict (id) do nothing;

insert into public.learning_program_skill_generators(id, program_topic_id, generator_key, config)
values (
  'c7a4e0b3-3d62-4f9e-9a83-4f62b3c78a04',
  'b6f3d9a2-2c51-4e8d-8f72-3e51a2b67903',
  'gcd_pair_v1',
  '{
    "questions_per_attempt": 10,
    "levels": [
      {"key":"BASIC","count":4,"gcd_min":2,"gcd_max":8,"multiplier_min":2,"multiplier_max":6,"value_max":50},
      {"key":"CORE","count":4,"gcd_min":2,"gcd_max":12,"multiplier_min":3,"multiplier_max":10,"value_max":120},
      {"key":"CHALLENGE","count":2,"gcd_min":3,"gcd_max":15,"multiplier_min":4,"multiplier_max":12,"value_max":180}
    ],
    "require_coprime_multipliers": true,
    "distinct_values": true
  }'::jsonb
)
on conflict (program_topic_id) do update
set generator_key=excluded.generator_key, config=excluded.config, is_active=true, updated_at=now();

commit;
