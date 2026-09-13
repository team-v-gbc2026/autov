-- Run against a disposable migrated database. All fixtures roll back.
begin;
insert into auth.users(id) values ('20000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002');
insert into public.projects(id, user_id, name) values
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Owner one'),
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Owner two');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
insert into public.project_conversations(project_id) values ('10000000-0000-4000-8000-000000000001');
update public.project_conversations set session_id='first-session' where project_id='10000000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from public.project_conversations) <> 1 then raise exception 'Owner read failed'; end if;
  begin
    insert into public.project_conversations(project_id) values ('10000000-0000-4000-8000-000000000002');
    raise exception 'Cross-user insert succeeded';
  exception when insufficient_privilege then null; end;
  if not public.claim_project_conversation('10000000-0000-4000-8000-000000000001',gen_random_uuid()) then raise exception 'Owner claim failed'; end if;
  if public.claim_project_conversation('10000000-0000-4000-8000-000000000001',gen_random_uuid()) then raise exception 'Double claim succeeded'; end if;
  update public.project_conversations set lease_until=now()-interval '1 second';
  if not public.claim_project_conversation('10000000-0000-4000-8000-000000000001',gen_random_uuid()) then raise exception 'Lease recovery failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
insert into public.project_conversations(project_id) values ('10000000-0000-4000-8000-000000000002');
do $$ declare changed integer; begin
  if (select count(*) from public.project_conversations) <> 1 then raise exception 'Cross-user read leaked'; end if;
  update public.project_conversations set session_id='stolen' where project_id='10000000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Cross-user update succeeded'; end if;
  if public.claim_project_conversation('10000000-0000-4000-8000-000000000001',gen_random_uuid()) then raise exception 'Cross-user lease succeeded'; end if;
  begin
    update public.project_conversations set project_id='10000000-0000-4000-8000-000000000001';
    raise exception 'Project reassignment succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform session_id from public.project_conversations;
    raise exception 'Anonymous read succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.claim_project_conversation('10000000-0000-4000-8000-000000000001',gen_random_uuid());
    raise exception 'Anonymous lease succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.projects where id='10000000-0000-4000-8000-000000000001';
do $$ begin
  if exists(select 1 from public.project_conversations where session_id='first-session') then raise exception 'Delete did not remove binding'; end if;
end $$;
rollback;
