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

## 7. Ice spike → schema (Phase E, 2026-09-14)

The fifth hand-built spike (`frontend/dev-assets/vfx-v2/spike-ice.html`, source
`docs/vfx-lab/spike-ice-reference.js.txt`) proved the *solid* half of the look: an element made of
real intersecting geometry rather than of cards or lobes. Its 320 crystals were an instanced draw
whose per-instance direction, length, width and start time were computed into six attribute
buffers, which is exactly the table the model must never author — so the port turns the buffers
into a **generator** and the document describes the cluster.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| `crystalGeometry()`'s 4-ring hex prism + apex, non-indexed | built in, `crystals-v2.ts` | one unit mesh shared by every instance; non-indexed so `computeVertexNormals` leaves every face flat, which is the whole faceted read |
| the `aDir`/`aOrg`/`aLen`/`aWid`/`aT0`/`aSeed` buffers, filled by the `for (i < N_CRY)` loop | `kind:"crystals"` + `layer.crystals` | a generator, never a spike list: `crystalInstances()` hashes all six out of `(crystals.seed, index)` |
| `g5 = i % 5`, `grp = g5 <= 0 ? 0 : g5 <= 2 ? 1 : 2` | `crystals.groups` | a cycle of `2*groups-1` gives the long class one slot and every other class two — the spike's 1 : 2 : 2 ratio at `groups: 3` |
| `sMin` per group, `sinEl = sMin + (.99 - sMin) * pow(hb, …)` | `crystals.direction.{elevation,upBias}` | `elevation` is the band in degrees; only the SHORTEST group reaches its bottom, so long spikes stay above the horizon and short ones stab downward. `upBias` is the hash exponent, strongest on the long class |
| the three per-group `len` expressions (`.60+.42h^.6`, `.30+.32h`, `.12+.24h²`) | `crystals.length [min,max]` | the classes carve overlapping sub-bands out of the one band, longest first, with a per-class hash exponent |
| `aWid[i] = (.044\|.052\|.062) * (.68 + .64*hd)` | `crystals.width [min,max]` | short classes skew fat; the hash spreads the band either way |
| `br = (.10 + .30h) * (1.45\|1.1\|.8)` and `aOrg = dir*br` | `crystals.baseRadius` | the bases sit off centre along their own direction, so the cluster has a core rather than a single point. The spike's `+0.22` lift is `transform.position.y` |
| `aT0 = T_FLASH + grp*.13 + .17h` | `crystals.stagger [startFrac,endFrac]` | fractions of the LAYER window, ordered by class then hashed |
| `u = age/.30`, `s = u*u*((k+1)*u - k)`, `k = 1.70158` | `crystals.growth.{duration,overshoot}` | easeOutBack, verbatim |
| `s *= 1 - smoothstep(sh, sh+.16, t)` with `sh = uShatter + aSeed*.18` | `crystals.collapse.{start,duration}` | `start` is a fraction of the layer; the per-instance jitter is `seed * duration * 1.125` |
| `s *= 1 + uSwell*.035*sin(uTime*2.1 + …)` | renderer constant | a 3.5% breath during the hold; a number that describes the mesh, not the effect |
| `pale`/`cyan`, the `tip` mix, `col *= mix(1,.55,tip)` | `crystals.{faceColor,tipColor}` | the tip is darkened as it saturates so ACES does not wash it back to white |
| `mix(col, vec3(.95,.99,1), fres*.30*(1-tip*.55))` and the glint colour | `crystals.edgeColor` + `crystals.fresnelPower` | |
| `gb = sin((vAlong*3.4 - uTime*1.15 + vSeed*6.28)*PI)`, `pow(max(gb,0),22)` | `crystals.glint.{frequency,speed}` | |
| the `outlineMat` BackSide copy with the same `CRY_VERT` and a `+0.007+0.005*s` push | `material.outline.{width,color}` | already in the vocabulary from the smoke port; the crystal hull runs the identical vertex program, so it tracks the facets |
| `cryMat.depthWrite = true` | implicit for `material.blend:"alpha"` | overlapping spikes intersect for real, and the layer is an `occluder` for the soft-particle depth pre-pass |
| the sigil fragment shader (rings, 64-cell rune band, 16 spokes, filigree, two-layer polar mist, gold rim) | `material.procedural:"sigil"` + `proceduralParams` [ring pairs, rune cells, spokes, gold rim] | one flat-card pattern; the gold rim is a track on `proceduralParams[3]`, not a second layer |
| `uRev` animated 0 → 1.06 over 0–1.2 s, `rev = smoothstep(0,.10,uRev-r)` plus the `edge` band | `material.reveal.{mode:"radial",from,to,frontWidth}` | the front travels over the LAYER's own 0..1 progress, and `to` may run past 1 — which is how a reveal finishes early inside a layer that keeps holding |
| `chipGeometry`'s `j = i % N_CRY`, `org = aOrg[j] + dir[j]*aLen[j]*u`, `vel = dir[j]*1.05 + jitter` | `emitter.shape.type:"layerInstances"` + `shape.sourceLayerId` | the sites come from the SOURCE layer's own generator hash, so they are closed form and independent of draw order; `velocity.mode:"radial"` throws each chip along its own spike's axis |
| `dr = 1 - exp(-age*2.2)`, `p.xz = aOrg.xz + aVel.xz*dr/2.2` | `emitter.forces.planarDrag` | drag in XZ only: horizontal travel settles onto an asymptote while the vertical stays ballistic, so the burst becomes a drifting disc instead of debris leaving the frame |
| `mistMaterial(seed, speed)` ×2, the swirl rotation and the `fbm` pair | two `decal` layers, `material.procedural:"smoke"` + `material.noise.{uvPan,distortionPan}` + `material.erosion` | the two-layer-noise-mist card, with the pans running opposite ways |
| the frost ring's orbiting, tangentially stretched chips | an ordinary `particles` layer, `shape "ring"` + `velocity.mode "tangential"` + `render.mode "velocityStretch"` | already in the vocabulary |
| the `charge` sparkles' `c = dir*r0*(1-a)²` | a `disc` emitter with NEGATIVE radial speed | already in the vocabulary (`converging-charge`) |
| `ground.uniforms.uTint` / the `glowMat` disc | `environment.ground:"plane"` plus a `softRadial` decal and one point light | |
| `flashMat`'s expanding ring | `material.procedural:"ringFill"` with a tracked `proceduralParams[0]` | |

