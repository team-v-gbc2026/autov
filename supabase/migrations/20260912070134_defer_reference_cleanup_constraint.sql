-- Keep reference history protected while allowing an entire account/project to cascade.
-- Check after all nested project deletions have completed, not midway through the cascade.
alter table public.generation_inputs
  alter constraint generation_inputs_asset_id_project_id_fkey
  deferrable initially deferred;
