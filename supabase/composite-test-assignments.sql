begin;

create extension if not exists pgcrypto;

drop function if exists public.create_composite_test_assignment_atomic(uuid, uuid[], text, integer, text, boolean, timestamptz, integer, boolean, uuid);

alter table public.tests
  add column if not exists is_assignment_copy boolean not null default false;

create index if not exists tests_library_visibility_idx
  on public.tests(folder_id, created_at desc)
  where is_assignment_copy = false;

create or replace function public.create_composite_test_assignment_atomic(
  p_student_id uuid,
  p_source_test_ids uuid[],
  p_title text,
  p_question_count integer,
  p_sampling_mode text,
  p_shuffle_questions boolean,
  p_deadline_at timestamptz,
  p_show_correct_answers_after_close boolean,
  p_assigned_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_test_id uuid := gen_random_uuid();
  v_assignment_id uuid := gen_random_uuid();
  v_available integer;
  v_source_count integer;
  v_snapshot jsonb;
  v_question record;
  v_selected integer := 0;
  v_round integer := 1;
begin
  if nullif(btrim(p_title), '') is null or char_length(btrim(p_title)) > 240
     or p_sampling_mode not in ('POOL', 'BALANCED')
     or p_question_count < 1
     or p_source_test_ids is null or cardinality(p_source_test_ids) < 1
     or cardinality(p_source_test_ids) <> (select count(distinct source_id) from unnest(p_source_test_ids) as source_ids(source_id)) then
    raise exception using errcode = '22023', message = 'INVALID_COMPOSITE_TEST_INPUT';
  end if;

  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT') then
    return jsonb_build_object('status', 'student_not_found');
  end if;
  if not exists (select 1 from public.profiles where id = p_assigned_by and role = 'ADMIN') then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  select count(*), coalesce(sum(question_count), 0)
  into v_source_count, v_available
  from (
    select t.id, count(q.id)::integer question_count
    from public.tests t
    left join public.test_questions q on q.test_id = t.id
    where t.id = any(p_source_test_ids)
      and t.status = 'PUBLISHED'
      and t.is_assignment_copy = false
    group by t.id
    having count(q.id) > 0
  ) source;
  if v_source_count <> cardinality(p_source_test_ids) then return jsonb_build_object('status', 'invalid_sources'); end if;
  if p_question_count > v_available then return jsonb_build_object('status', 'invalid_limit'); end if;

  create temporary table composite_source_order(test_id uuid primary key, order_key double precision) on commit drop;
  insert into composite_source_order select id, random() from unnest(p_source_test_ids) id;
  create temporary table composite_candidates(
    source_test_id uuid not null,
    source_question_id uuid primary key,
    source_position integer not null,
    random_rank integer not null
  ) on commit drop;
  insert into composite_candidates
  select q.test_id, q.id, q.position,
    row_number() over (partition by q.test_id order by random(), q.id)::integer
  from public.test_questions q where q.test_id = any(p_source_test_ids);
  create temporary table composite_selected(
    source_test_id uuid not null,
    source_question_id uuid primary key,
    selection_order serial
  ) on commit drop;

  if p_sampling_mode = 'POOL' then
    insert into composite_selected(source_test_id, source_question_id)
    select source_test_id, source_question_id from composite_candidates order by random(), source_question_id limit p_question_count;
  else
    while v_selected < p_question_count loop
      for v_question in
        select candidate.source_test_id, candidate.source_question_id
        from composite_candidates candidate
        join composite_source_order source on source.test_id = candidate.source_test_id
        where candidate.random_rank = v_round
        order by source.order_key, candidate.source_test_id
      loop
        exit when v_selected >= p_question_count;
        insert into composite_selected(source_test_id, source_question_id) values (v_question.source_test_id, v_question.source_question_id);
        v_selected := v_selected + 1;
      end loop;
      v_round := v_round + 1;
    end loop;
  end if;

  insert into public.tests(id, folder_id, title, description, status, is_assignment_copy, created_by)
  values (v_test_id, null, btrim(p_title), null, 'PUBLISHED', true, p_assigned_by);

  create temporary table composite_question_map(source_id uuid primary key, target_id uuid not null, target_position integer not null) on commit drop;
  insert into composite_question_map(source_id, target_id, target_position)
  select selected.source_question_id, gen_random_uuid(),
    row_number() over (order by case when p_shuffle_questions then random() else selected.selection_order end, selected.selection_order)::integer - 1
  from composite_selected selected;

  insert into public.test_questions(
    id, test_id, type, prompt, image_path, points, is_required, position,
    numeric_mode, numeric_answer, numeric_tolerance, numeric_min, numeric_max
  )
  select map.target_id, v_test_id, source.type, source.prompt, source.image_path, source.points, source.is_required, map.target_position,
    source.numeric_mode, source.numeric_answer, source.numeric_tolerance, source.numeric_min, source.numeric_max
  from composite_question_map map join public.test_questions source on source.id = map.source_id;

  insert into public.test_question_options(id, question_id, text, is_correct, position)
  select gen_random_uuid(), map.target_id, option.text, option.is_correct, option.position
  from composite_question_map map join public.test_question_options option on option.question_id = map.source_id;

  select jsonb_build_object(
    'version', 1,
    'sourceTestId', test.id,
    'createdBy', p_assigned_by,
    'title', test.title,
    'description', coalesce(test.description, ''),
    'questions', coalesce(jsonb_agg(jsonb_build_object(
      'key', question.id,
      'type', question.type,
      'prompt', question.prompt,
      'imagePath', question.image_path,
      'points', question.points,
      'required', question.is_required,
      'position', question.position,
      'numeric', jsonb_build_object(
        'mode', question.numeric_mode, 'exactValue', question.numeric_answer,
        'tolerance', question.numeric_tolerance, 'rangeMin', question.numeric_min, 'rangeMax', question.numeric_max
      ),
      'options', coalesce((select jsonb_agg(jsonb_build_object(
        'key', option.id, 'text', option.text, 'isCorrect', option.is_correct, 'position', option.position
      ) order by option.position) from public.test_question_options option where option.question_id = question.id), '[]'::jsonb)
    ) order by question.position), '[]'::jsonb)
  ) into v_snapshot
  from public.tests test join public.test_questions question on question.test_id = test.id
  where test.id = v_test_id group by test.id;

  insert into public.test_assignments(
    id, student_id, source_test_id, title, snapshot, deadline_at, max_attempts,
    show_correct_answers_after_close, assigned_by
  ) values (
    v_assignment_id, p_student_id, v_test_id, btrim(p_title), v_snapshot, p_deadline_at,
    1, p_show_correct_answers_after_close, p_assigned_by
  );
  return jsonb_build_object('status', 'created', 'test_id', v_test_id, 'assignment_id', v_assignment_id);
end;
$$;

create or replace function public.delete_test_assignment_safe(p_assignment_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_assignment public.test_assignments%rowtype; v_is_copy boolean := false; v_paths text[] := array[]::text[];
begin
  select * into v_assignment from public.test_assignments where id = p_assignment_id and student_id = p_student_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select coalesce(is_assignment_copy, false) into v_is_copy from public.tests where id = v_assignment.source_test_id;
  if exists(select 1 from public.test_attempts where assignment_id = p_assignment_id) then return jsonb_build_object('status', 'has_attempts'); end if;
  delete from public.test_assignments where id = p_assignment_id;
  if v_is_copy then
    create temporary table deleted_copy_paths(path text primary key) on commit drop;
    insert into deleted_copy_paths select distinct image_path from public.test_questions where test_id = v_assignment.source_test_id and image_path is not null;
    delete from public.test_question_options where question_id in (select id from public.test_questions where test_id = v_assignment.source_test_id);
    delete from public.test_questions where test_id = v_assignment.source_test_id;
    delete from public.tests where id = v_assignment.source_test_id;
    select coalesce(array_agg(path), array[]::text[]) into v_paths from deleted_copy_paths path_row
    where not exists(select 1 from public.test_questions remaining where remaining.image_path = path_row.path);
  end if;
  return jsonb_build_object('status', 'deleted', 'image_paths', to_jsonb(v_paths));
end; $$;

create or replace function public.delete_unassigned_test_atomic(p_test_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_test_id uuid; v_image_paths text[];
begin
  select id into v_test_id from public.tests where id = p_test_id and is_assignment_copy = false for update;
  if v_test_id is null then return jsonb_build_object('status', 'not_found'); end if;
  if exists(select 1 from public.test_assignments where source_test_id = p_test_id) then return jsonb_build_object('status', 'assigned'); end if;
  create temporary table deleted_test_paths(path text primary key) on commit drop;
  insert into deleted_test_paths select distinct image_path from public.test_questions where test_id = p_test_id and image_path is not null;
  delete from public.test_question_options where question_id in (select id from public.test_questions where test_id = p_test_id);
  delete from public.test_questions where test_id = p_test_id;
  delete from public.tests where id = p_test_id;
  select coalesce(array_agg(path), array[]::text[]) into v_image_paths from deleted_test_paths path_row
  where not exists(select 1 from public.test_questions remaining where remaining.image_path = path_row.path);
  return jsonb_build_object('status', 'deleted', 'image_paths', to_jsonb(v_image_paths));
end; $$;

revoke all on function public.create_composite_test_assignment_atomic(uuid, uuid[], text, integer, text, boolean, timestamptz, boolean, uuid) from public, anon, authenticated;
revoke all on function public.delete_test_assignment_safe(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_unassigned_test_atomic(uuid) from public, anon, authenticated;
grant execute on function public.create_composite_test_assignment_atomic(uuid, uuid[], text, integer, text, boolean, timestamptz, boolean, uuid) to service_role;
grant execute on function public.delete_test_assignment_safe(uuid, uuid), public.delete_unassigned_test_atomic(uuid) to service_role;

commit;
