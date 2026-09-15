-- Run against the migrated database. All fixtures roll back, including Auth users.
begin;
insert into auth.users(id) values ('bbaaaaaa-0000-4000-8000-000000000001'), ('bbaaaaaa-0000-4000-8000-000000000002');
insert into public.projects(id,user_id,name) values
('bbaaaaaa-0000-4000-8000-000000000011','bbaaaaaa-0000-4000-8000-000000000001','Owner A'),
('bbaaaaaa-0000-4000-8000-000000000012','bbaaaaaa-0000-4000-8000-000000000002','Owner B'),
('bbaaaaaa-0000-4000-8000-000000000013','bbaaaaaa-0000-4000-8000-000000000001','Other project');
select set_config('request.jwt.claim.sub','bbaaaaaa-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.projects) <> 2 then raise exception 'Project isolation failed'; end if;
  insert into storage.objects(bucket_id,name) values ('references','bbaaaaaa-0000-4000-8000-000000000001/bbaaaaaa-0000-4000-8000-000000000011/bbaaaaaa-0000-4000-8000-000000000021');
  begin
    insert into storage.objects(bucket_id,name) values ('references','bbaaaaaa-0000-4000-8000-000000000001/bbaaaaaa-0000-4000-8000-000000000012/forbidden');
    raise exception 'Cross-user storage upload accepted';
  exception when insufficient_privilege then null;
  end;
  insert into public.assets(id,project_id,name,storage_path,mime_type,size_bytes) values
  ('bbaaaaaa-0000-4000-8000-000000000021','bbaaaaaa-0000-4000-8000-000000000011','reference.png','bbaaaaaa-0000-4000-8000-000000000001/bbaaaaaa-0000-4000-8000-000000000011/bbaaaaaa-0000-4000-8000-000000000021','image/png',100);
  begin
    insert into public.assets(id,project_id,name,storage_path,mime_type,size_bytes) values
    ('bbaaaaaa-0000-4000-8000-000000000022','bbaaaaaa-0000-4000-8000-000000000012','cross.png','bbaaaaaa-0000-4000-8000-000000000002/bbaaaaaa-0000-4000-8000-000000000012/bbaaaaaa-0000-4000-8000-000000000022','image/png',100);
    raise exception 'Cross-user asset write accepted';
  exception when insufficient_privilege then null;
  end;
  -- The storage path is bound to the owner and project, so an asset row cannot
  -- be pointed at another project's directory.
  begin
    insert into public.assets(id,project_id,name,storage_path,mime_type,size_bytes) values
    ('bbaaaaaa-0000-4000-8000-000000000023','bbaaaaaa-0000-4000-8000-000000000011','mismatched.png','bbaaaaaa-0000-4000-8000-000000000001/bbaaaaaa-0000-4000-8000-000000000013/bbaaaaaa-0000-4000-8000-000000000023','image/png',100);
    raise exception 'Mismatched storage path accepted';
  exception when insufficient_privilege then null;
  end;
  update public.assets set archived=true where id='bbaaaaaa-0000-4000-8000-000000000021';
  if (select count(*) from public.assets where id='bbaaaaaa-0000-4000-8000-000000000021' and archived) <> 1 then raise exception 'Owner cannot archive a reference'; end if;
  -- Conversations bind to a project the caller owns, never to someone else's.
  insert into public.project_conversations(project_id) values ('bbaaaaaa-0000-4000-8000-000000000011');
  begin
    insert into public.project_conversations(project_id) values ('bbaaaaaa-0000-4000-8000-000000000012');
    raise exception 'Cross-user conversation accepted';
  exception when insufficient_privilege then null;
  end;
  -- Document and operation state is written only by validated server services.
  begin
    insert into public.studio_documents(project_id,document) values ('bbaaaaaa-0000-4000-8000-000000000011','{}'::jsonb);
    raise exception 'Client can write studio documents';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.studio_operations(project_id,session_id,call_id,kind,expected_revision)
    values ('bbaaaaaa-0000-4000-8000-000000000011','s','c','generate',0);
    raise exception 'Client can create studio operations';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','bbaaaaaa-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
  if (select count(*) from storage.objects where bucket_id='references') <> 0 then raise exception 'Other user can read private storage'; end if;
  if (select count(*) from public.assets) <> 0 then raise exception 'Other user can read private work'; end if;
  if (select count(*) from public.project_conversations) <> 0 then raise exception 'Other user can read private conversations'; end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.projects','select') then raise exception 'Anonymous project access'; end if;
  if to_regprocedure('public.save_generation(uuid,text,uuid[])') is not null then raise exception 'Retired RPC still exists'; end if;
  if to_regclass('public.generations') is not null then raise exception 'Retired generations table still exists'; end if;
  if to_regclass('public.generation_inputs') is not null then raise exception 'Retired generation_inputs table still exists'; end if;
  if to_regclass('public.effect_versions') is not null then raise exception 'Retired effect_versions table still exists'; end if;
end $$;
-- Account deletion must cascade through both projects and their reference snapshots.
delete from auth.users where id in ('bbaaaaaa-0000-4000-8000-000000000001','bbaaaaaa-0000-4000-8000-000000000002');
set constraints all immediate;
do $$ begin
  if exists (select 1 from public.projects where id in ('bbaaaaaa-0000-4000-8000-000000000011','bbaaaaaa-0000-4000-8000-000000000012')) then raise exception 'Account cleanup did not cascade'; end if;
  if exists (select 1 from public.assets where project_id='bbaaaaaa-0000-4000-8000-000000000011') then raise exception 'Account cleanup left reference rows'; end if;
end $$;
rollback;
