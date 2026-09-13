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

## 5. Heal spike → schema (Phase D, 2026-09-14)

The third hand-built spike (`frontend/dev-assets/vfx-v2/spike-heal.html`, source
`docs/vfx-lab/spike-heal-reference.js.txt`) proved the *travelling* half of the look: an element
that is somewhere ALONG a curve rather than simply present at a transform. Its five ribbon strands
were an analytic path evaluated in the vertex shader with a hand-written `path(u, strand)` function;
the port turns that function into **document paths** and a **`kind:"ribbon"` generator**, so the
document says which curve and which window, never how to sweep one.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| the `path(u, s, hs)` GLSL function's two branches (airborne sweep / settled ring) | `paths: [{id,type:"orbit",center,radius,height,turns,phase,wobble}]` ×2 | a document-level list, in DOCUMENT space; `paths-v2.ts` evaluates it on the CPU and `glslPath()` emits the identical GLSL, so framing, sorting and the draw can never disagree |
| `STRANDS`, `SEGS`, the `aW`/`aSide`/`aStrand` strip | `kind:"ribbon"` + `ribbon.strands.count` | the strip buffer carries no positions at all: every vertex is (w, side, strand) and the world position is swept from the live head, so nothing rebuilds as the head travels |
| `uHead`, `uTail`, the `u = uHead - (1-aW)*uTail` window | `ribbon.window.{head Curve, tail}` | the head curve's domain is the LAYER's own 0..1 progress; values past 1 keep circling a closed orbit (height 0, integer `frequency*turns`), which is what the spike's residual spin was |
| `uMix` blending `rA/yA` into `rG/yG` | `ribbon.morph.{pathId,curve}` | the sweep and the ring are ONE layer; two layers could not hand over without a visible cut |
| `strandW`, `(0.017+0.011*sin(aStrand*2.1))`, the `hs` hashes | `ribbon.{width,strands.widthJitter,strands.spread,strands.phaseJitter}` | `width` is the FULL width of one strand; the per-strand variation is hashed off the strand index |
| `tp = smoothstep(0,.30,aW)*smoothstep(1,.86,aW)` | `ribbon.taper.{head,tail}` | rejected when the two tapers consume the whole window |
| `mix(uEdge,uCore,core)*(core*1.5+halo*0.30)` | `material.ramp.space:"surface"` across the strip + `ribbon.core` | stop t=0 is the core and t=1 the edge, so one layer is the hot core AND the soft halo — the spike's "two passes" rule becomes one ramp |
| the ring fragment shader's 3 wobbling rim strands + detached arcs | `material.procedural:"swirlRing"` + `material.proceduralParams` [rim radius, strand half-width, wobble, rotation rate] | a flat-card pattern; `proceduralParams` is the generic vec4 every procedural may read |
| the ring's `fill` term (radial falloff × slow pulse × value noise) | `material.procedural:"ringFill"` + params [fill radius, pulse rate, noise amount, edge softness] | a second card under the rim |
| `ringMat.uniforms.uR` animated from 0.72 to 1.02 of `RING_R` | a track on `material.proceduralParams[0]` | the snap-out is a pattern parameter, not `transform.scale`: scaling the card would scale the noise with it |
| `CylinderGeometry(0.70, 0.78, 2.45, 48, 1, true)` | `kind:"beam"` + `geometry.type:"cylinder"` + `geometry.taper` | `taper` is the far end's radius as a fraction of the near end's; `rotation [-1.5708,0,0]` stands it up, `length` is its height |
| `vert = pow(1-h,1.35)`, `streak = vnoise(...)`, `rim = pow(1-|N·V|,2)` | `material.ramp.space:"surface"` ending at intensity 0 + `material.noise.uvPan` + `material.fresnel` + a late `material.erosion.curve` | the surface-space ramp key is perturbed by the noise, which IS the rising streak; the erosion only bites the top 40%, so the glow tears into streaks instead of ending at a cap |
| the crossed inner billboards and the haze quad | dropped | one tube plus the erosion streaks carries the read at this scale; three coincident additive sheets were a spike convenience |
| `0.45 + 0.55*pow(abs(sin(uTime*4.5 + s*3.7)),1.5)` | `emitter.render.twinkle.{frequency,depth}` | per-instance phase hashed off the instance, so no two sparkles blink together |
| the 4-point star SDF in the sparkle fragment shader | `material.procedural:"star4"` | already in the vocabulary from the smoke port |
| `ground.uniforms.uTintI` / the bounce quad | a `softRadial` decal plus one point light | the environment's own ground already takes light |

