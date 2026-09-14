# Research — stylized smoke burst (benchmark fx12, reference 03rPr8)

Reference: "VFX Smoke animation" — Pochekunina Yana (Banzai Games), https://www.artstation.com/artwork/03rPr8 (2.76 s).

## What the artist used

Her portfolio is a family of matching pieces tagged "2D animation"; the sibling "VFX Fire animation" on Behance
(https://www.behance.net/gallery/130213129/VFX-Fire-animation) lists **Adobe Animate CC**. The smoke is
hand-drawn frame-by-frame 2D effects animation: there is no physics to reverse-engineer. The shapes, timing and
shading are art-directed per frame. The task is to fake the hand-drawn silhouette language procedurally.

## What the clip shows (t in s of 2.76)

- 0.00–0.20 small yellow four-point glint at the origin, then a soft yellow ball (anticipation).
- 0.25–0.40 near-white hot ball at the base with 2–3 small blue-violet lobes under it; faint blue glow ring on the ground.
- 0.40–0.75 tall narrow column of blue-violet lobes shoots up (height ≈ 3× width); white glow still at the base.
- 0.75–1.20 base widens; large pink/magenta billows with lighter caps appear left and right, bigger than the violet
  lobes; a flat grey jagged "splash" silhouette (unshaded) fans out sideways behind the base.
- 1.20–1.60 the column thins and breaks into separate small lobes; pink billows split and drift outward; grey shards
  detach as thin curved slivers and fade.
- 1.60–2.76 a thin vertical string of small violet wisps remains, rising and thinning; gone ≈ 2.6.

Shading language: every lobe is a cel-shaded rounded blob in three broad tones (light lavender cap upper-left, mid
blue-violet body, dark plum shadow) with a crisp silhouette and a thin lighter rim. Pink family: highlight ≈ #ff9de8,
body ≈ #ff3fd0, shadow ≈ #b0189a. Violet family: body ≈ #5a3ce0, shadow ≈ #2c1a7a.

## Tutorials and papers

1. Unity VFX Graph — Stylized Smoke, Gabriel Aguiar, https://www.youtube.com/watch?v=dPJQuD93-Ks — billboard
   particles with animated erosion (noise threshold over life) and flipbook motion; flat-shaded "poof".
2. Building a Toon Smoke Particle Shader in Shader Graph, ldev,
   https://blog.ldev.app/building-a-toon-smoke-particle-shader-in-shader-graph/ — sphere mesh; N·L saturated and
   posterised into two bands between highlight and shadow colours with a threshold parameter; Voronoi noise in
   object space displaces vertices along the normal; normals recomputed from two displaced neighbours.
3. McGuire & Fein, Real-Time Rendering of Cartoon Smoke and Clouds, NPAR 2006,
   https://casual-effects.com/research/McGuire2006Smoke/smoke-NPAR06.pdf — billboards + "nailboard" self-shadow,
   outline by a second all-dark billboard offset along the view vector, cel shading on top. Internal contour lines
   where puffs overlap are treated as a feature of the look.
4. How To Create Stylized 3D Smoke Pillar VFX, 80.lv, https://80.lv/articles/how-to-create-stylized-3d-smoke-pillar-vfx
   — Blender geometry-nodes smoke built from stacked deformed primitives, not a simulation.
5. Stylized Smoke VFX + Breakdown, Rub Luna de San Macario, https://www.artstation.com/artwork/BmOerD.
6. How to create stylized smoke (Spellbreak inspired), RealtimeVFX,
   https://realtimevfx.com/t/how-to-create-stylized-smoke-spellbreak-inspired/21571 — camera-facing quads with a
   tangent-space normal map; light direction transformed into tangent space shifts a second sample of the texture to
   fake directional shading on a flat flipbook.
7. Realistic smoke lighting with 6-way lighting in VFX Graph, Unity,
   https://unity.com/blog/engine-platform/realistic-smoke-with-6-way-lighting-in-vfx-graph — baked directional
   lightmaps blended by light direction; our closed-form analogue is a height ramp plus an N·L rim term.
8. Stylized Frag Launcher Explosion (Overwatch), RealtimeVFX,
   https://realtimevfx.com/t/stylized-frag-launcher-explosion-overwatch-inspiration-breakdown-posted/1894 and
   https://realtimevfx.com/t/stylized-cartoon-explosion-overwatch-inspired/1767 — the "burst/flash/ring" accent is a
   separate short-lived flat near-white shape, independent of the smoke shading.

## Common principles

- Silhouette from overlapping round primitives (cauliflower cluster), never one fuzzy volume. 3–6 large base lobes;
  stacked smaller lobes at 40–70 % of the base radius; isolated wisp lobes at 20–30 % at the top that detach and curl.
- Shading: N·L saturated, hard-stepped into 2–3 bands with a fixed upper-left light, plus a thin rim band. The fixed
  light is what gives the "always lit the same way" anime look.
- Colour driven by a scalar (height on the plume or lobe age/family), not by lighting alone.
- An explicit outline (inflated back-face hull or rim darken/lighten) is what makes it read as one solid painted
  volume rather than soft blobs. Bands must be discrete, not a smooth gradient.
- The base accent is a separate flat, unshaded, near-white/grey shape that lives in the first 5–20 % of the effect.
- Timing bands (percent of duration) overlap on purpose: glint 0–8 %, burst accent 5–20 %, rise 10–55 %, separation
  40–75 %, wisp/dissolve 65–100 %.

## Three.js construction (closed form in time)

Blob mesh (primary): 8–16 icospheres; per lobe i with birth t0, life L, age a:
radius(a) = R0 · easeOutCubic(min(a·k, 1)) · (1 − smoothstep(0.7, 1, a));
center(a) = base + (driftX·√a, rise·a − ½g·a², driftZ·√a). Vertex shader displaces along the normal by
(fbm(normal·f + time·s + seed) − 0.5)·amp, amp larger for wisps. Fragment: three tones by thresholds ≈ 0.35 / 0.7
on N·L, rim = pow(1 − N·V, 3) tinted with the highlight. Outline: second draw, back faces, vertices pushed along the
normal, unlit colour lighter than the body (the reference has a light rim, not a black line). Lobes stay opaque with
depth test; alpha only in the last ≈ 25 % of life, and the outline fades with it.

SDF metaball (secondary): the same lobe functions as smooth-min spheres raymarched in one fragment shader, normals from
the gradient, same toon ramp; only this fuses lobes like liquid. Bound the march to a screen quad sized from the
lobe extents. Hybrid: raymarch only the base fusion in the first ≈ 30 %, cross-fade to meshes.

Pitfalls: intersection seams between opaque lobes are acceptable as internal contour lines (McGuire); inflated-hull
outlines pinch on detail-0 icospheres; sort only the transparent dissolve phase.
