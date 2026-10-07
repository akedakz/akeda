begin;

create or replace function public.submit_learning_skill_attempt_atomic(
  p_student_id uuid,
  p_attempt_id uuid,
  p_answers jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attempt public.learning_skill_practice_attempts%rowtype;
  v_task public.learning_skill_practice_tasks%rowtype;
  v_answer text;
  v_correct integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('status','invalid_answers');
  end if;

  if not exists(select 1 from public.profiles where id=p_student_id and role='STUDENT') then
    return jsonb_build_object('status','student_not_found');
  end if;

  select * into v_attempt
  from public.learning_skill_practice_attempts
  where id=p_attempt_id and profile_id=p_student_id
  for update;

  if not found then return jsonb_build_object('status','attempt_not_found'); end if;
  if v_attempt.status <> 'OPEN' then return jsonb_build_object('status','already_completed'); end if;

  if not exists(
    select 1
    from public.learning_program_topics topic
    join public.student_learning_programs assigned
      on assigned.program_id=topic.program_id
     and assigned.student_id=p_student_id
    where topic.id=v_attempt.program_topic_id
  ) then
    return jsonb_build_object('status','not_assigned');
  end if;

  if (select count(*) from jsonb_object_keys(p_answers)) <> v_attempt.total_questions then
    return jsonb_build_object('status','incomplete');
  end if;

  for v_task in
    select * from public.learning_skill_practice_tasks
    where attempt_id=v_attempt.id
    order by position
    for update
  loop
    if v_task.answered_at is not null then
      return jsonb_build_object('status','already_completed');
    end if;

    v_answer := btrim(coalesce(p_answers->>v_task.id::text,''));
    if v_answer !~ '^-?(0|[1-9][0-9]*)(/[1-9][0-9]*)?$' then
      return jsonb_build_object('status','invalid_answer','task_id',v_task.id);
    end if;

    if v_answer = v_task.expected_answer then
      v_correct := v_correct + 1;
    end if;

    update public.learning_skill_practice_tasks
    set submitted_answer=v_answer,
        is_correct=(v_answer=v_task.expected_answer),
        answered_at=now()
    where id=v_task.id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'task_id',v_task.id,
      'correct',(v_answer=v_task.expected_answer),
      'expected_answer',coalesce(v_task.parameters->>'answer_display',v_task.expected_answer)
    ));
  end loop;

  update public.learning_skill_practice_attempts
  set status='COMPLETED',
      correct_answers=v_correct,
      completed_at=now()
  where id=v_attempt.id;

  if v_correct=v_attempt.total_questions then
    insert into public.student_learning_program_topic_progress(
      student_id,program_id,program_topic_id,completed_at,updated_at
    )
    select p_student_id,topic.program_id,topic.id,now(),now()
    from public.learning_program_topics topic
    where topic.id=v_attempt.program_topic_id
    on conflict (student_id,program_topic_id)
    do update set completed_at=coalesce(public.student_learning_program_topic_progress.completed_at,excluded.completed_at),
                  updated_at=now();
  end if;

  return jsonb_build_object(
    'status','completed',
    'score',v_correct,
    'total',v_attempt.total_questions,
    'mastered',v_correct=v_attempt.total_questions,
    'results',v_results
  );
end;
$$;

