-- Deleting a project cascades its relational records; files are cleaned up
-- through the Storage API after their asset records no longer exist.
grant delete on public.projects to authenticated;

create policy projects_delete on public.projects
  for delete to authenticated
  using (user_id = (select auth.uid()));
