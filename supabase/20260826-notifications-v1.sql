begin;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'TEST_ASSIGNED', 'MATERIAL_ASSIGNED', 'TRAINER_ASSIGNED', 'TRAINER_RESTARTED',
    'TEST_COMPLETED', 'TRAINER_COMPLETED', 'SUPPORT_MESSAGE_RECEIVED'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  message text not null default '' check (char_length(message) <= 240),
  href text not null check (char_length(href) between 1 and 500 and href like '/%' and href not like '//%'),
  dedupe_key text not null check (char_length(dedupe_key) between 3 and 200),
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (recipient_user_id, dedupe_key)
);

create index notifications_recipient_unread_created_idx
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from public, anon, authenticated;
grant select, insert, update on table public.notifications to service_role;

create function public.insert_notification_v1(
  p_recipient_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_href text,
  p_dedupe_key text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.notifications(recipient_user_id, type, title, message, href, dedupe_key)
  values (p_recipient_user_id, p_type, left(btrim(p_title), 160), left(btrim(coalesce(p_message, '')), 240), p_href, p_dedupe_key)
  on conflict (recipient_user_id, dedupe_key) do nothing;
end;
$$;

create function public.mark_notification_read_v1(p_recipient_user_id uuid, p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.notifications
  set read_at = coalesce(read_at, clock_timestamp())
  where id = p_notification_id and recipient_user_id = p_recipient_user_id;
  return found;
end;
$$;

create function public.mark_all_notifications_read_v1(p_recipient_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_count integer;
begin
  update public.notifications
  set read_at = clock_timestamp()
  where recipient_user_id = p_recipient_user_id and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.notify_test_assigned_v1() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  perform public.insert_notification_v1(new.student_id, 'TEST_ASSIGNED', 'Тест назначен', new.title,
    '/student/tests', 'TEST_ASSIGNED:' || new.id::text);
  return new;
end;
$$;

create trigger notifications_test_assigned_v1
after insert on public.test_assignments for each row execute function public.notify_test_assigned_v1();

create function public.notify_material_assigned_v1() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_title text;
begin
  if tg_table_name = 'student_material_access' then
    select title into v_title from public.materials where id = new.material_id;
  else
    select name into v_title from public.material_folders where id = new.folder_id;
  end if;
  if v_title is not null then
    perform public.insert_notification_v1(new.student_id, 'MATERIAL_ASSIGNED', 'Добавлен материал', v_title,
      '/student/materials', 'MATERIAL_ASSIGNED:' || new.id::text);
  end if;
  return new;
end;
$$;

create trigger notifications_material_assigned_v1
after insert on public.student_material_access for each row execute function public.notify_material_assigned_v1();
create trigger notifications_material_folder_assigned_v1
after insert on public.student_material_folder_access for each row execute function public.notify_material_assigned_v1();

create function public.remember_trainer_completion_delete_v1() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  perform set_config('nsp.restart_trainer_key', old.student_id::text || ':' || coalesce(old.source_trainer_id::text, ''), true);
  return old;
end;
$$;

create trigger notifications_remember_trainer_restart_v1
after delete on public.trainer_completion_history for each row execute function public.remember_trainer_completion_delete_v1();

create function public.notify_trainer_assigned_v1() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_title text; v_type text; v_restarted boolean;
begin
  select title, type into v_title, v_type from public.trainers where id = new.trainer_id;
  if v_title is null then return new; end if;
  v_restarted := current_setting('nsp.restart_trainer_key', true) = new.student_id::text || ':' || new.trainer_id::text;
  perform public.insert_notification_v1(
    new.student_id,
    case when v_restarted then 'TRAINER_RESTARTED' else 'TRAINER_ASSIGNED' end,
    case when v_restarted then 'Тренажёр перезапущен' else 'Тренажёр назначен' end,
    v_title,
    case when v_type = 'QUICK_PROBLEMS' then '/student/trainers/quick-problems' else '/student/trainers' end,
    (case when v_restarted then 'TRAINER_RESTARTED:' else 'TRAINER_ASSIGNED:' end) || new.id::text
  );
  return new;
end;
$$;

create trigger notifications_trainer_assigned_v1
after insert on public.trainer_assignments for each row execute function public.notify_trainer_assigned_v1();

create function public.notify_test_completed_v1() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_admin_id uuid; v_test_title text; v_student_name text;
begin
  if old.submitted_at is not null or new.submitted_at is null then return new; end if;
  select assignment.assigned_by, assignment.title, coalesce(nullif(btrim(student.full_name), ''), student.email, 'Ученик')
  into v_admin_id, v_test_title, v_student_name
  from public.test_assignments assignment
  join public.profiles student on student.id = new.student_id
  join public.profiles recipient on recipient.id = assignment.assigned_by and recipient.role = 'ADMIN'
  where assignment.id = new.assignment_id;
  if v_admin_id is null then return new; end if;
  perform public.insert_notification_v1(v_admin_id, 'TEST_COMPLETED', v_student_name || ' прошёл тест', v_test_title,
    '/admin/students/' || new.student_id::text || '?tab=tests', 'TEST_COMPLETED:' || new.id::text);
  return new;
end;
$$;

create trigger notifications_test_completed_v1
after update of submitted_at on public.test_attempts for each row execute function public.notify_test_completed_v1();

create function public.notify_trainer_completed_v1() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_student_name text;
begin
  select coalesce(nullif(btrim(full_name), ''), email, 'Ученик') into v_student_name
  from public.profiles where id = new.student_id;
  perform public.insert_notification_v1(new.owner_admin_id, 'TRAINER_COMPLETED', v_student_name || ' завершил тренажёр', new.trainer_title,
    '/admin/students/' || new.student_id::text || '?tab=trainers', 'TRAINER_COMPLETED:' || new.id::text);
  return new;
end;
$$;

create trigger notifications_trainer_completed_v1
after insert on public.trainer_completion_history for each row execute function public.notify_trainer_completed_v1();

-- SUPPORT_MESSAGE_RECEIVED is reserved in the v1 type constraint, but intentionally has no
-- producer yet: support_messages has no owner/recipient admin and the current inbox is global.
-- Broadcasting to every ADMIN would violate the recipient-ownership requirement.

revoke all on function public.insert_notification_v1(uuid,text,text,text,text,text),
  public.mark_notification_read_v1(uuid,uuid), public.mark_all_notifications_read_v1(uuid),
  public.notify_test_assigned_v1(), public.notify_material_assigned_v1(),
  public.remember_trainer_completion_delete_v1(), public.notify_trainer_assigned_v1(),
  public.notify_test_completed_v1(), public.notify_trainer_completed_v1()
from public, anon, authenticated;
grant execute on function public.mark_notification_read_v1(uuid,uuid), public.mark_all_notifications_read_v1(uuid) to service_role;

commit;
