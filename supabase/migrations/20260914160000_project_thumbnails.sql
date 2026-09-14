-- Private, replaceable project covers. Reads are signed server-side; writes are
-- restricted to an authenticated owner of the project named by the first path segment.
update storage.buckets
set allowed_mime_types = array['application/json', 'image/webp']
where id = 'vfx-fixtures';

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('project-thumbnails', 'project-thumbnails', false, 1048576, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy project_thumbnail_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-thumbnails'
  and name = (storage.foldername(name))[1] || '/cover.webp'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = (select auth.uid())
  )
);

create policy project_thumbnail_select on storage.objects for select to authenticated
using (
  bucket_id = 'project-thumbnails'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = (select auth.uid())
  )
);

create policy project_thumbnail_update on storage.objects for update to authenticated
using (
  bucket_id = 'project-thumbnails'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = (select auth.uid())
  )
)
with check (
  bucket_id = 'project-thumbnails'
  and name = (storage.foldername(name))[1] || '/cover.webp'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = (select auth.uid())
  )
);

create policy project_thumbnail_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'project-thumbnails'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and p.user_id = (select auth.uid())
  )
);