One renderer correction the port forced: `spawnBoundsV2` claimed a full CUBE for a `ring` and a
`disc` emitter, including along its own axis. A flat frost ring of radius 1.55 therefore asked the
camera for three metres of headroom it never used, and the auto-framing pulled back until the
cluster filled a third of the frame. Both shapes now claim nothing along `shape.axis`.

Numbers live in `fixtures/v2/ice-blast/document.json`.

## 8. Hex shield → schema (Phase E, 2026-09-14)

The sixth spike (`frontend/dev-assets/vfx-v2/spike-shield.html`, source
`docs/vfx-lab/spike-shield-reference.js.txt`) proved that a *cell* can be a first-class thing: the
shield's hexagons are not a texture and not a mesh, they are the Voronoi regions of a relaxed point
set looked up per pixel. The port keeps that construction exactly and moves the point set into the
renderer, because it is the one piece a document must never carry.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| the `fib()` set, 14 Lloyd iterations against 4200 probes, the `site.sort(y)` and `ptsTex` | `material.lattice.cells` (+ `document.seed`) | `lattice-v2.ts` generates and relaxes the sites, caches them by `(cells, seed)` and hands the shader one float texture. Sorting by latitude is what lets `cellLookup` scan a band of indices instead of all of them |
| `CELL_A = sqrt(4.836 / NPTS)` and `edge = (d2-d1)/uA` | built in | `edgeWidth`/`gapWidth` are fractions of a cell's circumradius, so the wall weight does not change with the cell count |
| `gap`/`line`/`fill` smoothsteps at .08/.20/.34/.22/.40 | `lattice.{gapWidth,edgeWidth}` | the three weights are derived from the two fields |
| `tileC` mint / `edgeC` pale gold | `lattice.{tileColor,edgeColor}` | the spike's values are LINEAR; the document carries their sRGB hexes |
| `pulse = .5+.5*sin(uTime*2.1 - (1-c1.y)*2.6 + hc*6.2831)` | `lattice.pulse.{speed,phaseJitter}` | an outward pulse from the crown on a hashed per-cell phase |
| `off = 1 - smoothstep(hc*.95, hc*.95+.22, uDis)`, `uDis = max(0, t - T_FADE)` | `lattice.dissolve.{start,stagger,softness}` | in the LAYER's own 0..1 progress, so the shell comes apart cell by cell instead of dimming |
| `graze = smoothstep(.03, .30, ndv)` and the `vis` expression | `lattice.grazeFade` | at grazing angles the cells compress below a pixel; they fade and the fresnel rim carries the edge |
| `on = smoothstep(uReveal-.03, uReveal+.05, c1.y)` + the `front` band, `uReveal` 1.25 → -1.25 | `material.reveal.{mode:"scan",from,to,frontWidth}` | the front keys on the CELL, so a cell arrives whole; `from`/`to` run outside 0..1 so the scan finishes at 0.92 s of a 5 s layer |
| `ig = smoothstep(.42, 0, vW.y - uFloor)` and the `vec3(.34,.95,.86)*ig` term | `material.planeGlow.{plane,distance,color,intensity}` | analytic proximity to the ground plane — no depth texture, so it cannot flicker. This closes the `hex-lattice-fresnel-shield` card's "depth-intersection glow" backlog entry |
| `uRip[2]`, `gc = acos(dot(N, uRip.xyz))`, the `k*2.3*(1-.35k)` radius and the `smoothstep(2.4,.25,…)` amplitude | `material.ripples[{time,origin,speed,width,decay}]` | up to four expanding great circles, each closed form in layer time; a null origin is hashed off the document seed |
| `fres = pow(1-ndv, 9) * 1.45` against `rimC` | `material.fresnel` + the ramp's last stop | the rim is exempt from the usual `smoothstep(0,.4,vAlong)` gate on a lattice layer, because it is exactly what carries the silhouette where the cells fade |
| `IcosahedronGeometry(R, 6)` at `y = CY`, `scale = .22 + .78*easeOutBack` | a real unit sphere + three `transform.scale` tracks | a `material.lattice` layer IS its sphere: `geometry.radius` scales it and the analytic teardrop is bypassed |
| `SphereGeometry(R*1.017, 160, 6, 0, 2π, π/2 - dθ/2, dθ)`, `band.rotation.z = TILT`, `bandPivot.rotation.y = phi` | `geometry.type:"band"` + `geometry.band.{tilt,spin,stripes}` | real geometry with depth write under `material.blend:"alpha"`, so the far arc sorts BEHIND the shell instead of glowing through it; `spin` adds to `transform.rotation[1]` |
| the band fragment's three stripes across the ribbon and `.90+.10*sin(s*46 - t*2)` along it | `material.ramp.space:"surface"` (across the strip) + `band.stripes` | five ramp stops give the deep/pale/bright/pale/deep section in one material |
| the wider additive `halo` shell | a second `band` layer, additive, 2× the width | the bloom source |
| the `sparks` Points cloud: `dst` on the lower shell, `src` outside and above, `e = a*a` | a `particles` layer, sphere `surfaceOnly` + `bias`, NEGATIVE radial speed, a `speedCurve` of `[0,0]→[1,2]` (distance ∝ a²) and a small `vortex` | the converging-charge card; the spike's `th = … + a*0.9` spiral is the vortex |
| the `ring`/`pool` floor quads and the ground's own gold service lines | a `swirlRing` decal (wobble 0, fat strand = a Gaussian ring) and a `ringFill` decal | |
| the grey capsule "marker" figure | dropped | a document describes the effect, never the scene it lands on (same rule as the glitch port's target sphere) |
| `bandMat.uSweep` wiping the belt in over 0.55–1.05 s | a `material.opacity` track | the belt has no along-strip key of its own; a fade reads the same at this scale |

Numbers live in `fixtures/v2/shield/document.json`.

### Two renderer corrections the shield forced

`material.procedural:"none"` is the soft-disc SPRITE silhouette, and the §6 note already said a
real surface needs `"solid"`. A lattice shell and a band belt made that trap sharper still: cutting
a disc out of UV space turns a sphere into a CRESCENT and a belt into a bar floating off it, which
is exactly what the first shield exemplar drew. Both kinds now ignore every billboard pattern
outright — like the analytic shell, they only take the surface patterns (4-11), because they
already carry a silhouette of their own. The exemplar still says `"solid"`, because that is what
the field means.

`swirlRing`'s detached arcs are now gated on its own wobble amplitude (`proceduralParams[2]`). A
rim with no wobble is a plain Gaussian ring, which is what a shield's floor pool is; the heal
exemplar's rim wobbles (0.011) and keeps its arcs unchanged.

### What did NOT get promoted

The spike's `marker`, its hand-drawn floor grid and service lines, the `bandPivot` spin freeze
outside `[T_HOLD, T_FADE]`, and the ice spike's atlas-free `STAR_FRAG` (already covered by
`procedural:"star4"`) all stayed in the spikes. `material.proceduralParams` widened from ±8 to ±64
so the sigil can carry a rune-cell COUNT rather than a normalized weight; that only loosens the
contract, so every archived document still validates.

