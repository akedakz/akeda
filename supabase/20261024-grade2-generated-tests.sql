begin;

create table if not exists public.grade2_test_generators (
  test_id uuid primary key references public.tests(id) on delete cascade,
  generator_key text not null check (generator_key in (
    'grade2_multiplication_v1',
    'grade2_addition_v1',
    'grade2_subtraction_v1',
    'grade2_mixed_v1',
    'grade2_parentheses_v1'
  )),
  question_count integer not null default 16 check (question_count = 16),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.grade2_test_generators enable row level security;
revoke all on public.grade2_test_generators from public, anon, authenticated;
grant select, insert, update, delete on public.grade2_test_generators to service_role;

do $seed$
declare
  v_admin uuid;
  v_folder uuid := '2a000000-0000-4000-8000-000000000001';
begin
  select id into v_admin from public.profiles where role = 'ADMIN' order by id limit 1;
  if v_admin is null then raise exception 'An ADMIN profile is required to seed grade two tests'; end if;

  insert into public.test_folders (id,name,parent_id,created_by)
  values (v_folder,'2 класс — тренировка счёта',null,v_admin)
  on conflict (id) do nothing;

  insert into public.tests (id,folder_id,title,description,status,created_by,is_assignment_copy)
  values
   ('2a000000-0000-4000-8000-000000000101',v_folder,'2 класс · Таблица умножения',
     '16 вопросов: произведения от 2×2 до 9×9. При новом назначении числа меняются. Ответ числом.','PUBLISHED',v_admin,false),
   ('2a000000-0000-4000-8000-000000000102',v_folder,'2 класс · Сложение',
     '16 вопросов: однозначные слагаемые от 1 до 9, включая переход через 10. Ответ числом.','PUBLISHED',v_admin,false),
   ('2a000000-0000-4000-8000-000000000103',v_folder,'2 класс · Вычитание',
     '16 вопросов: вычитание из однозначных чисел и из чисел 10–20, без отрицательных ответов. Ответ числом.','PUBLISHED',v_admin,false),
   ('2a000000-0000-4000-8000-000000000104',v_folder,'2 класс · Смешанная арифметика',
     '16 вопросов вразброс: сложение, вычитание и таблица умножения. Ответ числом.','PUBLISHED',v_admin,false),
   ('2a000000-0000-4000-8000-000000000105',v_folder,'2 класс · Примеры со скобками',
     '16 вопросов: скобки, сложение, вычитание и умножение, без степеней и отрицательных результатов. Ответ числом.','PUBLISHED',v_admin,false)
  on conflict (id) do nothing;

  insert into public.grade2_test_generators(test_id,generator_key,question_count,is_active)
  values
   ('2a000000-0000-4000-8000-000000000101','grade2_multiplication_v1',16,true),
   ('2a000000-0000-4000-8000-000000000102','grade2_addition_v1',16,true),
   ('2a000000-0000-4000-8000-000000000103','grade2_subtraction_v1',16,true),
   ('2a000000-0000-4000-8000-000000000104','grade2_mixed_v1',16,true),
   ('2a000000-0000-4000-8000-000000000105','grade2_parentheses_v1',16,true)
  on conflict (test_id) do update set generator_key=excluded.generator_key,
    question_count=excluded.question_count, is_active=true;
end;
$seed$;

commit;
