alter policy reference_upload on storage.objects with check (
  bucket_id = 'references'
  and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(storage.objects.name))[2]
      and p.user_id = (select auth.uid())
  )
);