## 9. Sustained beam → schema (Phase F, 2026-09-14)

The seventh spike (`frontend/dev-assets/vfx-v2/spike-beam.html`, source
`docs/vfx-lab/spike-beam-reference.js.txt`) proved the *sustained* half: an element that is not an
event but a STATE, held for two and a half seconds, which has to stay alive without ever changing
shape. Everything it does to stay alive is a pattern on a fixed body — panning bands, a stepped
flicker, a flipbook of hand-drawn licks — so the port is almost entirely material vocabulary.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| `beamLen(t)`'s easeOutExpo snap and its retract, shared by every layer | one `geometry.length` track per body layer, all three with the same keys | the length is the beam's only shared state; the spike computed it once and the exemplar repeats the same four keys, because a track IS the closed form |
| `bandMat`'s `body`/`inner`/`outer` smoothsteps at `EDGE` = 8% of the band height, on a screen-aligned quad | `geometry.type:"slab"` + `geometry.slab.{anchor,tiers,taper}` | a view-space billboard whose long axis is the layer's local +Z PROJECTED: it never shears as the axis tilts away and never goes edge-on. The tiers are listed outermost first, each painting over the one before it, and the 8% edge is a renderer constant — a gaussian slab of the same width reads as fog |
| `sheathMat`'s two `fract(d*n - t*s + o)` bands with `o` hashed per ring, and the core's low-contrast `sm` | `material.stripes[{frequency,speed,phase,sharpness,contrast}]` (≤ 3) | `frequency` is bands per METRE along the layer's own axis, so a beam that extends does not squash its bands; `phase` is the per-ring offset (0 runs them straight round the body, 1 breaks them into filaments); the largest `contrast` in the list is the mix weight, which is exactly the spike's core-0.2 / sheath-1.0 split |
| `fl = 0.82 + 0.34*h11(uFlick + ring*0.91)` with `uFlick = floor(t*10)` | `material.flicker.{rate,amount}` | computed once per layer per frame on the CPU (`flickerAt`), so every draw a layer owns steps together; centred on 1 so it can never drive a layer negative |
| the `tongueGeo` strip + `TONGUE_VS`'s `k = floor(uTime*10) + aSeed` re-hash, drawn twice in two palettes at two render orders | `emitter.render.mode:"flatStrip"` + `render.strip.{length,width,waviness,stepRate,palettes}` | ONE layer, not two: `palettes: 2` splits the population by INSTANCE INDEX parity onto ramp stops t=0 and t=1, and because the draw walks the instances in order the light set always lands over the dark one. The flipbook hold is the whole point — sliding the same shape along reads as a smear |
| the `ribGeo` parallelogram streaks (`floor(t*6)` re-hash, hashed length / height / skew) | a second `flatStrip` layer at `palettes: 1`, low `waviness`, a fast `stepRate` | the spike's slabs are hard-edged and the licks tapered; at this scale the taper is the only difference, so the vocabulary is one thing, not two |
| `flareMat`'s core / wide / halo gaussians on a 0.82 × 3.2 card | `material.procedural:"lensFlare"` + `proceduralParams` [core tightness, anisotropy, spike count, halo falloff] | the anisotropy is what turns a round flare into a vertical blade; a radial cutoff at `RADIAL_CUTOFF` keeps the card's own rectangle from ever showing, and the framing pass claims only the LIT extent (otherwise a 3.2 m blade asks the camera for a 5.2 m square) |
| `rayMat`'s 13 hashed rays rotating at 0.35 rad/s | `material.procedural:"radialRays"` + params [ray count, length jitter, rotation rate, sharpness] | |
| both flare shaders' `mix(magenta, white, core)` | the two patterns supply their own RAMP KEY, radially | stop t=0 is the hot core and t=1 the outer halo, so one card is the flare AND its colour falloff; every other procedural leaves the key alone |
| the `run` points' `u = clamp(a*1.5 - off)` along the former beam line | `paths[{type:"line",from,to}]` + `emitter.velocity.mode:"alongPath"` | `velocity.speedCurve` is the shared head envelope over the LAYER's own 0..1 progress and `velocity.speed` is re-read as the per-particle lag band in path units. A line rides the bezier branch in GLSL with its control at the midpoint, which IS the straight segment term for term, so the shader never grew a third branch |
| the `res` points' `u = h11(aSeed*1.37)` scatter plus its `bell` and `tw` | `emitter.shape.type:"pathLine"` + `render.twinkle` + a bell `alphaCurve` | scattered at hashed u, not at i/(count-1): residue LYING along a line, never an ordered row of beads |
| `chg`'s `p = c + dir*r0*(1-a)^2` and the growing `ball` quad | a particles layer with NEGATIVE radial speed plus a `softRadial` sprite with a tracked `geometry.radius` | already in the vocabulary (`converging-charge`) |
| the ground shader's analytic capsule pool | a `ringFill` decal plus two point lights | |
| `EX`/`EY`/`BEAM_L`, every envelope and every colour | the exemplar | `fixtures/v2/beam/document.json` |

