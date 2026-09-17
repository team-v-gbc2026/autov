# Eve: an evidence-first VFX authoring agent

## The premise

Eve is AutoV's agent for authoring effects in a constrained, real-time VFX renderer. Its central design decision is simple:

> The model is responsible for creative judgment. The system is responsible for safety, cost, evidence, and writes.

A language model can interpret a visual brief, select techniques, and compose layers. It should not silently mutate a live effect, invent renderer features, spend indefinitely, or claim visual success without inspecting a render.

## The workflow

```text
User brief + selected project references
  -> inspect current document and expected revision
  -> load relevant authoring / technique guidance
  -> form art direction and select inspected textures
  -> author one bounded, structured candidate document
  -> capture actual browser-rendered frames
  -> inspect evidence; make up to two focused candidate edits
  -> explicitly commit the selected candidate
```

Generated effects are candidate-first. A model response is never immediately treated as the live scene.

1. **Ground** — Eve reads the current revision, affected layers, renderer vocabulary, and project-owned reference pixels.
2. **Direct** — It identifies silhouette, palette, timing, motion, requirements, and exclusions. A still reference is not treated as proof of animation.
3. **Author** — Eve makes one bounded structured-output call that returns an `autov.lab/2` document. It cannot return executable code, URLs, or invented asset IDs.
4. **Render** — The browser produces timestamped capture/contact-sheet evidence for the proposed effect.
5. **Judge** — Eve inspects actual pixels against the original request. It can make at most two targeted candidate edits rather than repeatedly regenerating the scene.
6. **Commit** — The system applies only the selected candidate, at the expected revision, with its exact capture and inspection evidence.

## Division of labor

| Eve's creative judgment | Deterministic system controls |
| --- | --- |
| Intent, silhouette, palette, timing, motion, and hierarchy | Project ownership, authenticated session binding, and reference provenance |
| Relevant technique cards and construction methods | Strict document schema and known asset/texture ID allowlists |
| Texture treatment after pixels are inspected | Revision checks, atomic operations, and stale-write rejection |
| Layer composition and VFX parameter values | GPU draw, pipeline, and instance budgets |
| Visible strengths, defects, and tradeoffs | Provider reservations, capture proof, and explicit commit semantics |

The model operates inside a fixed renderer vocabulary. It cannot introduce custom shader code, arbitrary URLs, unsupported fields, or unregistered textures.

## How it stays efficient

### One bounded authoring call

The ordinary product path does not run an invisible paid planner, art director, texture chooser, critic, and repair chain for every request. Eve does the artistic decomposition in its tool-driven conversation, then passes one self-contained direction to a structured document-authoring call.

Earlier benchmark work tested more elaborate automatic loops. Repeated refinement did not reliably improve output enough to justify its cost for ordinary requests.

### Targeted repairs instead of regeneration

When an effect is mostly correct but has a local mismatch, Eve edits the uncommitted candidate and renders it again. Earlier candidates are retained, so a worse revision is never implicitly selected. Automatic correction is capped at two rounds.

### Minimal, scoped context

Only inputs that matter are sent to the model:

- User-selected reference-board images.
- Inspected library textures and registered generated effect masks.
- The current effect document only when preservation or refinement requires it.
- Relevant authoring and technique guidance, rather than every available technique.

Reference images are authenticated project assets. They are resized to a maximum 1280-pixel dimension, JPEG encoded, and cached in a 32 MiB process-local LRU for five minutes. Ownership is still checked on cache hits. Animated GIFs use their first frame.

### No automatic retry for an ambiguous paid call

Timeouts, disconnects, cancellations, and malformed provider responses can still be billable. Eve does not assume an unknown result was free and retry automatically. It replays stored known results; otherwise it fails closed and preserves the prior effect.

### Bounded chat execution

| Limit | Value |
| --- | --- |
| Reasoning effort | Medium |
| Default tools / connections / subagents | Disabled |
| Per-call output maximum | 4,096 tokens |
| Per-call deadline | 90 seconds |
| Session token-cost cap | $10 |
| Session aggregate output maximum | 100,000 tokens |

