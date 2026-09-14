# Effect paths (first renderer milestone)

Paths are optional. Legacy documents retain their existing renderer branch. The
`curved-beam` fixture is an isolated demonstration; canonical fixtures are untouched.

## Contract

`document.paths` contains `{ id, points }` records. A path has one initial point,
then three points per cubic Bézier segment: outgoing handle, incoming handle,
endpoint. Coordinates are meters in the effect reference frame, not world space.

A layer opts in with `path: { pathId, mode, range, offset, roll }`:

- `range`: increasing normalized distances, e.g. `[0, 1]`.
- `offset`: lateral offsets on the transported normal and binormal, in meters.
- `roll`: cross-section rotation in radians.
- `shape`: beam/trail/ribbon geometry swept along the selected path.
- `emit`: particles born on the path, then freely moving along their launch direction.
- `follow`: particles advance along the path by integrated speed.

Point emitters spawn at the range start; line emitters distribute along its length.
Emission shape length is replaced by the selected path range. Velocity directions
are interpreted in the path frame at birth. Follow mode requires directional +Z.
Gravity and wind remain layer-local offsets after path motion; they are not bent.
Follow particles extrapolate past endpoints rather than accumulating there.

The path adapter converts reference coordinates through the authored frame and
inverse rigid layer transform. The existing global effect placement then applies
normally. Attached layers currently require static rigid transforms. Cross-section
size still follows the existing geometry radius/thickness and tracks. Animated
geometry length scales traversal relative to its base value, preserving growth and
retraction timing. For path ribbons, geometry length no longer specifies an arc angle.

## Implementation boundaries

- `effect-path.ts`: schema, arc-length table, parallel-transport frames, CPU sampling.
- `effect-path-adapter.ts`: coordinate conversion, binding data, particle-position adapter.
- `effect-path-glsl.ts`: GPU lookup of the same table; no separate curve math.
- `effect-path-validation.ts`: supported renderer combinations and clear rejection.
- `runtime-v2.ts`: narrow integration at materials, trajectories, and framing.
- `shaders-v2.ts`: authored shader source. Run `npm run generate:v2-nodes` after edits.

Sampling uses a bounded 65-frame table from denser cubic samples. It is an
approximation, not an analytic constant-speed solver. Fully collapsed paths and
sharp reversing cusps are rejected. Wide ribbons can self-intersect on tight bends;
no collision or automatic width reduction is performed.

Particle trails and stretched sprites evaluate the path trajectory. Sub-emitters,
curl/vortex/floor forces and animated layer transforms remain unsupported.
Unsupported path attachments are rejected rather than rendered inconsistently.

## Acceptance and next step

Focused checks: `node --import tsx --test tests/effect-path.test.ts` and
`node scripts/webgpu/verify-path-bindings.mjs` (offline WGSL binding-budget check).
Path frames are interleaved into one uniform buffer so particle trails remain
within WebGPU's default per-stage binding budget.
The copied beam has shape, emit, follow, and trail layers with original beam timing.
GPU visual acceptance is still pending due browser WebGPU startup/device-loss errors.
Do not describe the curved rendering as visually verified yet.

After visual acceptance: add a slash demonstration and integrate control-point
handles in the editor. The document representation is
already editable, but no new on-canvas path editing UI is provided in this milestone.

## Directional fire and lightning

`curved-fire` uses the analytic fire shell with the original taper, temporal noise,
lobes, and material. The shell's local frame follows the sampled path; its lift
bias is interpreted in that frame. Dedicated conservative bounds include radial,
axial and lift displacement. Particle flame layers follow the path, while smoke
and embers emit from it and move freely. The demo deliberately removes unsupported
curl and floor settings; it does not claim to preserve those forces.

`curved-lightning` retains deterministic strike hashing, jitter and branch topology
from the existing bolt generator. A CPU geometry adapter maps its longitudinal
domain onto the sampled path, then recomputes normals. The shader does not deform
it a second time. The reference origin is the impact endpoint and +Z extends away
from impact along the bolt; strike travel is toward the origin. Its bounds come
from the same generated geometry at sampled times, including branches.

The existing non-directional contact flashes, ground rings and debris in the
lightning example remain at the impact point; they are not curve-deformed.
Canonical fixtures are unchanged. On-canvas curve handles remain outside this scope.

## Apply-based curve editing

Enable **Show curve guides**, then click an endpoint/control marker or choose a
point in the curve-point selector. Each option includes the path ID, so documents
with several paths remain unambiguous. Move arrows edit draft points and guide
buffers only. **Apply curve** validates the draft and installs one document update;
**Undo curve** restores the prior applied document. Multiple drags before Apply
remain a single undo entry. External document replacement clears this local history.

**Cancel**, Escape, hiding the guides, or document replacement discards the draft
and detaches the gizmo. Whole-effect placement controls are suspended while a
curve point is selected. Orbit is disabled only while the move gizmo is dragging.
Curve coordinates use the inverse of viewer placement only, because path points
already belong to the reference frame. No authored-frame inverse is applied again.
The ordinary document installation preserves camera, placement and playback time.

No point insertion/deletion or linked handles are included. Scene/model checks
are separate from GPU visual acceptance; isolated browser interaction checks do
not prove the rendered WebGPU gizmo appearance.

## Generation integration

The local studio generation pipeline requests v2 structured JSON through
`/api/local-vfx`. Its model wire contract requires `paths` (use an empty array
for radial effects) and nullable `layer.path`. Runtime decoding removes null
attachments and validates connected segments, references and supported modes.

Candidate generation and its repair use dedicated generation examples for
beam, slash, directional fire and lightning. They do not replace the canonical
fixtures. The technical guide prefers shared editable paths for these families,
including straight effects, and documents unsupported force/transform combinations.
Structural refinement uses the same wire contract and is instructed to preserve
paths during unrelated edits. The selected full document reaches the studio
without projecting away paths, exposing it through Show curve guides and Apply.

The separate Eve conversation agent still has no studio mutation tools; this
change integrates the existing local generation flow, not deployment of new tools.
Verification: `node --import tsx --test tests/path-generation.test.ts tests/schema-v2.test.ts`.