Deliberately not ported: the spike's checker floor (the environment's own grid covers it), its
per-layer visibility toggles (debug), and the `thin` uniform that collapses the core to a hairline
on shut-off — the retracting `geometry.length` plus an opacity track reads the same at this scale.

### One renderer correction the beam forced

`meshGeometryFor` tested `BAR_KINDS` (beam, trail) before it tested the geometry type, so a
`beam` + `slab` built a crossed-sheet bar instead of the flat quad the slab vertex program expects
— and a quad whose `position.x` is ±1 instead of a 0..1 ramp degenerates to a line. The slab is now
tested first. The same class of bug is why the shell, the band and the arc ribbon each have their
own early return: a kind and a geometry type are two different questions.

## 10. Energy overload column → schema (Phase F, 2026-09-14)

The eighth spike (`frontend/dev-assets/vfx-v2/spike-column.html`, source
`docs/vfx-lab/spike-column-reference.js.txt`) is the beam stood on end, and it proved the one thing
a vertical sustained element needs that a horizontal one does not: a **composite body that comes
apart in step**. Its slab, shell, core and arc cage all read `colHeight(t)` and `colWidth(t)`, and
the moment any of them had its own track they would drift apart on the frame that matters.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| `colHeight(t)` / `colWidth(t)`, read by four different materials | `layer.collapse.{start,duration,heightCurve,widthCurve,anchor}` | ONE spec copied onto every part. It scales `geometry.length` ALONG the layer's own +Z and `geometry.radius`/`thickness` ACROSS it, an arcs layer's `span` and `radius`, and `transform.scale` on anything else. `anchor` is always `"base"`: the transform never moves, so a body authored with its base at the layer origin retracts from the TOP. That is what "reduce the column" means, and it is the reason it is a layer field and not four tracks |
| the `seg = (h - uT*0.055)*7` ring/gap ladder, on the shell AND the slab | `material.stripes` at `phase: 0` | phase 0 is what keeps the ladder running straight round the shaft; the beam's sheath is the same field at phase 1 and reads as filaments instead. The two layers carry the same stripe set, which is how the banding reads ACROSS the body |
| the `slab` billboard's `inner`/`body`/`outer`/`halo` tiers with the `w = mix(1,0.74,h)` narrowing | `geometry.type:"slab"` with `slab.anchor:"base"` and `slab.taper` | the same field the beam uses, stood up |
| `arcs`' `pt(u,s,k)` helix, its folded `fbm3` jitter and its per-arc stepped blink window | `kind:"arcs"` + `layer.arcs.{count,radius,pitch,span,jitter,blink,width,coreColor,haloColor,seed}` | a GENERATOR: radius, pitch, base height, span and phase are re-hashed on the arc's own blink index `floor((t-off)/period)`, so no two flashes trace the same wire and nothing accumulates. `jitter.fold` is the `abs(n)*2-1` fold — without it the wire CURLS, and a curling wire reads as a ribbon, not as electricity. The ribbon is camera-facing with a minimum SCREEN-space width, because a 3D tube goes edge-on and a sub-pixel wire shimmers into nothing at depth |
| `arcGeo.instanceCount` animated between 12 and 18 | a `material.opacity` track | changing an instance count per frame is state; a density envelope is not |
| `streaks`' 6 hashed bundles, upward bias, curvature, three hues and `easeOutCubic` spread | `kind:"streakBurst"` + `layer.streakBurst.{count,length,width,curvature,upBias,bundles,bundleSpread,stagger,grow,hues,seed}` | screen space, not world: a burst read from a three-quarter camera has to fan across the FRAME, and a world-space fan collapses to a line the moment the camera is not square to it. The headings CLUMP, because an even fan reads as a lens star |
| `flare`'s core / ghosts / two lens streaks / four spikes | `material.procedural:"lensFlare"` at anisotropy 1 | the beam's flare is the same pattern at anisotropy 4.2 |
| the full-screen `flash` quad at 1.80–2.05 s | `post.flash.{curve,color,vignette}` | the strength is the curve over the DOCUMENT's own 0..1 progress, the same domain `post.glitch` uses, so a seek lands on exactly the frame playback would draw. Two or three frames is the whole shape |
| `shockRing`'s torus, `rr = 0.5 + 1.7*(1-(1-k)^2.6)` | a `kind:"ring"` `torus` with a tracked `geometry.radius` | already in the vocabulary; a torus, not a card, so the oblique camera sees an ellipse opening out of the column rather than a decal pasted on the frame |
| `sparks` and `debris` (the only non-additive layer) | two ordinary `particles` layers, the second alpha-blended and dark | |
| `cyl`'s plain dark housing | a `beam` + `cylinder` at radius 0.35, alpha blended, near-black with a fresnel rim | a document describes the effect, never the machine around it — the same rule the glitch port's target sphere and the shield port's caster figure were dropped under |
| `sky`'s gradient backdrop and `haze`'s warm field | `environment.background` + one `softRadial` sprite | |
| `COL_H`, `FLARE_Y`, every envelope and the gold palette | the exemplar | `fixtures/v2/energy-column/document.json` |