revoke all on function public.submit_learning_skill_attempt_atomic(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_learning_skill_attempt_atomic(uuid,uuid,jsonb) to service_role;

-- Keep the earlier GCD prototype as a second section while Section 1 is tested.
update public.learning_program_sections
set sort_order=100, updated_at=now()
where id='a4d2c8b1-8f69-4a93-9ea8-2ec943178602'
  and program_id='9c1a7f6e-5f8d-4a0e-b145-5c773521d601';

insert into public.learning_program_sections(id,program_id,title,sort_order)
values(
  '11000000-0000-4000-8000-000000000001',
  '9c1a7f6e-5f8d-4a0e-b145-5c773521d601',
  'Числа и вычисления',
  0
)
on conflict (id) do update
set title=excluded.title, sort_order=excluded.sort_order, updated_at=now();

update public.learning_program_sections
set sort_order=1, updated_at=now()
where id='a4d2c8b1-8f69-4a93-9ea8-2ec943178602'
  and program_id='9c1a7f6e-5f8d-4a0e-b145-5c773521d601';

insert into public.learning_program_topics(id,program_id,section_id,title,sort_order) values
('11000000-0000-4000-8000-000000000101','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.1 Выполнять сложение, вычитание, умножение и деление натуральных, целых и рациональных чисел.',0),
('11000000-0000-4000-8000-000000000102','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.2 Работать с положительными и отрицательными числами.',1),
('11000000-0000-4000-8000-000000000103','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.3 Находить модуль числа и противоположное число.',2),
('11000000-0000-4000-8000-000000000104','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.4 Сравнивать числа и записывать двойные неравенства.',3),
('11000000-0000-4000-8000-000000000105','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.5 Соблюдать порядок действий в числовых выражениях.',4),
('11000000-0000-4000-8000-000000000106','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.6 Использовать свойства арифметических действий для удобных вычислений.',5),
('11000000-0000-4000-8000-000000000107','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.7 Работать со степенью с натуральным показателем.',6),
('11000000-0000-4000-8000-000000000108','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.8 Читать, записывать и сравнивать десятичные дроби.',7),
('11000000-0000-4000-8000-000000000109','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.9 Выполнять четыре арифметических действия с десятичными дробями.',8),
('11000000-0000-4000-8000-000000000110','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.10 Переводить обыкновенную дробь в конечную десятичную и обратно.',9),
('11000000-0000-4000-8000-000000000111','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.11 Переводить бесконечную периодическую десятичную дробь в обыкновенную дробь.',10),
('11000000-0000-4000-8000-000000000112','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.12 Умножать и делить на 10, 100, 1000, а также на 0,1; 0,01 и т.д.',11),
('11000000-0000-4000-8000-000000000113','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.13 Округлять числа до заданного разряда.',12),
('11000000-0000-4000-8000-000000000114','9c1a7f6e-5f8d-4a0e-b145-5c773521d601','11000000-0000-4000-8000-000000000001','1.14 Упрощать комбинированные числовые выражения с целыми, дробными и десятичными числами.',13)
on conflict (id) do update
set title=excluded.title, section_id=excluded.section_id, sort_order=excluded.sort_order, updated_at=now();

insert into public.learning_program_skill_generators(id,program_topic_id,generator_key,config,is_active) values
('11000000-0000-4000-8000-000000000201','11000000-0000-4000-8000-000000000101','nis_s1_1_v1','{"questions_per_attempt":10,"version":1,"template_count":7}'::jsonb,true),
('11000000-0000-4000-8000-000000000202','11000000-0000-4000-8000-000000000102','nis_s1_2_v1','{"questions_per_attempt":10,"version":1,"template_count":5}'::jsonb,true),
('11000000-0000-4000-8000-000000000203','11000000-0000-4000-8000-000000000103','nis_s1_3_v1','{"questions_per_attempt":10,"version":1,"template_count":4}'::jsonb,true),
('11000000-0000-4000-8000-000000000204','11000000-0000-4000-8000-000000000104','nis_s1_4_v1','{"questions_per_attempt":10,"version":1,"template_count":6}'::jsonb,true),
('11000000-0000-4000-8000-000000000205','11000000-0000-4000-8000-000000000105','nis_s1_5_v1','{"questions_per_attempt":10,"version":1,"template_count":6}'::jsonb,true),
('11000000-0000-4000-8000-000000000206','11000000-0000-4000-8000-000000000106','nis_s1_6_v1','{"questions_per_attempt":10,"version":1,"template_count":8}'::jsonb,true),
('11000000-0000-4000-8000-000000000207','11000000-0000-4000-8000-000000000107','nis_s1_7_v1','{"questions_per_attempt":10,"version":1,"template_count":7}'::jsonb,true),
('11000000-0000-4000-8000-000000000208','11000000-0000-4000-8000-000000000108','nis_s1_8_v1','{"questions_per_attempt":10,"version":1,"template_count":8}'::jsonb,true),
('11000000-0000-4000-8000-000000000209','11000000-0000-4000-8000-000000000109','nis_s1_9_v1','{"questions_per_attempt":10,"version":1,"template_count":8}'::jsonb,true),
('11000000-0000-4000-8000-000000000210','11000000-0000-4000-8000-000000000110','nis_s1_10_v1','{"questions_per_attempt":10,"version":1,"template_count":7}'::jsonb,true),
('11000000-0000-4000-8000-000000000211','11000000-0000-4000-8000-000000000111','nis_s1_11_v1','{"questions_per_attempt":10,"version":1,"template_count":8}'::jsonb,true),
('11000000-0000-4000-8000-000000000212','11000000-0000-4000-8000-000000000112','nis_s1_12_v1','{"questions_per_attempt":10,"version":1,"template_count":6}'::jsonb,true),
('11000000-0000-4000-8000-000000000213','11000000-0000-4000-8000-000000000113','nis_s1_13_v1','{"questions_per_attempt":10,"version":1,"template_count":6}'::jsonb,true),
('11000000-0000-4000-8000-000000000214','11000000-0000-4000-8000-000000000114','nis_s1_14_v1','{"questions_per_attempt":10,"version":1,"template_count":10}'::jsonb,true)
on conflict (program_topic_id) do update
set generator_key=excluded.generator_key, config=excluded.config, is_active=true, updated_at=now();

commit;
