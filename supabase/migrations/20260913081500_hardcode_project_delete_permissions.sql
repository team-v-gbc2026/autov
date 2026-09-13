-- Re-assert delete permission and ownership policy for project owners.
-- This resolves authenticated-role permission-denied errors on project deletion.

alter table public.projects enable row level security;

grant delete on public.projects to authenticated;

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (user_id = (select auth.uid()));
