# Research — ice blast, hex shield, healing aura, glitch projectile (fx08, fx05, fx15, fx04)

ArtStation pages block automated fetches, so first-party breakdown text for the four pieces was not recoverable;
the construction below comes from the closely matched tutorial/breakdown ecosystem for each archetype.

## A. Ice blast — Johannes Eder, https://www.artstation.com/artwork/K3NbvB

Closest documented analogue: Ice Spikes VFX Production: Tips and Tricks, 80.lv,
https://80.lv/articles/ice-spikes-vfx-production-tips-and-tricks
- Spikes are hand-modelled modular meshes; a master motion curve first, then per-spike-group time offsets (≈ 5–15 %
  stagger) so one burst reads as a cascade, not a pop.
- Shader = stylized ice base + flow-mapped mask layering (core / edge / frost zones) + anisotropic noise for elongated
  specular glints; a large-scale normal map reused as a micro-fracture detail layer.
- "Chillfog": two Perlin maps distort a soft alpha mask, varied per sprite; separate snow and shard emitters at the
  perimeter; lingering low-opacity cold fog after the burst.
- Careful delay between the ground sigil/floor animation and the spike growth.

Tutorials: UE4 Niagara Realtime Ice Attack (Stylized Station) https://www.youtube.com/watch?v=I2TjNA577fo ·
Character Ice Aura UE5 https://www.realtimevfx.in/2025/11/create-character-ice-aura-vfx-in-unreal.html ·
UE5 Crystal FX https://cghow.com/ue5-crystal-fx-in-unreal-engine-5-2-niagara-tutorial/ ·
Ice refraction (Danielilett) https://danielilett.com/2021-02-04-tut5-14-ice-refraction/ — normal-perturbed screen
UV into a scene-colour copy; fresnel = pow(1 − N·V, p); HDR tint multiplies the refracted sample.

three.js: ground sigil = flat disc with an outward smoothstep reveal; crystals = instanced faceted cones/pyramids,
per-instance start offset hashed from the id, scale on Y with easeOutBack; ice material = fresnel mixing pale-blue
faces to white edges + anisotropic glint + optional refraction of a pre-rendered scene; shatter = pre-fractured shards
on a closed-form ballistic path with opacity 1 − smoothstep after the shatter time; mist = billboards with two panning
noise layers; perimeter fragments instanced with hashed radius/angle.

## B. Shield — Thea Falkenmark, https://www.artstation.com/artwork/Xnmlyy

- Forcefield Shader Breakdown, Cyanilux, https://www.cyanilux.com/tutorials/forcefield-shader-breakdown/ — fresnel
  power 8 then ×2; depth-intersection glow (reconstruct world position from depth, distance to sphere centre minus
  radius → abs → 1 − → saturate → pow 15) for a tight line where geometry pokes through; scene-colour distortion by
  gradient noise (scale 25, ×0.01, panned by time·0.1); impact ripples from an array of up to 6 hit points.
- Overwatch shield case study, lexdev, https://lexdev.net/tutorials/case_studies/overwatch_shield.html — hex texture
  pulsing from the centre outward with a random phase per cell; a diamond pattern of increasing scale running along
  hex edges toward the corners; rim = fresnel + depth intersection; three grey masks packed in one RGB texture;
  back-face culling off; sine-driven animation by time and world position.
- Shader Graph Force Shield with Hits, https://storyprogramming.com/2019/09/17/shader-graph-force-shield-with-hits/
  — max(depth intersection, fresnel) multiplies the hex sample so the grid shows mostly near edges.

three.js: icosphere, unlit custom shader, double side; hex mask in world/spherical UV with per-cell phase pulse;
gold band = smoothstep on dot(normal, diagonalAxis) around a centre that moves with time; fresnel pow 8 ×2; optional
depth texture for intersections; hit ripples as uniforms (pos, time) summed additively.

## C. Healing Buff VFX — Johan Nydahl, https://johannydahl.artstation.com/projects/NyaNzN

Built in Unity VFX Graph + Shader Graph; "an initial burst of healing followed by a short heal-over-time".
Tutorials: Simple Healing Aura VFX UE5 Niagara https://www.youtube.com/watch?v=R1W_8Z1trsY ·
Simple Light Aura VFX https://cghow.com/simple-light-aura-vfx-in-ue5-niagara-tutorial-%E2%9C%A8%F0%9F%9B%A1%EF%B8%8F%F0%9F%92%A1/
(flat ground ring with a panning gradient, a cone mesh with a glowing transparent emissive, floating particles inside)
· UEFN Healing Buff https://www.realtimevfx.in/2026/08/uefn-vfx-tutorial-make-healing-buff-ue6.html ·
Isometric Level Up Aura https://www.realtimevfx.in/2025/12/isometric-level-up-aura-vfx-in-ue5.html ·
Multi-layer ribbon trail https://cghow.com/create-a-multi-layer-ribbon-trail-vfx-in-ue5-niagara-advanced-color-edge-material-%F0%9F%8E%A8%E3%80%B0%EF%B8%8F%E2%9C%A8/
(ribbon along a path, width tapered head to tail, a second thinner additive ribbon on top for the hot core).

Layer stack: ground ring (bright rim + soft inner fill, pops in over the first 10–15 %), upright glow cylinder
(additive, vertical UV-panning noise, soft top, slight taper), sweeping ribbon (orbit path, one loop, tapered ends,
bright core + soft halo), rising four-point sparkles (staggered births, sine wobble, bell alpha), then a soft fade.

three.js: ring = disc with smoothstep bands and easeOutBack scale; cylinder = open cylinder, additive, vertical fade ×
noise × rim pow(1 − |N·V|, 2); ribbon = strip along p(u) = c + r(u)(cos, h + wobble, sin) drawn only in the window
[head − tail, head]; sparkles = instanced quads with a procedural 4-point star SDF, per-instance birth/seed.

## D. UE5 VFX Glitch Challenge — Marjorie Roche, https://www.artstation.com/artwork/kw4Rnl

- Glitch shader series (Agate Dragon): displacement lines
  https://agatedragon.blog/2023/12/20/glitch-shader-effect-with-displacement-lines/ (bands offset in UV.x by a hash
  re-rolled on floor(time·freq)), blocks https://agatedragon.blog/2023/12/21/glitch-shader-effect-using-blocks-part-2/
  (grid-cell hash offsets/recolours), RGB split https://agatedragon.blog/2023/12/24/glitch-effect-with-rgb-split/.
- CGHOW UE4 Niagara Glitch https://cghow.com/ue4-niagara-glitch/ — world-position-offset displaces geometry, not just
  UVs (positional jitter).
- Hologram VFX with Niagara 2 (marketplace) — scanline sweep, edge fresnel flicker, panel tiling vocabulary.

Construction: faceted low-poly head; quadratic Bézier path; vertex jitter gated by step(0.85, hash(floor(t·8))) so it
fires in discrete windows; fragment RGB split (R toward magenta, B/G toward cyan), block dropout, scanline; trailing
lines as a segmented ribbon with dashed alpha and stepped hue; impact = instanced angular shards on ballistic paths
using the same glitch shader; flicker frequency rises in the last ≈ 10 % before impact.

## Cross-cutting

All four need no simulation. Shared infrastructure worth building once: hash/noise GLSL utilities; ribbon along a
closed-form path with a moving window; instanced fragment burst (ice shatter, glitch impact); optional depth/colour
render target for intersection and refraction. The dominant AAA "detail" pattern is staggered per-instance timing
offsets — a single global curve reads as cheap.
