-- Append-only template expansion metadata; existing topic IDs/attempts are preserved.
-- Apply after the matching application release. No schema or security changes.
begin;
do $$
declare v_updated integer;
begin
  with counts(generator_key,template_count) as (values ('nis_new_s1_1_v2',31),('nis_new_s1_2_v2',13),('nis_new_s1_3_v2',6),('nis_new_s1_4_v2',8),('nis_new_s1_5_v2',5),('nis_new_s1_6_v2',8),('nis_new_s1_7_v2',8),('nis_new_s1_8_v2',9),('nis_new_s1_9_v2',8),('nis_new_s1_10_v2',12),('nis_new_s1_11_v2',7),('nis_new_s1_12_v2',14),('nis_new_s1_13_v2',8),('nis_new_s1_14_v2',8),('nis_new_s2_1_v2',6),('nis_new_s2_2_v2',8),('nis_new_s2_3_v2',11),('nis_new_s2_4_v2',7),('nis_new_s2_5_v2',8),('nis_new_s2_6_v2',8),('nis_new_s2_7_v2',7),('nis_new_s2_8_v2',20),('nis_new_s2_9_v2',13),('nis_new_s2_10_v2',5),('nis_new_s2_11_v2',5))
  update public.learning_program_skill_generators g
  set config=g.config || jsonb_build_object('template_count',c.template_count,
    'questions_per_attempt',greatest(10,c.template_count),'all_subtypes_required',true)
  from counts c, public.learning_program_topics t
  where g.generator_key=c.generator_key and t.id=g.program_topic_id
    and t.program_id='40df1e7e-b769-4ef4-8df9-2066cf5976d4';
  get diagnostics v_updated = row_count;
  if v_updated <> 25 then raise exception 'Expected 25 generators, updated %',v_updated; end if;
end;
$$;
commit;
