# Eve studio tool adapters

Scaffold only. There are no callable studio tools in this directory yet.

Eve discovers authored tools from TypeScript files in this directory. A filename
such as `read_studio.ts` becomes the model-facing tool name. Use `defineTool`
from `eve/tools` with a runtime input schema, a description, and an executor.
See the installed Eve guide at `node_modules/eve/docs/tools/overview.mdx`.

Each adapter should:

1. Resolve verified user/project identity and the current studio state through
   an explicitly implemented transport. Do not trust IDs supplied by the model.
2. Parse arguments and call the shared operation in `src/lib/studio-tools/`.
3. Return the actual operation outcome, without credentials or private URLs.

Keep validation and studio mutations in the shared operation; keep Eve-specific
session context and result formatting in this adapter. Do not implement placeholder
executors that return success before an action is connected.

`agent.ts` keeps `defaultTools: false`: shell, filesystem, web, and delegation
capabilities remain disabled. That setting does not disable authored tools added
here, so add executable tool files only when their implementations are ready.

Before enabling edits, wire results into the studio's authoritative state and
handle stale snapshots and durable replay. This scaffold adds no transport,
new database tables, renderer integration, or tool registration.
