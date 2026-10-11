-- Data-only installation. No schema/RPC/security changes and no automatic assignments.
begin;
do $$
declare
  v_program uuid;
  v_section uuid;
  v_topic uuid;
  v_sort integer;
  v_title text;
  v_index integer := 0;
  v_counts integer[] := array[8,10,11,9,10,10,9,20,13,7,7];
begin
  select id into strict v_program from public.learning_programs
    where name='NIS new program · 5–6 классы' and is_active=true for update;
  if exists(select 1 from public.learning_program_sections where program_id=v_program and title='Модуль 2. Делимость и теория чисел') then
    raise exception 'Module two already exists; inspect before reseeding';
  end if;
  select coalesce(max(sort_order),-1)+1 into v_sort from public.learning_program_sections where program_id=v_program;
  insert into public.learning_program_sections(program_id,title,sort_order)
    values(v_program,'Модуль 2. Делимость и теория чисел',v_sort) returning id into v_section;
  foreach v_title in array array[
    '2.01 Делители и кратные натуральных чисел',
    '2.02 Простые и составные числа. Разложение на простые множители',
    '2.03 Признак делимости',
    '2.04 Наибольший общий делитель и взаимно простые числа',
    '2.05 Наименьшее общее кратное',
    '2.06 Деление с остатком',
    '2.07 Числа с заданными остатками от деления',
    '2.08 Неизвестная цифра в числе по признакам делимости',
    '2.09 Последняя цифра большой степени',
    '2.10 Последняя цифра произведения и числового выражения',
    '2.11 Количество натуральных делителей числа'
  ] loop
    v_index := v_index + 1;
    insert into public.learning_program_topics(program_id,section_id,title,sort_order)
      values(v_program,v_section,v_title,v_index-1) returning id into v_topic;
    insert into public.learning_program_skill_generators(program_topic_id,generator_key,config,is_active)
      values(v_topic,'nis_new_s2_'||v_index||'_v2',jsonb_build_object('version',2,
        'questions_per_attempt',greatest(12,v_counts[v_index]),'template_count',v_counts[v_index],
        'all_subtypes_required',true),true);
  end loop;
end;
$$;
commit;
