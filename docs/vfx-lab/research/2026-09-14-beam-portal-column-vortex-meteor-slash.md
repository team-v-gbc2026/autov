# Research — beam, portal, energy column, sky vortex, meteor rain, fire slash (fx13, fx14, fx16, fx17, fx09, fx07)

## A. Energy Beam — Muhammed Başaran, https://www.artstation.com/artwork/g0kq88 (UE5.4 Niagara)

Sibling work: https://www.artstation.com/artwork/Jl1VQa and the Fab listing "Energy Beam VFX (with SFX)"; the toolkit
is Niagara emitters with material dynamic parameters, cylinder/plane meshes for the sheath, ribbon renderers for the
outer stripes — no simulation.
- [Breakdown] Stylized Energy Beam, RealtimeVFX, https://realtimevfx.com/t/breakdown-stylized-energy-beam/21866 — an
  8-phase timeline: star burst → charge (cubes pulled backward) → fire mesh with vertex-painted opacity and a scrolling
  alpha-clip → expanding circles → central star (dual quad, distortion) → charge star (point cache twirling inward) →
  beam (cylinder mesh with blend shapes for open/closed, duplicated at several alpha thresholds for layered contrast)
  → star explosion.
- CGHOW Kamehameha Beam (Blender + UE5.4)
  https://cghow.com/kamehameha-beam-in-blender-and-unreal-engine-5-4-niagara-tutorial-bday-special-free-files/ ·
  Beam FX https://cghow.com/beam-fx-in-ue5-niagara-tutorial/ · Celestial Beam
  https://cghow.com/celestial-beam-vfx-in-ue5-niagara-rays-dissolving-ring-curl-noise-%F0%9F%8C%A0%E2%9C%A8%E2%AC%87%EF%B8%8F/
  (cylinder mesh + "rays" material for volumetric light, ribbons and sprites on top).

Common AAA details: the core is a mesh cylinder/cone with a panning stripe material (hard edges, not a soft additive
sprite); the sheath carries a second, faster stripe pattern with a phase offset (the hard bands); charge = particles
converging inward that collapse into the emitter right before the flare; shut-off is never a cut — a short trailing
colour-shifted burst (yellow-green) vents residual energy over the last 10–15 %.

three.js: two concentric cylinders; core stripes = smoothstep on |fract(u·12 − t·3) − 0.5|, radial falloff across v,
edge→core colour mix; sheath same at a larger radius, lower opacity, other speed, magenta; emitter flare = vertically
stretched radial billboard with envelope smoothstep(0, .05, t)·(1 − smoothstep(.85, 1, t)); charge = instanced
spheres on p(t) = c + dir_i·r0·(1 − t)²; shut-off trail = instanced burst with a white→yellow→green colour curve.

## B. Waves of Sorrow — The Portal — Aline Archidec, https://aaylia.artstation.com/projects/2qzwGx (UE, ISART Digital)

- Driving Niagara with flowmaps and baked fluid data, 80.lv,
  https://80.lv/articles/tutorial-driving-niagara-with-flowmaps-and-baked-fluidsim-data — the "smoky moving interior
  patches" technique (flow map for initial velocity, flipbook for turbulence).
- CGHOW Magical Portal https://cghow.com/magical-portal-in-ue5-niagara-tutorial-3/ · Epic community portal tutorial
  https://dev.epicgames.com/community/learning/tutorials/dBj6/unreal-engine-create-stunning-portal-effect-vfx-with-niagara-particles-complete-tutorial
- Energy Shield Hologram, Danielilett, https://danielilett.com/2023-02-09-tut6-3-energy-shield/ — edge glow
  strength/thickness parameters scaling a rim mask in UV space.

AAA details: the rim is a separate emissive mesh strip so it pulses independently; the interior uses 2–3 panning
noise/flow layers at different speeds and scales; sparks spawn along the rim with outward + gravity motion, not across
the whole surface.

three.js: extruded rectangular frame with pulse 0.7 + 0.3·sin(2t); interior = two procedural noise layers panned by
different multipliers combined by smoothstep and mixed between dark and bright amber; sparks instanced along the
perimeter parameter with an arc trajectory and sine flicker.

## C. Fortnite Events and Cinematics — Tuatara Games (energy column Zag96G, sky vortex WB4B2y)