The generation path has an independent project-backed budget. Its default cumulative generation budget is $30, configurable only between $0 and $80.

## Cost accounting

Before a provider request, the service reserves a conservative estimated amount in durable project storage. After a successful response, the reservation settles using reported token usage.

- Known results are reused instead of paid for again.
- Unknown outcomes retain their reservation.
- Failure to record a failure does not make a call retryable.
- Restarting does not reset the ledger.
- Oversized inputs are rejected before provider dispatch.

The internal cost formula is a conservative guardrail, not a claim that the ledger exactly equals a provider invoice.

## Evidence before claims

> JSON is a plan. Pixels are proof.

A candidate must meet all of the following conditions before it can change the live effect:

1. It belongs to the authenticated project and current conversation.
2. It is tied to the expected document revision.
3. It has a completed, nonblank renderer capture.
4. Eve has inspected that exact capture reference.
5. The commit identifies the exact operation ID, capture ID, and inspected reference ID.

A successful API response does not establish visual quality. A capture does not by itself mean a scene was committed.

## Render-performance controls

Every candidate is checked against a v2 GPU budget:

| Resource | Budget |
| --- | --- |
| Draw calls | 120 |
| Distinct pipelines | 24 |
| Instances | 3,000 |

The generator can scale instance counts down where that preserves construction, but it does not silently drop layers. Effects that exceed the combined-scene budget are rejected.

The renderer is deterministic by design: `state = f(document, time, seed)`. There is no accumulated simulation state, so seeking to the same time should reproduce the same state.

## How Eve is evaluated

Eve is evaluated with four separate questions rather than one vanity metric.

### Does it work?

- Type checks, linting, and production builds.
- Agent tests for input validation, model bounds, cancellation, route ownership, references, and configuration failures.
- Browser/tool tests using stubbed providers and simulated capture evidence.

### Does it protect work and access?

- Expected-revision checks and stale-write rejection.
- Atomic edits and durable operation records.
- Project-scoped assets and authenticated server-side inspection.
- Supabase RLS tests for owner isolation, anonymous denial, cross-user denial, lease recovery, and cleanup.
- Cancellation, provider-failure, and capture-failure tests that verify the old effect remains intact.

### Does it render correctly and perform adequately?

- WebGPU capture and shader-fault checks.
- Blank-frame detection.
- Deterministic-seek checks.
- GPU-budget checks.
- Studio preview and performance verification.

### Is the rendered result visually better?

Candidate review checks:

1. Semantic match.
2. Motion.
3. Hierarchy.
4. Detail.
5. Smoothness.
6. Beauty.

The reviewer also looks for recurring visible defects: uniform particles, visible cards, washout, linear motion, simultaneous death, floating elements, effects that are too small in frame, aliased edges, and flat color.

Reviews compare the render with the original brief and reference evidence. They do not impose a generic “more explosions” aesthetic.

## Known limitations and next steps

The system does not claim automatic AAA-quality VFX art direction. Historical evaluations found that generated documents could be structurally sensible but still visually thin, poorly framed, or weakly timed. Bounded automatic refinement was not consistently improving results enough to warrant its cost.

That finding changed the product workflow: the product favors an inspectable first pass and explicit continuation instead of hidden repeated provider calls.

The next evaluation direction is renderer-response calibration: use deterministic renders and finite-difference measurements of a small set of visual controls—occupancy, luminance, edge density, timing, and particle magnitude—to move an effect toward a reference without additional language-model calls per correction. Proposed comparisons use equal render budgets, perceptual holdout metrics, blind pairwise human ranking, and paired bootstrap confidence intervals.

## Summary

Eve is not an unconstrained agent that “just keeps trying.” It is a creative collaborator operating inside a visible, revision-aware production loop:

- The model supplies creative interpretation.
- The renderer and schema make output concrete.
- Browser captures make claims inspectable.
- Transactional boundaries preserve user work.
- Reservations and bounded calls keep cost legible.
- Evaluation distinguishes validity, safety, performance, and visual quality.

Creative agency, with operational discipline.
