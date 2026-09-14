# Studio operations

- `operations.ts`: pure v2 editing, generation composition, summaries and schemas.
- `server.ts`: verified project access, revision-checked persistence and undo.
- `generation.ts`: persisted generation stages with injectable model transport.
- `references.ts`: board-only image resolution and generated asset registration.
- `mentions.ts`: shared structured-tag parsing without React or Eve dependencies.

Eve adapters are in `agent/tools`. The authenticated browser transport is
`/api/studio`; the browser synchronizes through `use-studio-document.ts`.
Only the server commits document revisions. Manual edits are optimistic and flush
before chat submission. Conflicts retain the local draft for export/recovery.

New generation steps should implement a separate stage between board reference
resolution and candidate capture. Do not bypass operation identity, spending
reservations, or the expected-revision commit. Generated images must first become
board assets through the shared registration boundary.