Tuatara Games builds Niagara-driven cinematic FX for Fortnite live events (https://tuataragames.artstation.com/,
https://tuataragames.com/work/fortnite).

Energy column: Lightning/Electricity FX via Dynamic Beams (RealtimeVFX) · Shocking Lightning VFX in UE5, 80.lv,
https://80.lv/articles/learn-how-to-create-electrocuting-lightning-vfx-with-ue5-s-niagara · Cinematic VFX chapter 1:
lightning arcs https://forums.unrealengine.com/t/community-tutorial-unreal-5-1-tutorial-making-cinematic-vfx-using-niagara-chapter-1-lightning-arcs/771798.
Arcs are never continuous: they blink per segment with a random delay per arc and are drawn as camera-facing ribbons.

Sky vortex: Simple Stylized Tornado (torus mesh, erode, dynamic params)
https://cghow.com/simple-stylized-tornado-vfx-in-ue5-niagara-torus-mesh-erode-dynamic-params-%F0%9F%8C%AA%EF%B8%8F%F0%9F%8C%80%E2%9C%A8/
— stacked rotating torus meshes with an erosion material and per-instance size/tiling randomisation for non-uniform
spiral bands · Fluid Tornado https://cghow.com/fluid-tornado-in-ue5-niagara-tutorial/ · polar-coordinate swirl
(angle += strength / dist) as in Godot "2D Swirling Vortex Portal". The disc always layers at least three
independently rotating swirl layers (fast inner, medium, slow outer haze) at different opacities; dark flecks are
separate instanced sprites on a slower orbit for parallax.

three.js: column arcs = N thin ribbons on x(y) = R·cos θ_i + amp·sin(f·y + φ_i)·noise(seed_i, t), visibility gated by
step(rand(seed_i), flicker(t)); vortex = disc with UV twist angle = atan + twist/(dist + .05) − t·spin, band noise
sampled in swirled UV, colour mixed from yellow-white centre to orange haze, dark bands by smoothstep on the noise;
three stacked discs at different scale/spin/opacity; flecks instanced on elliptical orbits.

## D. Meteor Rain — Xavi Florit, https://www.artstation.com/artwork/8B9kvx · Fire Slash — Vincent Dautremer, https://www.artstation.com/artwork/OGNX6k

Meteor: CGHOW Meteor in UE4 Niagara https://cghow.com/meteor-in-ue4-niagara-tutorial/ — burning core = sphere mesh
with a fading burn material; a hemisphere "speed-line" cap mesh for the streaks; dust/smoke via a 4×4 flipbook; sparks
in a velocity cone; jitter on the core; smoke trail from randomised-frame dust with velocity alignment and gravity.
The core never stays a sphere — stretched along velocity — and the impact burst is a separate event (radial burst +
rising particles), not trail continuation.

Fire slash: Design Process of "Fire Slash" VFX, HeyYo CG, https://heyyocg.link/en/design-process-of-flame-slash/ —
base silhouette is a crescent/disc mesh with softened edges, UV-distorted by a Voronoi noise; three tonal emitters
(highlight / midtone / shadow), each a separate mesh particle offset in scale, position and timing; the highlight moves
faster than the silhouette with stronger emission, concentrating energy at the tip; colour from a gradient map
sharpened with power + multiply; the disappearance widens the mesh with world-position offset while the UV-distortion
scale increases (tearing, not fading); trailing sprites get a small velocity opposite to travel. Also CGHOW Sword
Slash https://cghow.com/sword-slash-in-ue5-niagara-tutorial/ and Sword Trails
https://cghow.com/sword-trails-in-ue5-niagara-tutorial/ (disk mesh, erosion inward via dynamic parameters, radial
sparks with hue shift; sin() on distorted UVs × noise for edge detail). Erosion in UV space keeps hard edges legible.

three.js: meteor core = stretched sphere + speed-line cap with fract(u·20 − t·8) mask; trail = instanced chunks along
the ballistic path sampled behind the head, scale growing with age; impact = radial instanced burst at impactTime.
Slash = crescent SDF with an erosion front sweeping over life (front(t) = t·1.3 − lag), Voronoi detail adds to the
highlight band, three tonal layers offset in time; alpha tail = 1 − smoothstep(tailStart, 1, t).
