# Eve VFX integration

The integrated Studio uses Eve's model/tool loop for artistic decisions. Renderer
capabilities from `feature/vfx-technique-cards` and authoring infrastructure from
`better-Agent-pipeline` are retained.

## Studio workflow

1. Eve loads `vfx-authoring`, reads the scene, and inspects reference pixels.
2. Eve establishes explicit direction before selecting exemplar guidance.
3. A `vfx-techniques-*` static skill supplies family-specific construction methods
   from the canonical TypeScript technique cards. All 15 families are available
   without a sandbox or filesystem access.
4. Eve inspects library textures, or calls `generate_effect_texture` for a bounded
   static alpha mask, then inspects its board reference.
5. `generate_vfx` accepts direction, texture bindings and technique IDs. One
   budgeted structured-model call authors the complete document. The service
   validates it, reduces generated counts when needed, checks the combined GPU
   budget, and captures it without committing.
6. Eve inspects the captured reference and loads `vfx-review`. Targeted
   `edit_vfx_candidate` calls create independently captured alternatives.
7. `commit_vfx_candidate` selects one capture. It verifies project/session
   ownership, capture provenance, completed nonblank rendering, a recorded pixel
   inspection, and the revision before committing.
8. A user-approved Continue permits one `refine_vfx` authoring call against the
   original direction and Eve's findings. The result requires inspection and an
   explicit candidate commit as above.

The local benchmark remains exemplar-anchored for comparison. Its older
multi-stage regression harness lives in `legacy-generation.ts`; active Eve tools
do not call it. `generation.ts` contains provider accounting and context loading.

## Preserved constraints

- Explicit intent and host constraints override exemplar defaults. Studio does
  not replace the authored camera with the exemplar camera.
- Add mode preserves original layers/global settings, allocates collision-free
  layer and path IDs, and remaps path/source/parent references.
- Candidate edits cannot modify add-mode original layers or globals.
- Project generation/image calls share the existing reservation ledger (default
  $30, configurable ceiling $80). Unknown provider outcomes retain reservations.
- Eve reasoning uses its native session accounting: $10 token-cost window and
  100,000 output-token window. These are separate from the project tool ledger;
  they are not advertised as one atomic combined budget. The configured Gateway
  supplies model cost; Eve checks reported usage before the next model call.
- Cancellation and revision-checked commits use existing trusted transitions.
  No database migration or broader agent filesystem permissions are required.

## Renderer reconciliation

All new layer kinds are retained: blob, splash, ribbon, wireBurst, crystals, arcs,
streakBurst, reflection, sheets, crescent and licks. Curve formulas and advanced
curve controls coexist with these layers. Mesh flipbooks and depth fading work
on the six conventional mesh kinds. `litSmoke` supports particles and those mesh
kinds; blob/sheet cel shading remains `material.toon`.

Smoke point-light uniforms share one buffer to stay within WebGPU's 12 fragment
uniform-buffer limit. Node shaders are regenerated from merged GLSL source.
Verification scripts await asynchronous renderer disposal.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:agent`,
`npm run verify:studio`, and `npm run verify:perf` from `frontend`.
Additional mechanism checks are `scripts/webgpu/verify-flipbooks.mjs`,
`verify-smoke-lighting.mjs`, `verify-capture-memory.mjs`, and
`scripts/verify-iteration-offer.mjs`.

Linux software rendering uses `AUTOV_WEBGPU_SOFTWARE=1 xvfb-run -a` before the
command. Software rendering verifies correctness, not the hardware frame-time
contract. Run `verify:perf` on the intended hardware before release.

`evals/vfx-skills.eval.ts` checks native skill discovery and avoids mutations
for explanation-only requests. A live end-to-end generation evaluation requires
a configured Gateway, authenticated project, provider budget and open Studio.

Integration checks: 528 unit tests passed, one skipped; standalone typecheck,
lint (six warnings, no errors), Eve build and the full production build passed.
All 18 studio previews passed software WebGPU validation with no console errors,
nonblank output and vertex-buffer counts within device limits. Focused checks
also passed for flipbook/depth behavior, smoke lighting,
capture cleanup/determinism, and the Continue UI. The production build retains
an existing dynamic-filesystem tracing warning in `reference-video-node.ts`.
Live paid generation and target-hardware performance remain release checks.
