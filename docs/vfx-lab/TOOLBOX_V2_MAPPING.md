# Toolbox v2 — what the fire spike proved, and how it maps to schema v2

Date: 2026-09-13. Source of truth for the Phase A port. The hand-built spike lives at
`frontend/dev-assets/vfx-v2/spike.html`; its source (round 4, the accepted look) is `docs/vfx-lab/spike-reference.js.txt` (open `/dev/vfx-v2/spike` with `npm run dev`).

The spike was built without the LLM to prove that the v2 renderer can reach a stylized-AAA
look. Everything below is the line between "generic capability that becomes vocabulary"
and "fire-specific tuning that stays in the exemplar (or is dropped)".

## 1. Generic → becomes schema v2 vocabulary (port as-is)

| Spike knob (makeParticles cfg) | Schema v2 field | Notes |
|---|---|---|
| `count`, `period`, `spawnWindow` | `emitter.count`, `emitter.spawn.{mode,rate,duration,window}` | spike = continuous looping emitter; `period = count/rate` |
| `origin`, `axis`, `spawnLength`, `spawnRadius` | `emitter.shape` (`line` along `axis` × `spawnLength` + `sphere` radius) | `line`+`sphere` composite = shape `line` with `radius` |
| `dir`, `spread`, `speed[min,max]` | `emitter.velocity.{mode:"cone", direction, spread→angle, speed}` | |
| `gravity`, `drag`, `wind` | `emitter.forces.{gravity, drag, wind}` | |
| `curl`, `curlFreq`, `curlSpeed` | `emitter.forces.curl.{strength, frequency, speed, envelope}` | envelope = smoothstep(0,.25,u) in spike → default Curve |
| `size[min,max]`, `sizeCurve`, `alphaCurve` | `emitter.render.{size, sizeCurve, alphaCurve}` | |
| `align`, `stretch` | `emitter.render.{mode:"velocityStretch", stretch}` | orientation fix: `across = (along.y, -along.x)` (winding!) |
| `randomRot`, `rotSpeed` | `emitter.render.rotation.{initial:[0,2π] or [0,0], speed}` | |
| `mask`, `atlas`, `tilesUsed`, `skipTile` | `material.mask.{textureId, atlas:{cols,rows,tiles}}` | atlas replaces v1 "one texture per layer" |
| `noise`, `noiseScale`, `noisePan`, `distort` | `material.noise.{textureId, uvScale, uvPan, distortion}` | procedural fallback when `textureId:null` |
| `erosionCurve`, `erodeSoft`, `edgeWidth`, `edgeColor`, `edgeIntensity` | `material.erosion.{curve, softness, edgeWidth, edgeColor, edgeIntensity}` | |
| `ramp` (2–6 stops, HDR intensity) | `material.ramp.{space:"life", stops}` | |
| `blend` (additive / alpha / premul) | `material.blend` | premul = `premultiplied` |
| `soft` | `material.softParticle` | needs depth pre-pass of opaque layers |
| `opacity` | `material.opacity` | |
| `order` | runtime: per-frame sort by view depth; `renderOrder` only as tie-break | do **not** expose `order` to the model |
| shell mesh (teardrop + vertex noise + erosion + ramp by `along`) | `kind:"shell"`, `geometry.{type:"teardrop", segments, vertexNoise}`, `material.ramp.space:"surface"` (ramp keyed by position along the mesh axis) | `space:"surface"` is a **new** ramp space (v1 had none) |
| ground plane + grid + point light + decal + fog | `environment.{ground, groundColor, fog}`, `kind:"light"` layer, `kind:"decal"` layer | |
| MSAA×4 + SMAA, HalfFloat, bloom(threshold), vignette, chromatic | `quality.aa`, `post.{bloom, vignette, chromatic}` | |
| depth pre-pass for soft particles | runtime internal | opaque = ground + `material.blend:"alpha"` meshes with `depthWrite` |

