create table if not exists public.student_material_pins (
  student_id uuid not null references public.profiles(id) on delete cascade,
  material_item_id uuid not null references public.materials(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, material_item_id)
);

create table if not exists public.student_material_views (
  student_id uuid not null references public.profiles(id) on delete cascade,
  material_item_id uuid not null references public.materials(id) on delete cascade,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  open_count integer not null default 1 check (open_count > 0),
  primary key (student_id, material_item_id)
);

create index if not exists student_material_pins_material_idx on public.student_material_pins(material_item_id);
create index if not exists student_material_views_material_idx on public.student_material_views(material_item_id);
create index if not exists student_material_views_last_opened_idx on public.student_material_views(student_id, last_opened_at desc);

create or replace function public.record_student_material_view(p_student_id uuid, p_material_item_id uuid)
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

revoke all on function public.record_student_material_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_student_material_view(uuid, uuid) to service_role;

alter table public.student_material_pins enable row level security;
alter table public.student_material_views enable row level security;
grant select on public.student_material_pins, public.student_material_views to authenticated;
grant select, insert, update, delete on public.student_material_pins, public.student_material_views to service_role;

drop policy if exists "students read own material pins" on public.student_material_pins;
create policy "students read own material pins" on public.student_material_pins for select to authenticated using (auth.uid() = student_id);
drop policy if exists "students read own material views" on public.student_material_views;
create policy "students read own material views" on public.student_material_views for select to authenticated using (auth.uid() = student_id);
