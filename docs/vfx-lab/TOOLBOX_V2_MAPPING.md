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