Nothing in the spike's *numbers* was promoted: the palette, the 0.28–1.23 s wrap, the 1.2 s ring
cue and every envelope live in `fixtures/v2/healing-aura/document.json`.

## 6. Glitch spike → schema (Phase D, 2026-09-14)

The fourth spike (`frontend/dev-assets/vfx-v2/spike-glitch.html`, source
`docs/vfx-lab/spike-glitch-reference.js.txt`) proved the *discrete* half: an effect whose motion and
colour break in stepped windows rather than easing. Its trail was 156 instances each carrying a
baked `aU` and `aBirth` computed from the inverse of the head easing; the port keeps the idea and
drops the table — the inverse is evaluated in closed form from the instance index.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| `A`, `C`, `B` and the `bez()` / `bezT()` GLSL pair | `paths: [{id,type:"bezier",from,control,to}]` | one path shared by the head, the trail and the hairlines, so they cannot drift apart |
| `headU(t)` + `invSS(y)` + the per-instance `aU`/`aBirth` buffers | `emitter.shape.type:"path"` + `emitter.spawn.mode:"pathAnchored"` + `spawn.headCurve` | instance i owns u = i/(count-1) and is born when the head curve passes it; the curve's inverse is closed form (`invertCurve` / `glslCurveInverse`), so no birth table is stored |
| `p += side*(h3-.5)*0.22 + upn*(h4-.5)*0.17` | `emitter.shape.radius` on a `path` shape | scatter across the path frame, so the row reads as a dotted band rather than beads on a string |
| `rot = atan(tv.y, tv.x)` off the projected tangent | `emitter.render.mode:"pathAligned"` (+ `render.stretch`) | a path-anchored dash has no velocity of its own to align to |
| `fl = step(0.30, hash11(floor(uTime*12)*2.7 + s*13.1))` | `emitter.render.twinkle` | the same field the heal sparkles use |
| the hairline strip (`HAIR`, `HSEG`, `uHead`/`uTail`) | `kind:"ribbon"` on the same path | identical vocabulary to the heal sweep; only the numbers differ |
| `if (flying && hash11(stw*1.7+0.3) > 0.85) _p += (hash11(...)-0.5)*j` | `layer.jitter.{frequency,amplitude,gate,axis}` | works on ANY kind, applied to the layer transform in `evaluateLayerV2`, closed form from `floor(age*frequency)`; the dart and its core share one spec so they break together |
| `buildWire()`'s 20 polygon outlines + 14 spokes, and the `uE` travel/scale in `wireMat` | `kind:"wireBurst"` + `wireBurst.{shapes,sides,radius,travel,scale,spokes,seed}` | a generator: every plane, vertex radius, spin and travel share is hashed out of (seed, index); the travel and the scale envelope are applied in the vertex shader from layer time |
| the shard shader's `ch` channel loop and `off = (ch-1)*0.035*(0.5+u)` | `material.rgbSplit.{offset,growth}` | three per-channel draws pushed apart in clip space; the copies sum back to the original at offset 0. Mesh kinds and `wireBurst` only — one instanced particle draw cannot be tripled without tripling the budget, so the shards use magenta/cyan ramp stops instead |
| the `glitchPass` ShaderPass (band displacement + RGB split + block dropout on `hash(floor(t*20))`) | `post.glitch.{curve,bands,blockGrid,split,edgeBias}` | `curve` is the strength over the document's own 0..1 progress; the pass is disabled outright at zero strength |
| the dome shell, the wire cage box and the raised puffs | dropped / folded in | the dome and the cage were spike dressing; the puffs are an ordinary masked `particles` plume |
| `chargeMat`'s `c = PA + dir*r0*(1-a)^2` | an ordinary particles layer with NEGATIVE radial speed | already in the vocabulary (`converging-charge`) |
| the grey target marker sphere | dropped | a document describes the effect, never the scene it lands on |

Numbers live in `fixtures/v2/glitch-projectile/document.json`.

### One renderer correction the ports forced

`material.procedural:"none"` is the soft-disc **sprite** silhouette, so on a real surface — a tube, a
bar — it reads as a blob in the middle of the UV space rather than as the whole surface. Every mesh
that should be fully covered needs `"solid"`. That is now stated in the vocabulary and in the
`upright-glow-cylinder` technique card; it cost a round of look-dev to find.
