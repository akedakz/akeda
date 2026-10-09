-- Data-only update of the existing skill; keeps attempts, assignments and progress.
begin;
do $$
declare
  v_topic uuid;
begin
  select t.id into strict v_topic
  from public.learning_program_topics t
  join public.learning_program_skill_generators g on g.program_topic_id=t.id
  where t.program_id='40df1e7e-b769-4ef4-8df9-2066cf5976d4'
    and g.generator_key='nis_new_s2_3_v2';
  update public.learning_program_topics
    set title='2.03 Признак делимости' where id=v_topic;
  update public.learning_program_skill_generators
    set config=config || jsonb_build_object('questions_per_attempt',11,'template_count',11,'all_subtypes_required',true)
    where program_topic_id=v_topic and generator_key='nis_new_s2_3_v2';
end;
$$;
commit;
