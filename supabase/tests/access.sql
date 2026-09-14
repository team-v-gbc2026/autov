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
declare g uuid; other_g uuid; before_count integer;
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
  insert into public.generations(project_id,prompt) values ('bbaaaaaa-0000-4000-8000-000000000011','A swirl of sparks') returning id into g;
  insert into public.generation_inputs(generation_id,asset_id,project_id,position) values (g,'bbaaaaaa-0000-4000-8000-000000000021','bbaaaaaa-0000-4000-8000-000000000011',0);
  if (select count(*) from public.generation_inputs where generation_id=g) <> 1 then raise exception 'Inputs missing'; end if;
  select count(*) into before_count from public.generations;
  begin
    insert into public.generations(project_id,prompt) values ('bbaaaaaa-0000-4000-8000-000000000013','Cross-project reference') returning id into other_g;
    insert into public.generation_inputs(generation_id,asset_id,project_id,position) values (other_g,'bbaaaaaa-0000-4000-8000-000000000021','bbaaaaaa-0000-4000-8000-000000000013',0);
    raise exception 'Cross-project reference was accepted';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
  if (select count(*) from public.generations) <> before_count then raise exception 'Failed generation did not roll back'; end if;
  begin
    insert into public.generations(project_id,prompt) values ('bbaaaaaa-0000-4000-8000-000000000012','Another user project');
    raise exception 'Cross-user write accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.generations set status='succeeded' where id=g;
    raise exception 'Client can mark a generation complete';
  exception when insufficient_privilege then null;
  end;
  update public.assets set archived=true where id='bbaaaaaa-0000-4000-8000-000000000021';
  if (select count(*) from public.generation_inputs where generation_id=g) <> 1 then raise exception 'Archiving lost generation history'; end if;
  begin
    insert into public.generations(project_id,prompt) values ('bbaaaaaa-0000-4000-8000-000000000011','Archived reference') returning id into other_g;
    insert into public.generation_inputs(generation_id,asset_id,project_id,position) values (other_g,'bbaaaaaa-0000-4000-8000-000000000021','bbaaaaaa-0000-4000-8000-000000000011',0);
    raise exception 'Archived input accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','bbaaaaaa-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
  if (select count(*) from storage.objects where bucket_id='references') <> 0 then raise exception 'Other user can read private storage'; end if;
  if (select count(*) from public.assets) <> 0 or (select count(*) from public.generations) <> 0 or (select count(*) from public.generation_inputs) <> 0 then raise exception 'Other user can read private work'; end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.projects','select') then raise exception 'Anonymous project access'; end if;
  if to_regprocedure('public.save_generation(uuid,text,uuid[])') is not null then raise exception 'Retired RPC still exists'; end if;
end $$;
-- Account deletion must cascade through both projects and their reference snapshots.
delete from auth.users where id in ('bbaaaaaa-0000-4000-8000-000000000001','bbaaaaaa-0000-4000-8000-000000000002');
set constraints all immediate;
do $$ begin
  if exists (select 1 from public.projects where id in ('bbaaaaaa-0000-4000-8000-000000000011','bbaaaaaa-0000-4000-8000-000000000012')) then raise exception 'Account cleanup did not cascade'; end if;
end $$;
rollback;
