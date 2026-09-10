begin;

alter table public.trainers
  drop constraint trainers_type_check,
  add constraint trainers_type_check check (type in ('QUICK_PROBLEMS', 'THEORY'));

alter table public.trainers
  add column status text not null default 'PUBLISHED'
  check (status in ('DRAFT', 'PUBLISHED'));

comment on column public.trainers.status is 'Library publication state. Existing QUICK_PROBLEMS remain PUBLISHED; THEORY imports start as DRAFT.';
comment on column public.trainers.definition is 'Canonical server-validated definition whose shape is selected by trainers.type.';

commit;
