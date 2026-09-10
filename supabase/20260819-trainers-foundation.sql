begin;

create table public.trainers (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id uuid not null references public.profiles(id) on delete restrict,
  type text not null check (type = 'QUICK_PROBLEMS'),
  title text not null check (char_length(btrim(title)) between 1 and 120 and title = btrim(title)),
  description text not null default '' check (char_length(description) <= 2000),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  content_revision integer not null default 1 check (content_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index trainers_owner_type_normalized_title_key
  on public.trainers (owner_admin_id, type, lower(btrim(title)));
create index trainers_owner_type_updated_idx
  on public.trainers (owner_admin_id, type, updated_at desc);

alter table public.trainers enable row level security;
revoke all on table public.trainers from public, anon, authenticated;
grant select, insert, update, delete on table public.trainers to service_role;

comment on table public.trainers is 'Server-only trainer definitions. No client RLS policies by design.';
comment on column public.trainers.definition is 'Canonical server-validated NSP_TRAINER_IMPORT_V1 definition.';

commit;