Color management: `new THREE.Color("#hex")` already converts sRGB→linear. Never call
`convertSRGBToLinear()` on top of it (the spike's first renders were wrong because of this).

## 2. Fire-specific hacks → promote (generic form) or drop

| Spike hack | Decision | Generic form |
|---|---|---|
| `upBias` (mirror spawn sphere to +y) | promote | `emitter.shape.bias: vec3` (0..1 per axis; mirrors samples toward +axis) |
| `frontFade` (particles born near spawn start are faint) | promote | `emitter.render.alphaAlongSpawn: Curve` (alpha vs. position along the spawn line) |
| `minY` soft floor | promote | `emitter.forces.floor: { y, softness } \| null` |
| mesh "lobes" only on upper rear (`up` gate hard-coded) | promote, generalized | `geometry.vertexNoise.{amplitude, frequency, speed, bias: vec3, alongCurve: Curve}` — bias picks the side, alongCurve picks where along the axis |
| lobes protected from erosion (`th -= lobe*.7`) | promote | `material.erosion.displacementProtect: 0..1` (high displacement → less erosion) |
| silhouette-only erosion (`th += rim * k`) | promote | `material.erosion.rimBias: 0..1` (erode more at grazing angles) |
| lobes forced hot (`heat -= lobe*.45`) | promote | `material.ramp.displacementShift: -1..1` (displacement shifts the ramp key) |
| hard-coded tail direction `TAIL`, head position `HEAD` | drop | these are `transform` + `emitter.shape.axis`; the exemplar carries the numbers |
| atlas tile skipping (`skipTile`) | drop | build atlases without unwanted tiles instead |
| ACES making the hot head desaturate | keep ACES | exemplar uses lower head intensity (≈1.0–1.2) and lets bloom carry the "hot" |

Anything not in either table is a number, and numbers belong to the exemplar
(`fixtures/v2/fire-projectile/document.json`), not to the renderer.

## 3. Non-negotiables carried over from v1

- `state = f(document, time, seed)`. No accumulation. Seek == play. Continuous emitters loop with
  `age = mod(t - birth, period)` and are still closed-form.
- The model fills the schema; it never writes GLSL/JS.
- Time-windowed overrides keep out-of-window invariance (`tests/refine.test.ts` must keep passing).
- Schema stays engine-independent (no Three.js constants in documents).

## 4. Smoke spike → schema (Phase C, 2026-09-14)

The second hand-built spike (`frontend/dev-assets/vfx-v2/spike-smoke.html`, source
`docs/vfx-lab/spike-smoke-reference.js.txt`) proved the *cel-shaded* half of the look: a
silhouette made of round primitives rather than of alpha cards. Its ~60 lobes were a hand-written
table, which is exactly what the model must never author, so the port turns the table into a
**generator**: the document describes a cluster and the renderer hashes each lobe out of
`(blob.seed, index)`.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| `addLobe({t0, life, R0, base, drift, rise, g, k, ...})` × 60 | `kind:"blob"` + `layer.blob` | a generator, never a lobe list: `blobLobes()` in `blob-v2.ts` derives every lobe from `(seed, index)` |
| `MOUND` / `COL` / `COL2` / `PINK` / `WISP` tables | `blob.arrangement` `mound`\|`column`\|`ring`\|`string` | mound = a half-egg base cluster; column = paired lobes per level plus a smoother filler behind each pair; ring = two tiers of billows with the centre left open; string = a swaying chain of wisps |
| per-lobe `R0` | `blob.radius [min,max]` | clusters hash inside the band, stacks taper `max → min` up the stack |
| `base[0..2]`, the x/y spacing inside each table | `blob.spread`, `blob.height` | lateral and vertical extent of the cluster at birth |
| `rise`, `g`, `drift`, `k` | `blob.rise`, `blob.gravity`, `blob.drift`, `blob.grow` | the spike's equations verbatim: `y = base + rise·a − g·a²/2`, `x += drift·√a`, `r = R0·easeOutCubic(min(a·grow,1))·(1 − smoothstep(.7,1,a))` |
| staggered `t0` per table entry | `blob.stagger [from,to]` | fractions of the LAYER window, ordered by index for clusters and by height for stacks |
| `life` per entry | `blob.life [min,max]` | hashed inside the band; stacks shorten toward the top |
| `squash`, `amp`, `freq`, `uSpeed` | `blob.squash`, `blob.bump.{amplitude,frequency,speed}` | the radius-space fbm that makes the cauliflower bumps |
| `comma(i, x, y, curlMin, curlMax, taper)` | `blob.comma.{curl,taper}` \| null | the sign of the bend and the tail's heading are derived per lobe from its own base position, so a ring of commas fans outward without the document saying so |
| `sway` on the wisps | folded into `arrangement:"string"` | amplitude scales with `blob.spread`; not a separate field |
| `PAL[family].{shadow,body,high,rim}` + `uBands`/`uLight`/`uRimPow`/`uRimAmt` | `material.toon{bands,thresholds,shadow,body,highlight,light,rim}` \| null | half-lambert against a FIXED world light, posterised; replaces the ramp as the colour source (the ramp still keys erosion and alpha) |
| the `BackSide` + `uFlat` + `uInflate` second mesh | `material.outline{width,color}` \| null | inverted hull, same vertex program so it tracks every bump; `width` is world metres, divided by the live lobe radius in the shader |
| `L.mat.transparent = a > .75; depthWrite = !tr` | `material.opaqueUntil` (0..1) \| null | opaque + depth-writing until then, alpha to 0 by the end; `null` = the old always-transparent behaviour. Opaque lobes stay visible through the soft-particle depth pre-pass (`LayerObject.occluder`) |
| `SPLASH[]` + `sliverGeo(len,width,curve,taper,h)` + the `dark` copy at 1.14× | `kind:"splash"` + `layer.splash{count,seed,length,width,curvature,jaggedness,spread,color,backing,scaleIn,detach,fade}` | a generated fan; the two slivers of a pair share their shape hashes so the fan is mirrored and the auto-framing stays centred |
| the `glint` quad's 4-spike + core + halo shader | `material.procedural:"star4"` | a billboard silhouette (modes < 4 family), no atlas |
| the `softGlow` / `groundGlow` radial quads | `material.procedural:"softRadial"` | same |
| `lobeFrag`'s per-lobe colour by family | `material.ramp.space:"height"` + `ramp.heightSpan` | the generic form: key the ramp on world metres above `environment.groundY`. Works on every mesh kind and on particles |
| the fixed camera at (0, 2.55, 10.5) | auto-framing | `blobBounds()` claims the cluster's own volume plus a fifth of its `rise`, so a column that leaves the top of the frame does not drag the camera to the horizon |

Fire-specific → smoke-specific counterpart: nothing in the spike's *numbers* was promoted. The
palette, the 13-level column, the two-tier pink crown and every time in the schedule live in the
exemplar (`fixtures/v2/smoke-burst/document.json`), not in the renderer.

Deliberately not ported: the spike's gradient backdrop quad (the environment's `background` covers
it), `params.bands3`/`params.outline`/`params.splash` (debug toggles, not vocabulary), and the
per-lobe `outlineW` override (one `outline.width` per layer; the spike used it only to thicken the
column's filler lobes).
