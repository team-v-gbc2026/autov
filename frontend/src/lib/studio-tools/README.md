# Studio tool operations

Scaffold only. No operations are implemented or registered yet.

Keep studio operations here, independent of Eve and React. `types.ts` provides
an adapter context, a typed result, and a runtime input parser contract. These
types do not implement authorization, persistence, or browser transport.

## Coordinate frame

Every operation that reads or writes effect geometry works in the effect's own
local frame: origin (0,0,0), up +Y, forward +Z, meters and radians. Layer
positions, emission directions, motion paths and forces are all effect-local.

Where the effect sits in the workspace is *placement*, and it is deliberately
not part of the effect document — it is viewer state owned by the editor (see
`lib/vfx-lab/placement.ts`). Tools edit the local effect; they never read or
write placement, and a tool must not try to compensate for it. State this frame
in the `description` of any operation that accepts or returns coordinates.

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
