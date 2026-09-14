-- eve owns transcripts and authorizes sessions by its internal user/project address.
-- This user-owned database row is a lookup cache, never an authorization grant.
create table public.project_conversations (
  project_id uuid primary key references public.projects(id) on delete cascade,
  session_id text unique check (session_id is null or char_length(session_id) between 1 and 255),
  initial_prompt_hash text,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.project_conversations enable row level security;
revoke all on public.project_conversations from public, anon, authenticated;
grant select on public.project_conversations to authenticated;
grant insert (project_id) on public.project_conversations to authenticated;
grant update (session_id, initial_prompt_hash, lease_id, lease_until) on public.project_conversations to authenticated;
create policy project_conversations_read on public.project_conversations
  for select to authenticated using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

create policy project_conversations_create on public.project_conversations
  for insert to authenticated with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
create policy project_conversations_update on public.project_conversations
  for update to authenticated using (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

-- Atomic admission across server instances. Uses the invoking user's RLS permissions.
create function public.claim_project_conversation(p_project_id uuid, p_lease_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  with claimed as (
    update public.project_conversations
    set lease_id = p_lease_id, lease_until = now() + interval '2 minutes'
    where project_id = p_project_id and (lease_until is null or lease_until < now())
    returning project_id
  ) select exists (select 1 from claimed);
$$;
revoke all on function public.claim_project_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_project_conversation(uuid, uuid) to authenticated;
