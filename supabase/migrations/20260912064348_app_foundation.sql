-- Application metadata only. Effect JSON belongs to the generation team's schema.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);
create index projects_user_created_idx on public.projects(user_id, created_at desc);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  bucket_id text not null default 'references' check (bucket_id = 'references'),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp','image/gif')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, project_id)
);
create index assets_project_created_idx on public.assets(project_id, created_at);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft','queued','running','succeeded','failed')),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, project_id)
);
create index generations_project_created_idx on public.generations(project_id, created_at);

create table public.generation_inputs (
  generation_id uuid not null,
  asset_id uuid not null,
  project_id uuid not null,
  position integer not null check (position >= 0),
  primary key (generation_id, asset_id),
  unique (generation_id, position),
  foreign key (generation_id, project_id) references public.generations(id, project_id) on delete cascade,
  foreign key (asset_id, project_id) references public.assets(id, project_id)
);
create index generation_inputs_asset_idx on public.generation_inputs(asset_id, project_id);
create index generation_inputs_project_idx on public.generation_inputs(project_id);

create table public.effect_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  generation_id uuid not null,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  schema_version text not null check (char_length(schema_version) between 1 and 80),
  created_at timestamptz not null default now(),
  foreign key (generation_id, project_id) references public.generations(id, project_id) on delete cascade
);
create index effect_versions_project_created_idx on public.effect_versions(project_id, created_at desc);
create index effect_versions_generation_idx on public.effect_versions(generation_id, project_id);

alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.generations enable row level security;
alter table public.generation_inputs enable row level security;
alter table public.effect_versions enable row level security;

revoke all on public.projects, public.assets, public.generations, public.generation_inputs, public.effect_versions from anon, authenticated;
grant select on public.projects, public.assets, public.generations, public.generation_inputs, public.effect_versions to authenticated;
grant insert (name) on public.projects to authenticated;
grant update (name) on public.projects to authenticated;
grant insert (id, project_id, name, storage_path, mime_type, size_bytes) on public.assets to authenticated;
grant update (archived) on public.assets to authenticated;
grant insert (project_id, prompt) on public.generations to authenticated;
grant insert on public.generation_inputs to authenticated;
grant all on public.projects, public.assets, public.generations, public.generation_inputs, public.effect_versions to service_role;

create policy projects_read on public.projects for select to authenticated using (user_id = (select auth.uid()));
create policy projects_create on public.projects for insert to authenticated with check (user_id = (select auth.uid()));
create policy projects_rename on public.projects for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy assets_read on public.assets for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy assets_create on public.assets for insert to authenticated with check (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  and storage_path = (select auth.uid())::text || '/' || project_id::text || '/' || id::text
);
create policy assets_archive on public.assets for update to authenticated using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))) with check (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));

create policy generations_read on public.generations for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy generations_create on public.generations for insert to authenticated with check (status = 'draft' and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy inputs_read on public.generation_inputs for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy inputs_create on public.generation_inputs for insert to authenticated with check (
  exists (select 1 from public.generations g where g.id = generation_id and g.project_id = generation_inputs.project_id and g.status = 'draft')
  and exists (select 1 from public.assets a where a.id = asset_id and a.project_id = generation_inputs.project_id and not a.archived)
);
create policy effects_read on public.effect_versions for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));

-- Transactionally save a prompt and its ordered reference snapshot.
create function public.save_generation(p_project_id uuid, p_prompt text, p_asset_ids uuid[] default '{}')
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if cardinality(p_asset_ids) > 8 then raise exception 'Use at most 8 references'; end if;
  insert into public.generations(project_id, prompt) values (p_project_id, btrim(p_prompt)) returning id into result;
  insert into public.generation_inputs(generation_id, asset_id, project_id, position)
    select result, asset_id, p_project_id, (ordinality - 1)::integer
    from unnest(p_asset_ids) with ordinality as refs(asset_id, ordinality);
  return result;
end;
$$;
revoke all on function public.save_generation(uuid, text, uuid[]) from public, anon;
grant execute on function public.save_generation(uuid, text, uuid[]) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('references', 'references', false, 20971520, array['image/png','image/jpeg','image/webp','image/gif']);

create policy reference_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'references'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[2] and p.user_id = (select auth.uid()))
);
create policy reference_read on storage.objects for select to authenticated using (
  bucket_id = 'references' and (storage.foldername(name))[1] = (select auth.uid())::text
);
-- Only remove unregistered uploads. Archived references remain for generation history.
create policy reference_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'references' and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (select 1 from public.assets a where a.storage_path = storage.objects.name)
);
