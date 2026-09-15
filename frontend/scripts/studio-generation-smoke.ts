// Explicit opt-in: uses configured project ownership and its spending ledger.
import { createOperation, readState } from "../src/lib/studio-tools/server";
import { generateCandidate } from "../src/lib/studio-tools/legacy-generation";
if (process.env.STUDIO_LIVE_SMOKE !== "1")
  throw new Error(
    "Set STUDIO_LIVE_SMOKE=1 to authorize a live, billable generation smoke test.",
  );
const userId = process.env.STUDIO_SMOKE_USER_ID,
  projectId = process.env.STUDIO_SMOKE_PROJECT_ID;
if (!userId || !projectId)
  throw new Error(
    "Set STUDIO_SMOKE_USER_ID and STUDIO_SMOKE_PROJECT_ID to a configured test project.",
  );
const identity = { userId, projectId },
  state = await readState(identity);
const input = {
  expectedRevision: state.revision,
  prompt: "A small warm fire projectile with a short smoke trail",
  referenceIds: [],
  mode: "replace" as const,
};
const operation = await createOperation(
  identity,
  "smoke-test",
  crypto.randomUUID(),
  "generate",
  state.revision,
  input,
);
const document = await generateCandidate(
  identity,
  operation,
  input,
  AbortSignal.timeout(900000),
);
console.log(
  JSON.stringify({
    name: document.name,
    layers: document.layers.length,
    committed: false,
  }),
);
