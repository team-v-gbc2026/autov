-- Browser roles can observe owned state. All transitions run through validated server services.
create table public.studio_documents (
  project_id uuid primary key references public.projects(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  updated_at timestamptz not null default now()
);
create table public.studio_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id text not null,
  call_id text not null,
  turn_id text,
  kind text not null,
  expected_revision bigint not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','cancelled','expired')),
  input jsonb not null default '{}',
  result jsonb,
  before_document jsonb,
  after_revision bigint,
  lease_id uuid,
  lease_until timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id, session_id, call_id)
);
create index studio_operations_pending_idx on public.studio_operations(project_id, created_at) where status in ('pending','running');
create table public.studio_provider_calls (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  operation_id uuid not null references public.studio_operations(id) on delete cascade,
  stage text not null,
  reserved_usd numeric(12,6) not null check(reserved_usd >= 0),
  charged_usd numeric(12,6),
  result jsonb,
  created_at timestamptz not null default now(),
  unique(operation_id, stage)
);
create index studio_provider_calls_project_idx on public.studio_provider_calls(project_id);
create table public.studio_reference_provenance (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  operation_id uuid not null references public.studio_operations(id) on delete cascade,
  source_revision bigint not null,
  timestamps jsonb not null default '[]',
  source_reference_ids uuid[] not null default '{}'
);

alter table public.studio_documents enable row level security;
alter table public.studio_operations enable row level security;
alter table public.studio_provider_calls enable row level security;
alter table public.studio_reference_provenance enable row level security;
revoke all on public.studio_documents, public.studio_operations, public.studio_provider_calls, public.studio_reference_provenance from anon, authenticated;
grant select on public.studio_documents, public.studio_operations to authenticated;
grant all on public.studio_documents, public.studio_operations, public.studio_provider_calls, public.studio_reference_provenance to service_role;
create policy studio_documents_read on public.studio_documents for select to authenticated using (exists(select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));
create policy studio_operations_read on public.studio_operations for select to authenticated using (exists(select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));

-- Serializes all document writes, cancellations and browser acknowledgements per project.
create function public.studio_transition(p_user uuid, p_project uuid, p_action text, p_args jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare d public.studio_documents; o public.studio_operations; c public.studio_provider_calls; total numeric; next_revision bigint;
begin
  perform 1 from public.projects where id=p_project and user_id=p_user for update;
  if not found then raise exception 'Project unavailable'; end if;
  select * into d from public.studio_documents where project_id=p_project for update;
  if p_action='initialize' then
    insert into public.studio_documents(project_id,document) values(p_project,p_args->'document') on conflict do nothing;
    select * into d from public.studio_documents where project_id=p_project;
    return to_jsonb(d);
  end if;
  if d.project_id is null then raise exception 'Open the studio before using tools'; end if;
  if p_action='cancel_turn' then
    update public.studio_operations set status='cancelled',result='{"code":"CANCELLED","message":"Turn cancelled."}'
    where project_id=p_project and session_id=p_args->>'sessionId' and status in ('pending','running');
    return '{}'::jsonb;
  end if;
  if p_action='create' then
    if p_args->>'parentId' is not null then
      select * into o from public.studio_operations where id=(p_args->>'parentId')::uuid and project_id=p_project;
      if o.id is null then raise exception 'Parent operation unavailable'; end if;
      if o.status not in ('pending','running') then return to_jsonb(o); end if;
    end if;
    insert into public.studio_operations(project_id,session_id,call_id,turn_id,kind,expected_revision,input,expires_at)
    values(p_project,p_args->>'sessionId',p_args->>'callId',p_args->>'turnId',p_args->>'kind',(p_args->>'revision')::bigint,p_args->'input',
      case when (p_args->>'browser')::boolean then now()+interval '60 seconds' else null end)
    on conflict(project_id,session_id,call_id) do nothing;
    select * into o from public.studio_operations where project_id=p_project and session_id=p_args->>'sessionId' and call_id=p_args->>'callId';
    return to_jsonb(o);
  end if;
  select * into o from public.studio_operations where id=(p_args->>'id')::uuid and project_id=p_project for update;
  if o.id is null then raise exception 'Operation unavailable'; end if;
  if o.status in ('completed','failed','cancelled','expired') then return to_jsonb(o); end if;
  if o.expires_at < now() then
    update public.studio_operations set status='expired', result='{"code":"UNAVAILABLE","message":"Open the studio and try again."}' where id=o.id returning * into o;
    return to_jsonb(o);
  end if;
  if p_action='claim' then
    if o.status='running' and o.lease_until > now() then return 'null'::jsonb; end if;
    update public.studio_operations set status='running',lease_id=(p_args->>'leaseId')::uuid,lease_until=least(now()+interval '30 seconds',expires_at) where id=o.id returning * into o;
  elsif p_action='ack' then
    if o.lease_id is distinct from (p_args->>'leaseId')::uuid or o.lease_until < now() then raise exception 'Expired browser lease'; end if;
    if d.revision <> o.expected_revision then
      update public.studio_operations set status='failed',result='{"code":"CONFLICT","message":"The effect changed. Read it again."}' where id=o.id returning * into o;
    else
      update public.studio_operations set status=case when p_args->>'error' is null then 'completed' else 'failed' end,
        result=case when p_args->>'error' is null then p_args->'result' else jsonb_build_object('code','UNAVAILABLE','message',p_args->>'error') end where id=o.id returning * into o;
    end if;
  elsif p_action='commit' then
    if d.revision <> o.expected_revision then
      update public.studio_operations set status='failed',result='{"code":"CONFLICT","message":"The effect changed. Read it again."}' where id=o.id returning * into o;
    else
      next_revision:=d.revision+1;
      update public.studio_documents set document=p_args->'document',revision=next_revision,updated_at=now() where project_id=p_project;
      update public.studio_operations set status='completed',before_document=d.document,after_revision=next_revision,
        result=jsonb_build_object('revision',next_revision,'operationId',o.id,'summary',p_args->>'summary') where id=o.id returning * into o;
    end if;
  elsif p_action='fail' then
    update public.studio_operations set status='failed',result=p_args->'result' where id=o.id returning * into o;
  elsif p_action='reserve' then
    select * into c from public.studio_provider_calls where operation_id=o.id and stage=p_args->>'stage';
    if c.id is not null then return jsonb_build_object('replayed',true,'call',to_jsonb(c)); end if;
    select coalesce(sum(coalesce(charged_usd,reserved_usd)),0) into total from public.studio_provider_calls where project_id=p_project;
    if total+(p_args->>'usd')::numeric > (p_args->>'limit')::numeric then raise exception 'Generation budget exceeded'; end if;
    insert into public.studio_provider_calls(project_id,operation_id,stage,reserved_usd) values(p_project,o.id,p_args->>'stage',(p_args->>'usd')::numeric) returning * into c;
    return jsonb_build_object('replayed',false,'call',to_jsonb(c));
  elsif p_action='settle' then
    update public.studio_provider_calls set charged_usd=(p_args->>'usd')::numeric,result=p_args->'result' where operation_id=o.id and stage=p_args->>'stage';
  elsif p_action <> 'poll' then raise exception 'Unsupported transition';
  end if;
  return to_jsonb(o);
end $$;
revoke all on function public.studio_transition(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_transition(uuid,uuid,text,jsonb) to service_role;

-- Realtime is an optimization; the browser also reconciles on reconnect/poll.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.studio_documents, public.studio_operations;
  end if;
end $$;
