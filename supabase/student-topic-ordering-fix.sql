create or replace function public.reorder_student_topics(p_student_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_student_id is null or p_ids is null then raise exception 'invalid topic set'; end if;
  if cardinality(p_ids) <> (select count(*) from public.student_topics where student_id = p_student_id) then raise exception 'invalid topic set'; end if;
  if cardinality(p_ids) <> (select count(distinct topic_id) from unnest(p_ids) as requested(topic_id)) then raise exception 'duplicate topic id'; end if;
  if exists (
    select 1 from unnest(p_ids) as requested(topic_id)
    left join public.student_topics topic on topic.id = requested.topic_id and topic.student_id = p_student_id
    where topic.id is null
  ) then raise exception 'foreign topic id'; end if;

  perform 1 from public.student_topics where student_id = p_student_id for update;
  update public.student_topics set sort_order = sort_order + 1000000 where student_id = p_student_id;
  update public.student_topics topic
    set sort_order = requested.position - 1, updated_at = now()
    from unnest(p_ids) with ordinality as requested(topic_id, position)
    where topic.id = requested.topic_id and topic.student_id = p_student_id;
end;
$$;

create or replace function public.set_student_topic_completion(p_student_id uuid, p_topic_id uuid)
returns table(topic_id uuid, topic_title text, topic_sort_order integer, topic_completed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  was_completed boolean;
  completed_ids uuid[];
  incomplete_ids uuid[];
  ordered_ids uuid[];
begin
  if p_student_id is null or p_topic_id is null then raise exception 'invalid topic'; end if;
  perform 1 from public.student_topics where student_id = p_student_id for update;
  select completed_at is not null into was_completed
    from public.student_topics where id = p_topic_id and student_id = p_student_id;
  if not found then raise exception 'topic not found'; end if;

  select coalesce(array_agg(id order by sort_order, id), array[]::uuid[]) into completed_ids
    from public.student_topics where student_id = p_student_id and completed_at is not null and id <> p_topic_id;
  select coalesce(array_agg(id order by sort_order, id), array[]::uuid[]) into incomplete_ids
    from public.student_topics where student_id = p_student_id and completed_at is null and id <> p_topic_id;

  if was_completed then
    update public.student_topics set completed_at = null, updated_at = now()
      where id = p_topic_id and student_id = p_student_id;
    if cardinality(incomplete_ids) > 0 then
      ordered_ids := completed_ids || incomplete_ids[1:1] || array[p_topic_id] || incomplete_ids[2:cardinality(incomplete_ids)];
    else
      ordered_ids := completed_ids || array[p_topic_id];
    end if;
  else
    update public.student_topics set completed_at = now(), updated_at = now()
      where id = p_topic_id and student_id = p_student_id;
    ordered_ids := completed_ids || array[p_topic_id] || incomplete_ids;
  end if;

  update public.student_topics set sort_order = sort_order + 1000000 where student_id = p_student_id;
  update public.student_topics topic
    set sort_order = requested.position - 1, updated_at = now()
    from unnest(ordered_ids) with ordinality as requested(topic_id, position)
    where topic.id = requested.topic_id and topic.student_id = p_student_id;

  return query
    select topic.id, topic.title, topic.sort_order, topic.completed_at
    from public.student_topics topic
    where topic.student_id = p_student_id
    order by topic.sort_order, topic.id;
end;
$$;

revoke all on function public.reorder_student_topics(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.set_student_topic_completion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reorder_student_topics(uuid, uuid[]) to service_role;
grant execute on function public.set_student_topic_completion(uuid, uuid) to service_role;
