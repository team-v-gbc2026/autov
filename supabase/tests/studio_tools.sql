-- Run after migrations in a disposable database. Assertions raise on failure.
begin;
insert into auth.users(id) values ('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
insert into public.projects(id,user_id,name) values
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','One'),
('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Two');
do $$ declare
 u uuid := '20000000-0000-4000-8000-000000000001'; p uuid := '10000000-0000-4000-8000-000000000001';
 op jsonb; again jsonb; cap jsonb; lease uuid := gen_random_uuid(); reserve jsonb;
begin
 perform public.studio_transition(u,p,'initialize','{"document":{"schemaVersion":"autov.lab/2","name":"Before"}}');
 perform public.studio_transition(u,p,'initialize','{"document":{"name":"WRONG"}}');
 if (select document->>'name' from public.studio_documents where project_id=p) <> 'Before' then raise exception 'Initialization overwrote existing state'; end if;
 op := public.studio_transition(u,p,'create','{"sessionId":"agent","callId":"one","kind":"edit","revision":0,"input":{},"browser":false}');
 again := public.studio_transition(u,p,'create','{"sessionId":"agent","callId":"one","kind":"edit","revision":0,"input":{},"browser":false}');
 if op->>'id' <> again->>'id' then raise exception 'Duplicate operation'; end if;
 op := public.studio_transition(u,p,'commit',jsonb_build_object('id',op->>'id','document','{"name":"After"}'::jsonb,'summary','Edit'));
 if op->>'after_revision' <> '1' or op->'before_document'->>'name' <> 'Before' then raise exception 'Commit failed'; end if;
 perform public.studio_transition(u,p,'commit',jsonb_build_object('id',op->>'id','document','{"name":"WRONG"}'::jsonb));
 if (select revision from public.studio_documents where project_id=p) <> 1 then raise exception 'Replay wrote twice'; end if;
 op := public.studio_transition(u,p,'create','{"sessionId":"agent","callId":"stale","kind":"edit","revision":0,"input":{},"browser":false}');
 op := public.studio_transition(u,p,'commit',jsonb_build_object('id',op->>'id','document','{"name":"WRONG"}'::jsonb));
 if op->>'status' <> 'failed' then raise exception 'Stale write accepted'; end if;
 cap := public.studio_transition(u,p,'create','{"sessionId":"agent","callId":"capture","kind":"preview","revision":1,"input":{},"browser":true}');
 op := public.studio_transition(u,p,'claim',jsonb_build_object('id',cap->>'id','leaseId',lease));
 again := public.studio_transition(u,p,'claim',jsonb_build_object('id',cap->>'id','leaseId',gen_random_uuid()));
 if again <> 'null'::jsonb then raise exception 'Two browsers claimed same request'; end if;
 begin
   perform public.studio_transition(u,p,'ack',jsonb_build_object('id',cap->>'id','leaseId',gen_random_uuid(),'result','{}'::jsonb));
   raise exception 'Forged lease accepted';
 exception when raise_exception then if sqlerrm <> 'Expired browser lease' then raise; end if; end;
 update public.studio_operations set expires_at=now()-interval '1 second' where id=(cap->>'id')::uuid;
 op := public.studio_transition(u,p,'ack',jsonb_build_object('id',cap->>'id','leaseId',lease,'result','{}'::jsonb));
 if op->>'status' <> 'expired' then raise exception 'Late acknowledgement accepted'; end if;
 op := public.studio_transition(u,p,'create','{"sessionId":"agent","callId":"generation","kind":"generate","revision":1,"input":{},"browser":false}');
 reserve := public.studio_transition(u,p,'reserve',jsonb_build_object('id',op->>'id','stage','plan','usd',20,'limit',30));
 if (reserve->>'replayed')::boolean then raise exception 'First reservation replayed'; end if;
 reserve := public.studio_transition(u,p,'reserve',jsonb_build_object('id',op->>'id','stage','plan','usd',20,'limit',30));
 if not (reserve->>'replayed')::boolean or reserve->'call'->'result' <> 'null'::jsonb then raise exception 'Unknown outcome not retained'; end if;
 begin
   perform public.studio_transition(u,p,'reserve',jsonb_build_object('id',op->>'id','stage','candidate','usd',20,'limit',30));
   raise exception 'Budget overrun accepted';
 exception when raise_exception then if sqlerrm <> 'Generation budget exceeded' then raise; end if; end;
 perform public.studio_transition(u,p,'cancel_turn','{"sessionId":"agent"}');
 op := public.studio_transition(u,p,'commit',jsonb_build_object('id',op->>'id','document','{"name":"WRONG"}'::jsonb));
 if op->>'status' <> 'cancelled' then raise exception 'Cancelled generation committed'; end if;
 cap := public.studio_transition(u,p,'create',jsonb_build_object('sessionId','agent','callId','late-child','kind','capture_candidate','revision',1,'input','{}'::jsonb,'browser',true,'parentId',op->>'id'));
 if cap->>'status' <> 'cancelled' then raise exception 'Cancelled parent created browser work'; end if;
 begin
   perform public.studio_transition('20000000-0000-4000-8000-000000000002',p,'initialize','{"document":{}}');
   raise exception 'Forged identity accepted';
 exception when raise_exception then if sqlerrm <> 'Project unavailable' then raise; end if; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.studio_documents) <> 1 then raise exception 'Owner cannot read document'; end if;
 begin
  update public.studio_documents set revision=999;
  raise exception 'Browser mutated state directly';
 exception when insufficient_privilege then null; end;
 begin
  perform public.studio_transition('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','poll','{}');
  raise exception 'Browser called trusted transition';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.studio_documents) <> 0 or (select count(*) from public.studio_operations) <> 0 then raise exception 'Cross-project read leaked'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform * from public.studio_documents; raise exception 'Anonymous read allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
