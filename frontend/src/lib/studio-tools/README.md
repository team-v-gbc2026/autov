# Studio tool operations

Scaffold only. No operations are implemented or registered yet.

Keep studio operations here, independent of Eve and React. `types.ts` provides
an adapter context, a typed result, and a runtime input parser contract. These
types do not implement authorization, persistence, or browser transport.

When adding an operation:

1. Add a file such as `read-studio.ts` or `update-emitter.ts` implementing
   `StudioTool<Input, Output>`. Validate unknown input at runtime; use the
   studio document types in `components/vfx-studio/ui-model.ts`.
2. Keep the domain change separate from storage and UI delivery. Define which
   state is authoritative and how concurrent manual edits are detected before
   enabling mutations. The current document lives in browser React state.
3. Add a thin Eve adapter under `agent/tools/`. Resolve the authenticated
   user/project context on the server; never accept identity from model arguments.
4. Test validation, missing emitter IDs, stale state, and project isolation as
   appropriate to that operation.

Suggested first operations: read document/selection, add emitter, update emitter,
remove emitter, select emitter, and update effect settings. These are candidates,
not available tools. No generic SQL, arbitrary property paths, or shell executor
is needed for these operations.

A successful mutation result must mean the authoritative state actually changed.
If an operation only prepares an edit, identify it as a proposal. The current
sample preview is not connected to document edits; tools must not report rendering.
