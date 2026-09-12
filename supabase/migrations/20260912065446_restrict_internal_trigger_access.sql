-- Hosted projects may install this internal DDL event trigger in public.
-- It is not an application RPC; keep it executable only by its administrative owner.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
