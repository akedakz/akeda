alter table public.profiles add column if not exists avatar_path text null;
alter table public.profiles add column if not exists avatar_updated_at timestamptz null;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('student-avatars','student-avatars',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "student avatar public read" on storage.objects;
drop policy if exists "student avatar authenticated read" on storage.objects;
