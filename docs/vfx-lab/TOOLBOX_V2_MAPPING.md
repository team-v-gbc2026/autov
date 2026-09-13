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

### What did NOT get promoted

The spike's `marker`, its hand-drawn floor grid and service lines, the `bandPivot` spin freeze
outside `[T_HOLD, T_FADE]`, and the ice spike's atlas-free `STAR_FRAG` (already covered by
`procedural:"star4"`) all stayed in the spikes. `material.proceduralParams` widened from ±8 to ±64
so the sigil can carry a rune-cell COUNT rather than a normalized weight; that only loosens the
contract, so every archived document still validates.