Deliberately not ported: the spike's `kick` / `sustain` overdrive multipliers (two opacity tracks
say the same thing), its ground shader's analytic two-gaussian pool (a `ringFill` decal is the
existing vocabulary for it), and the per-layer debug toggles.

### What the two ports agreed on

Both spikes build the same three-part body — a tiered SLAB for readable width, a striped SHELL for
the pattern, a near-white CORE for the bloom — and in both, the slab is the part a naive port would
leave out and then spend a round of look-dev discovering it needed. A tube alone is a wire; a
gaussian around it is fog. The hard tiers are the whole read, and they are cheap: one extra
billboard with three smoothsteps on it.

Both also needed `material.proceduralParams` to stay inside ±64, which caps `lensFlare`'s core
tightness at 64. That is tight enough for a 3 m flare at 8 m; a tighter core would need the band
widened again, and the band has already been widened once (§8), so the exemplars use 46 and 64.

## 11. Amber portal → schema (Phase G, 2026-09-14)

The ninth spike (`frontend/dev-assets/vfx-v2/spike-portal.html`, source
`docs/vfx-lab/spike-portal-reference.js.txt`) is the first element whose whole read is an **edge**.
Everything the portal does — the draw, the hold, the un-draw, the travelling highlights — happens
on one number: how far round its own perimeter you are. A rim built out of four bars cannot have
that number, which is why the port makes the frame a signed distance rather than geometry.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| `PW`/`PH`/`RIM_W`/`CORNER` and the `sdRR(vP, H, r)` rounded rect | `geometry.type:"frame"` + `geometry.frame.{corner,perimeterOrigin}` | `length` is the height, `radius` the half-width, `thickness` the bar. The card is grown `4.4 × thickness` on every side so the widest halo skirt is not cut off square — a renderer constant, because a document that had to size its own glow room would get it wrong the first time the bar changed |
| `rimU(vP, H)` | the frame's own **perimeter coordinate**, 0 at bottom-centre and 1 at top-centre, MIRRORED in x | one varying that `material.reveal`, `material.stripes` and `material.beads` all read. The mirroring is the whole "a doorway is opening" read: the front goes up both sides at once |
| `core` / `spine` / `inner` / `halo` and their four hard-coded colours | `material.sdfLine.{core,spine,innerOffset,innerWidth,halo[{falloff,weight}]}` + the ramp sampled at FOUR FIXED KEYS (0 spine, 0.22 core bar, 0.45 inner line, 1 halo) | one ramp is the whole rim. The alternative — four layers, or four colour fields on the material — would let the four terms drift apart, and they are one object |
| `gate`/`lead` off `uCut`, and `rimCut(t)`'s draw-then-un-draw | `material.reveal.{mode:"perimeter",from,to,frontWidth}` with `to` past 1, plus a track on `material.reveal.to` | the front finishes at 0.62 s of a 5 s layer and the rim then holds; dropping `to` at the end un-draws it from the top down. The same "a reveal may finish early inside a longer layer" rule the sigil established |
| the 3-bead `for` loop with its hashed offsets | `material.beads.{count,speed,width}` | hash-stepped in the renderer, because evenly spaced beads read as a barber pole |
| the 4 `vnoise` octaves, `par = vVd.xy * 0.05`, `smoke` and the amber/dark mix | `material.flow.{layers[{scale,pan,rotate}],mix,threshold,softness,parallax}` + `material.ramp.space:"surface"` keyed on the resulting MASK | `flow` REPLACES `material.noise` as the surface field. The view-direction offset on the SLOWEST octave is the only depth cue a flat card has; on the fine octaves it reads as the whole card sliding. A track on `flow.threshold` is the spike's `uSmoke` |
| the `reflection` mesh at `scale(1,-0.52,1)` with `uRefl` washing it toward a dark amber | `kind:"reflection"` + `layer.reflection.{sourceLayerId,axis,scale,blur,opacity,tint}` | it draws the SOURCE layer's own geometry and material, so a track on the interior reaches the reflection on the same frame. Mirrored about `environment.groundY` and squashed TOWARD it (`y' = groundY - (y-groundY)·scale`), so the copy stays anchored at the contact instead of sliding away as it foreshortens. Depth test off and a negative render order: the floor is opaque, so a reflection is a smear PAINTED on it, not a twin hanging underneath |
| the spark vertex's 70/30 perimeter-vs-interior branch | `emitter.shape.type:"frame"` + `shape.interiorFraction` (+ `shape.innerRadius` as how far off the rim a spark may sit) | |
| the ground shader's `across`/`pool`/`wide`/`lip` gaussians | `environment.groundPool[{shape:"rect",radius,anisotropy,color,intensity}]` | analytic, in the ground's own shader: no decal to sort and no light to flicker. `anisotropy` is the half-extent across the pool as a multiple of `radius`, which is what turns a disc into the bar a doorway throws |
| `T_RIM0/1`, `T_FILL0/1`, `T_OUT0/1`, the palette | the exemplar | `fixtures/v2/portal/document.json` |

Deliberately not ported: the spike's front/back rim pair at ±`RIM_Z/2` (one frame plus its halo
reads the same at this scale and costs half the draws), its `uBack` dimming, and the surface's
`fill` wipe — a soft vertical wipe over 0.5 s reads as the opacity track the exemplar carries.

### One renderer correction the portal forced

`safePow` clamps a negative base to an epsilon, which is exactly right for `pow(1-x, k)` and
exactly wrong for a gaussian on a SIGNED distance: `exp(-safePow(d/w, 2))` returns 1 for every
pixel INSIDE the frame, so the first render was a filled rounded rectangle rather than a rim. The
SDF gaussians square their argument directly. `swirlRing` carries a comment about the same trap;
it is now a rule: never `safePow` something that is meant to be signed.

## 12. Sky vortex → schema (Phase G, 2026-09-14)

The tenth spike (`frontend/dev-assets/vfx-v2/spike-vortex.html`, source
`docs/vfx-lab/spike-vortex-reference.js.txt`) proved that a spiral is a **coordinate transform**,
not a texture that spins. Its discs never rotate: the angle each pixel is sampled at is sheared by
`twist/(distance + eps)`, so the inner radii shear past the outer ones and a plain noise field
becomes arms. That is the one thing a spinning card can never do.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| `swirlDisc(radius, spin, twist, thr, opacity, seed, additive, lobe)` ×3 | `material.procedural:"swirlDisc"` + `material.proceduralParams` [twist, spin (turns a second), inflow, arms] on three `kind:"ring"` `disc` layers | two alpha bodies and one additive highlight at r 2.6 / 2.08 / 1.56, each leant ±4° so no two rims coincide |
| `arms = .5+.5*sin(3*(ang + uSwirl*uTwist*1.85*log(d+.09)) + …)` | `material.swirl.bands.{arms,wind,width,warp}` | an EXPLICIT log spiral, because the fbm alone only wiggles; the arms have to be drawn |
| `det = .5+.5*sin(7*(ang + uSwirl*uTwist*2.75*log(d+.09)) + …)` and `shade` | `material.swirl.detail.{arms,wind,warp,contrast}` | a second, tighter, INDEPENDENTLY wound spiral that only ever shades. A second mask here reads as a copy of the first, which is what the first two rounds of the spike looked like |
| `lobe = (fbm3(p*2)-.5) + .3*(fbm2(p*4)-.5)` | `material.swirl.lobe.{scale1,scale2,amount}` | the cauliflower edge on the mask's rim |
| `swirlEnv(t)`, read by every disc AND by the haze | `material.swirl.strength` (a Curve over the layer's own 0..1 progress) | ONE envelope: the reveal winds it from straight noise into a tight spiral and the dissipate unwinds it. That is what makes the vortex spin UP rather than simply appear spinning |
| `erodeEnv(t)` and `thr = uThr - .02 + uErode*(.55 + .35*ssm(.2,1,d))` | `material.erosion.curve` sampled on the LAYER's own progress as the mask threshold, plus `material.erosion.rimBias` | a disc has no along coordinate, so the curve keys on time and the bias on radius. Erosion leads alpha: the bands tear apart from the rim in |
| `C_HI`/`C_PAL`/`C_LIT`/`C_MID`/`C_SHA`/`C_HAZ` against `lit = 1/(1+(d*1.95)²)` | `material.ramp.space:"radial"` | distance from the layer centre over `geometry.radius`, 0 at the core and 1 at the haze |
| the 48 `PUFF` billboards, their `ang0` on the same 3 log-spiral arms, `w ∝ r^-0.65`, the far/near split and the `lit` bias | `kind:"blob"` with `blob.arrangement:"orbit"` — `height` the inner radius, `spread` the outer, `rise` the angular speed at the outer edge, `drift` the out-of-plane bob | the far half of the ring draws FIRST, smaller and dimmer, which is the entire oblique read. One layer is capped at `BLOB_LOBE_BUDGET`, so the exemplar uses two bands (40 + 34) — one ring of 40 at the same radius reads as a necklace |
| `vLight = normalize(cv.xy - mv.xy)` and the `0.78 + 0.80*vLit` falloff | `blob.lightFrom.{layerId,position,falloff}` | a fake POINT light: a direction per lobe, not per document. Anything that circles something bright wants it; a parallel toon light lights the far side of the ring the same as the near |
| the 120 `FLECK` orbits, `w = .42·r^-0.5`, the bob and the tumble | a `particles` layer with `emitter.shape.type:"orbit"` and `emitter.velocity.mode:"orbit"` | `velocity.speed[1]` is the angular rate at the outer edge and `speed[0]` the bob |
| `coreHalo` / `coreDisc` / `skyGlow` / the sky gradient | two `softRadial` sprites, a `decal` and `environment.background` | |
| `CY`, `R0`, `TILT_X/Y`, the schedule and the palette | the exemplar | `fixtures/v2/sky-vortex/document.json` |

Deliberately not ported: the spike's separate `haze` shader (the same `swirlDisc` at two arms, a
wide width and a low opacity is the same card), its per-layer debug toggles, and the puffs'
gaussian alpha — a lobe has a hard silhouette by construction, and two toon bands rather than
three is what keeps it reading as a billow instead of as fruit.

## 13. Meteor rain → schema (Phase G, 2026-09-14)

The eleventh spike (`frontend/dev-assets/vfx-v2/spike-meteor.html`, source
`docs/vfx-lab/spike-meteor-reference.js.txt`) is the one that finally made the **path a clock**.
Its five descents each have a `t0`, a `flight` and a `tImp`, and every one of the twenty-odd things
that happen at a landing reads `tImp`. Writing those times into a document by hand means redoing
all of them the moment a descent is retimed, and one missed edit puts a flash under nothing. So the
port reads the moment back OFF the path.

| Spike knob | Schema v2 field | Notes |
|---|---|---|
| `METEORS[i].{start,imp,t0,flight,dir,len}` and `tipAt(m,s)` | `paths[{id,type:"line",from,to}]` ×5 | the flight is the geometry, and it is the only place a descent is written down |
| `uOf(s) = .76s + .24s²` | `blob.head` (and the tips' `velocity.speedCurve`) | one curve, inverted in closed form, gives every anchor its birth AND every event its moment |
| the 22-anchor × 3-lobe `trail[]` table, `L.tr.{anchor,birth,life,R0,back,rise,grow}` | `kind:"blob"` with `blob.arrangement:"path"` + `blob.{pathId,head,perAnchor}` | a GENERATOR: anchor k owns u = (k+0.55)/anchors and is born the instant the head passes it, its lobes offset in the PATH's own frame (back along the tangent, up, across). Slot 0 is the smoother CORE lobe. `rise` lifts a lobe off the path and `drift` pulls it back along it, both on √age — the spike's equations unchanged |
| `tailCut = 1 - ss(T_OUT0-.3+s*1.1, T_OUT0+.9+s*1.1, t)` | `blob.retract.{from,to,alongBias}` | the window SLIDES with the anchor's own u, so the column clears in the order it was made. `alongBias` 1 eats it from the sky end down |
| `TIP_FRAG`'s teardrop core, hemisphere halo and `fract(u*20 - t*8)` dashes | `material.procedural:"teardropStreak"` + `proceduralParams` [dash frequency, dash scroll, core tightness, halo reach] | a billboard silhouette on a velocity-stretched sprite. The quad's LONG axis is uv.y, because that is the axis `render.stretch` elongates |
| the tip's `uPos = tipAt(m,s)` with the card centred on it | `emitter.render.anchor:"head"` | the LEADING point of the stretched card sits on the instance, so the streak trails behind the tip. Without it the meteor sits in the middle of its own speed lines |
| the 6 `wakes` per meteor at fixed `s` | folded into the tip layer: 30 instances on one shared `velocity.mode:"alongPath"` head envelope, each lagging by its own hashed offset out of `velocity.speed` | a lag band of 0.05 of the path fuses them into ONE streak with a bright leading point; 0.22 breaks it into beads, which is what the first round drew |
| `flashes[i]`, `rings[i]`, `burst[]`'s `birth = m.tImp + …` | `layer.window.{at:{pathId,u:1}}` | the layer's start becomes the moment that path's head reaches u, and `layer.start` is read as an OFFSET from it. Resolved once when the document loads (`events-v2.ts`), so the renderer, the framing pass and the capture path all agree |
| `debrisMat.uniforms.uTimp[]` / `uImp[]` and the `aMet` per-instance meteor index | `emitter.spawn.mode:"event"` + `spawn.originsFromPath` with NO `shape.pathId` | instance i takes document path i % paths.length, so a SINGLE debris layer covers all five impacts. The (origin, moment) pair is one instance attribute, computed on the CPU from the paths — not five path uniform packs in the shader |
| `N_BURST` pale lobes on an expanding ring with the comma deformation | a `kind:"blob"` `ring` per impact, `comma` set, `window`ed onto its own path | |
| the ground shader's `uTip`/`uTipI` violet pool and `uFlash`/`uScorch` | `environment.groundPool[{shape:"disc",radius,color,intensity}]` ×5 | a pool may also name `followsLayerId` and read that layer's LIVE transform, which is the travelling half of the spike's `uTip` |
| the fan positions, the palette, the 0.45 s stagger | the exemplar | `fixtures/v2/meteor-rain/document.json` — and with it, the LAST code-built recipe left `recipes-v2.ts`. Every family is now a fixture |

Deliberately not ported: the spike's separate `WAKE_FRAG` quads (the lag band covers them), its
`spikeImpactScreen` debug hook, the flat additive shock-ring disc (the event-spawned flash
population reads the same at this scale) and the per-meteor scorch — `groundPool`'s own intensity
curve carries the lingering stain.

### What the three ports agreed on

All three replaced a per-frame CPU table with a closed-form field: the portal's rim is one SDF
instead of four bars, the vortex's arms are a coordinate shear instead of a rotation, and the
meteor's impacts are a curve inversion instead of a time table. In each case the version that
stores nothing is also the shorter one, and it is the only version a seek can land inside.
