begin;

create or replace function public.submit_nis_new_skill_attempt_atomic(
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
  v_role text;
  v_correct integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('status','invalid_answers');
  end if;

  select role::text into v_role from public.profiles where id=p_student_id;
  if v_role is null or v_role not in ('ADMIN','STUDENT') then
    return jsonb_build_object('status','student_not_found');
  end if;

  select * into v_attempt
  from public.learning_skill_practice_attempts
  where id=p_attempt_id and profile_id=p_student_id
  for update;

  if not found then return jsonb_build_object('status','attempt_not_found'); end if;
  if v_attempt.status <> 'OPEN' then return jsonb_build_object('status','already_completed'); end if;

  if v_role='STUDENT' and not exists(
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

  -- Validate the whole payload before mutating any task. The caller is service_role;
  -- shape-aware exact normalization is performed in the authenticated server action.
  if (select count(*) from public.learning_skill_practice_tasks where attempt_id=v_attempt.id) <> v_attempt.total_questions then
    return jsonb_build_object('status','incomplete');
  end if;
  for v_task in select * from public.learning_skill_practice_tasks where attempt_id=v_attempt.id order by position for update
  loop
    if v_task.answered_at is not null then return jsonb_build_object('status','already_completed'); end if;
    if v_task.parameters->>'answer_policy_version' is distinct from '2'
       or jsonb_typeof(p_answers->v_task.id::text) is distinct from 'object'
       or jsonb_typeof(p_answers->v_task.id::text->'value') is distinct from 'string'
       or jsonb_typeof(p_answers->v_task.id::text->'raw') is distinct from 'string' then
      return jsonb_build_object('status','invalid_answer');
    end if;
    v_answer := p_answers->v_task.id::text->>'value';
    if length(v_answer) not between 1 and 100
       or (v_answer <> '!format' and v_answer !~ '^[-0-9/;<^]+$')
       or length(btrim(p_answers->v_task.id::text->>'raw')) not between 1 and 100 then
      return jsonb_build_object('status','invalid_answer');
    end if;
  end loop;

  for v_task in select * from public.learning_skill_practice_tasks where attempt_id=v_attempt.id order by position for update
  loop
    v_answer := p_answers->v_task.id::text->>'value';
    if v_answer = v_task.expected_answer then
      v_correct := v_correct + 1;
    end if;

    update public.learning_skill_practice_tasks
    set submitted_answer=p_answers->v_task.id::text->>'raw',
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

  if v_role='STUDENT' and v_correct=v_attempt.total_questions then
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

revoke all on function public.submit_nis_new_skill_attempt_atomic(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_nis_new_skill_attempt_atomic(uuid,uuid,jsonb) to service_role;

-- Add a separate program. Existing programs, assignments and attempts are untouched.
do $$
declare
  v_program uuid;
  v_section uuid;
  v_topic uuid;
  v_title text;
  v_index integer := 0;
  v_counts integer[] := array[20,7,6,8,5,8,8,9,8,7,7,14,8,5];
begin
  if exists(select 1 from public.learning_programs where name='NIS new program · 5–6 классы') then
    raise exception 'NIS new program already exists; inspect before reseeding';
  end if;
  insert into public.learning_programs(name,is_active) values('NIS new program · 5–6 классы',true) returning id into v_program;
  insert into public.learning_program_sections(program_id,title,sort_order)
    values(v_program,'Модуль 1. Числа и вычисления',0) returning id into v_section;
  foreach v_title in array array[
    '1.1 Выполнять сложение, вычитание, умножение и деление натуральных, целых и рациональных чисел.',
    '1.2 Работать с положительными и отрицательными числами.',
    '1.3 Находить модуль числа и противоположное число.',
    '1.4 Сравнивать числа и записывать двойные неравенства.',
    '1.5 Соблюдать порядок действий в числовых выражениях.',
    '1.6 Использовать свойства арифметических действий для удобных вычислений.',
    '1.7 Работать со степенью с натуральным показателем.',
    '1.8 Читать, записывать и сравнивать десятичные дроби.',
    '1.9 Выполнять четыре арифметических действия с десятичными дробями.',
    '1.10 Переводить обыкновенную дробь в конечную десятичную и обратно.',
    '1.11 Переводить бесконечную периодическую десятичную дробь в обыкновенную дробь.',
    '1.12 Умножать и делить на 10, 100, 1000, а также на 0,1; 0,01 и т.д.',
    '1.13 Округлять числа до заданного разряда.',
    '1.14 Упрощать комбинированные числовые выражения с целыми, дробными и десятичными числами.'
  ] loop
    v_index := v_index + 1;
    insert into public.learning_program_topics(program_id,section_id,title,sort_order)
      values(v_program,v_section,v_title,v_index-1) returning id into v_topic;
    insert into public.learning_program_skill_generators(program_topic_id,generator_key,config,is_active)
      values(v_topic,'nis_new_s1_'||v_index||'_v2',
        jsonb_build_object('version',2,'questions_per_attempt',greatest(10,v_counts[v_index]),'template_count',v_counts[v_index],'all_subtypes_required',true),true);
  end loop;
end;
$$;
commit;
