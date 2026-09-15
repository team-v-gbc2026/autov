-- Production contained no autov.lab/1 studio documents or operation snapshots
-- when this invariant was introduced. Keep the authoritative state V2-only.
alter table public.studio_documents
  add constraint studio_documents_v2_only
  check (document->>'schemaVersion' = 'autov.lab/2')
  not valid;

alter table public.studio_documents
  validate constraint studio_documents_v2_only;
