-- Выполните этот файл в Supabase SQL Editor перед первым сохранением редактора.
create extension if not exists pgcrypto;

create or replace function public.save_test_editor(
  p_test_id uuid,
  p_title text,
  p_description text,
  p_questions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q jsonb;
  o jsonb;
  v_question_id uuid;
  v_option_id uuid;
  v_question public.test_questions%rowtype;
  v_result jsonb;
begin
  if nullif(btrim(p_title), '') is null then raise exception 'Test title is required'; end if;
  if not exists (select 1 from public.tests t where t.id = p_test_id) then raise exception 'Test not found'; end if;

  create temporary table editor_question_ids (client_id text primary key, id uuid unique not null) on commit drop;
  create temporary table editor_option_ids (question_id uuid not null, client_id text not null, id uuid unique not null, primary key (question_id, client_id)) on commit drop;

  update public.tests set title = btrim(p_title), description = nullif(btrim(p_description), ''), updated_at = now() where id = p_test_id;

  for q in select value from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) loop
    v_question_id := null;
    if nullif(q->>'id', '') is not null then
      select tq.id into v_question_id from public.test_questions tq where tq.id = (q->>'id')::uuid and tq.test_id = p_test_id;
    end if;
    v_question_id := coalesce(v_question_id, gen_random_uuid());
    insert into editor_question_ids(client_id, id) values (q->>'clientId', v_question_id);

    select * into v_question from jsonb_populate_record(null::public.test_questions, jsonb_build_object(
      'id', v_question_id, 'test_id', p_test_id, 'type', q->'type', 'prompt', q->'prompt',
      'image_path', q->'imagePath', 'points', q->'points', 'is_required', q->'isRequired', 'position', q->'position',
      'numeric_mode', q->'numericMode', 'numeric_answer', q->'numericAnswer', 'numeric_tolerance', q->'numericTolerance',
      'numeric_min', q->'numericMin', 'numeric_max', q->'numericMax'
    ));
    insert into public.test_questions(id, test_id, type, prompt, image_path, points, is_required, position, numeric_mode, numeric_answer, numeric_tolerance, numeric_min, numeric_max)
    values (v_question.id, v_question.test_id, v_question.type, v_question.prompt, v_question.image_path, v_question.points, v_question.is_required, v_question.position, v_question.numeric_mode, v_question.numeric_answer, v_question.numeric_tolerance, v_question.numeric_min, v_question.numeric_max)
    on conflict (id) do update set type = excluded.type, prompt = excluded.prompt, image_path = excluded.image_path, points = excluded.points, is_required = excluded.is_required, position = excluded.position, numeric_mode = excluded.numeric_mode, numeric_answer = excluded.numeric_answer, numeric_tolerance = excluded.numeric_tolerance, numeric_min = excluded.numeric_min, numeric_max = excluded.numeric_max, updated_at = now();

    if q->>'type' in ('SINGLE_CHOICE', 'MULTIPLE_CHOICE') then
      for o in select value from jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) loop
        v_option_id := null;
        if nullif(o->>'id', '') is not null then
          select qo.id into v_option_id from public.test_question_options qo where qo.id = (o->>'id')::uuid and qo.question_id = v_question_id;
        end if;
        v_option_id := coalesce(v_option_id, gen_random_uuid());
        insert into editor_option_ids(question_id, client_id, id) values (v_question_id, o->>'clientId', v_option_id);
        insert into public.test_question_options(id, question_id, text, is_correct, position)
        values (v_option_id, v_question_id, btrim(o->>'text'), (o->>'isCorrect')::boolean, (o->>'position')::integer)
        on conflict (id) do update set text = excluded.text, is_correct = excluded.is_correct, position = excluded.position, updated_at = now();
      end loop;
      delete from public.test_question_options qo where qo.question_id = v_question_id and not exists (select 1 from editor_option_ids e where e.question_id = v_question_id and e.id = qo.id);
    else
      delete from public.test_question_options qo where qo.question_id = v_question_id;
    end if;
  end loop;

  delete from public.test_question_options qo using public.test_questions tq where qo.question_id = tq.id and tq.test_id = p_test_id and not exists (select 1 from editor_question_ids e where e.id = tq.id);
  delete from public.test_questions tq where tq.test_id = p_test_id and not exists (select 1 from editor_question_ids e where e.id = tq.id);

  select jsonb_build_object(
    'id', t.id, 'folderId', t.folder_id, 'title', t.title, 'description', coalesce(t.description, ''),
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', tq.id, 'clientId', tq.id, 'type', tq.type, 'prompt', tq.prompt, 'imagePath', tq.image_path, 'imageUrl', null,
      'points', tq.points, 'isRequired', tq.is_required, 'position', tq.position, 'numericMode', tq.numeric_mode,
      'numericAnswer', tq.numeric_answer, 'numericTolerance', tq.numeric_tolerance, 'numericMin', tq.numeric_min, 'numericMax', tq.numeric_max,
      'options', coalesce((select jsonb_agg(jsonb_build_object('id', qo.id, 'clientId', qo.id, 'text', qo.text, 'isCorrect', qo.is_correct, 'position', qo.position) order by qo.position) from public.test_question_options qo where qo.question_id = tq.id), '[]'::jsonb)
    ) order by tq.position) from public.test_questions tq where tq.test_id = t.id), '[]'::jsonb)
  ) into v_result from public.tests t where t.id = p_test_id;
  return v_result;
end;
$$;

revoke all on function public.save_test_editor(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_test_editor(uuid, text, text, jsonb) to service_role;
