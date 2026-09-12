import {
  type Layer,
  type Params,
  type VfxDocument,
  validateDocument,
} from "./schema";

export const DEFAULT_PARAMS: Params = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  color: "#8cdfff",
  secondaryColor: "#3478e5",
  radius: 1,
  width: 0.08,
  length: 2,
  intensity: 1.7,
  opacity: 1,
  speed: 2,
  turbulence: 0.35,
  erosion: 0,
  spin: 0.2,
  arc: Math.PI * 2,
  count: 600,
  life: 1.1,
  emission: 0.12,
  spread: 0.45,
  gravity: -0.4,
  drag: 1.5,
  blend: "additive",
};
function layer(
  id: string,
  name: string,
  kind: Layer["kind"],
  role: Layer["role"],
  start: number,
  end: number,
  params: Partial<Params> = {},
  tracks: Layer["tracks"] = [],
): Layer {
  return {
    id,
    name,
    kind,
    role,
    start,
    end,
    enabled: true,
    params: { ...structuredClone(DEFAULT_PARAMS), ...params },
    tracks,
    overrides: [],
  };
}
const curve = (
  target: Layer["tracks"][number]["target"],
  keys: [number, number][],
  ease: Layer["tracks"][number]["ease"] = "outCubic",
) => ({ target, keys, ease });
const fade = (duration: number, attack = 0.035) =>
  curve(
    "opacity",
    [
      [0, 0],
      [attack, 1],
      [duration * 0.4, 0.72],
      [duration, 0],
    ],
    "smooth",
  );

export const RECIPES = {
  slash: {
    name: "Astral slash",
    subtitle: "A blade of light, with a lingering wake.",
    prompt:
      "A razor-sharp cyan crescent slash. Brief gathering energy, one decisive diagonal strike, a hot white core, violet afterimages and fast directional sparks. Dissipate cleanly in three seconds.",
    knowledge:
      "Build silhouette first: one broad crescent ribbon with a thinner white core, then two dim offset ribbons. Align contact flash at the arc sweep onset. Sparks follow after 25 ms. Keep residue lower contrast. Do not replace a slash with concentric circles. View from camera at (5,3.1,7), looking at origin. Ribbons lie in local XY; rotate to face the camera.",
  },
  magic: {
    name: "Celestial gate",
    subtitle: "A ritual drawn in light and motion.",
    prompt:
      "An intricate violet and gold magic circle assembling on the ground. Concentric engraved rings turn in opposite directions, sparks spiral upward into a luminous portal. Deliberate anticipation, bright activation, elegant fading embers.",
    knowledge:
      "Establish a readable planar sigil with decal and three fine rings at different radii. Counter-rotate inner and outer rings. Add one vertical shell and ascending particles, a narrow beam only during activation. Avoid opaque filled discs and uniform brightness. Ground rings lie XZ (rotation X=-pi/2); shell stays upright. Preserve negative space.",
  },
  shockwave: {
    name: "Solar rupture",
    subtitle: "A compressed core. A world of impact.",
    prompt:
      "A cinematic amber shockwave: a tiny imploding core, an explosive bright flash, a rapidly expanding ground ring and broken spherical pressure shell. Hot streaks fly radially, smoky embers linger, then everything resolves to darkness.",
    knowledge:
      "Start a tiny charged core; impact synchronizes flash, expanding ground ring, and pressure shell. Ring radius must have rapid non-linear expansion. Stagger secondary ring by 50 ms. Sparks burst from near zero radius with radial motion and drag; smoke is softer and uses normal blending. Hierarchy: core > shock front > sparks > residual haze. Keep maximum exposure under control.",
  },
  lightning: {
    name: "Graphic lightning",
    subtitle: "One decisive angular strike.",
    prompt:
      "A single cyan lightning bolt, with a white core, a brief anticipation and a fading ground ring.",
    knowledge:
      "Use geometry lightning with surface solid on a beam-kind layer. A single short primary interval is a strike; never repeat it unless requested. Low turbulence removes extra branches. Width in meters controls silhouette. Use separate ground ring and a few short-lived sparks. Keep primary count exact and ground centers aligned.",
  },
  projectile: {
    name: "Elemental projectile",
    subtitle: "A shaped head and a directional wake.",
    prompt:
      "A streamlined fire projectile pointing left, with a hot compact head and a layered orange tail extending right.",
    knowledge:
      "Use cone or shell head with flame/water surfaces. A cone points along local +Y; rotation.z=pi/2 points left. Use motion waypoints for travel only when requested; a stationary showcase stays centered. Build tail as 2-3 progressively wider, dimmer surfaces behind the head. Avoid radial explosions and random rings. Keep water smooth, smoke low contrast, flame sharply tapered.",
  },
  water: {
    name: "Flowing water",
    subtitle: "Rounded head and a connected moving membrane.",
    prompt:
      "One left-facing pale-cyan water projectile with a rounded head, smooth white streaks, a connected blue membrane flowing right and a few rounded droplets. Keep the head stationary, then dissolve head first and droplets last.",
    knowledge:
      "Build a rounded teardrop head with surface water, normal blend, low bloom. For additional WHITE surface streaks, use surface water-streaks on a 1.015x enlarged copy with exactly matched center, rotation, motion and turbulence; never overlay a full opaque water shell for highlights. Join 2 overlapping streamer membranes to its rear: streamer extends along local Y from a fixed root at -length/2 to a free tip at +length/2; rotation.z=-pi/2 makes its tip flow right. The vertex shader animates the tip while holding the root fixed; turbulence .5-1 controls this sway. Place each root INSIDE the rear half of the head and keep the membrane narrower and darker than the head. Streamer is a straight flowing membrane, unlike the crescent geometry ribbon. Use a few small teardrop meshes with rightward motion for ROUND droplets, no radial spark burst. Fade the head before the final droplets. Keep surface streaks broad and continuous, preserve deep blue tail contrast.",
  },
  smoke: {
    name: "Rising smoke",
    subtitle: "Layered billows with a clean silhouette.",
    prompt:
      "A rounded violet smoke burst rising from one point, with pink lower billows and separate fading wisps.",
    knowledge:
      "Compose 3-5 overlapping low-intensity normal-blended lobes into one CONNECTED rising column. Keep the lower main body attached near the emission point during growth; as its length increases, lift its center by about half that increase so the base stays anchored. Upper lobes can move upward more. Avoid moving every lobe into separated floating blobs. Use the generated smoke-lobe mask for the column and smoke-curl mask for the later detached curling wisps. The main column should grow to fill much of the eventual motion envelope, not occupy a tiny bottom corner below far-traveling wisps. Preserve the requested purple/pink palette without additive whitening. Detached wisps start after the main rise and drift a short distance, eroding independently.",
  },
  beam: {
    name: "Sustained beam",
    subtitle: "Charge, extend, sustain, release.",
    prompt:
      "A horizontal magenta energy beam from right to left, charging first, sustaining, then fading into a particle wake.",
    knowledge:
      "Use beam auto with rotation.z=pi/2 for a horizontal camera-plane beam. Animate length during extension; move the center by half the length change to keep the emission point anchored. Prefer surface energy-ribbon with white color and saturated secondaryColor: it supplies a continuous white core and sharp colored sides without cloud holes. Add a separate endpoint flare and a late residue layer; extra beam layers should only serve a distinct visible purpose. Do not substitute a radial burst for a continuous connected beam.",
  },
  portal: {
    name: "Amber portal",
    subtitle: "A rectangular opening with moving mist.",
    prompt:
      "One upright amber rectangular portal, with a luminous rim, softly moving translucent interior and golden edge sparks.",
    knowledge:
      "Use geometry plane, surface portal, kind decal. Width=2*radius, height=length. The procedural portal surface provides a rectangular rim and moving mist; params.width controls rim thickness in meters, usually .05-.12; do not use the circular default decal. The opening stays recognizable during sustain; fade opacity at both boundaries. Do not add doorway architecture or a destination scene.",
  },
} as const;
export type RecipeId = keyof typeof RECIPES;
export function createPreset(id: RecipeId): VfxDocument {
  if (!["slash", "magic", "shockwave"].includes(id))
    return createConstructionPreset(id);
  const base: VfxDocument = {
    schemaVersion: "autov.lab/1",
    name: RECIPES[id].name,
    description: RECIPES[id].prompt,
    seed: 41721,
    duration: id === "magic" ? 5 : 3,
    impact: id === "magic" ? 1.45 : 0.55,
    post: { bloom: 0.65, exposure: 0.95, background: "#101112" },
    layers: [],
  };
  if (id === "slash")
    base.layers = [
      layer(
        "gather",
        "Gathering light",
        "sprite",
        "anticipation",
        0,
        0.6,
        { radius: 0.3, intensity: 2, position: [-0.8, -0.3, 0] },
        [
          curve(
            "radius",
            [
              [0, 0.02],
              [0.5, 0.28],
              [0.6, 0.04],
            ],
            "inQuad",
          ),
          fade(0.6, 0.2),
        ],
      ),
      ...[0, 1, 2].map((i) =>
        layer(
          `arc-${i}`,
          ["Blade silhouette", "Violet wake", "Fine white edge"][i],
          "trail",
          i ? "secondary" : "primary",
          0.52 + i * 0.025,
          1.8 + i * 0.25,
          {
            radius: 1.6 + i * 0.09,
            width: i === 2 ? 0.025 : 0.19 - i * 0.055,
            color: ["#79e4ff", "#9971ff", "#e6fbff"][i],
            secondaryColor: "#416dea",
            arc: 4.1,
            intensity: i === 2 ? 2.5 : 2,
            rotation: [0.15, -0.4, -0.48 - i * 0.04],
            spin: 0.2,
          },
          [
            curve(
              "erosion",
              [
                [0, 0.02],
                [0.2, 0.05],
                [1.15, 0.95],
              ],
              "inQuad",
            ),
            curve(
              "radius",
              [
                [0, 0.7],
                [0.12, 1.8 + i * 0.08],
                [1.2, 2.1],
              ],
              "outCubic",
            ),
            fade(1.28 + i * 0.225),
          ],
        ),
      ),
      layer(
        "impact-flash",
        "Contact flash",
        "sprite",
        "impact",
        0.55,
        0.85,
        {
          radius: 0.7,
          intensity: 3,
          color: "#d8faff",
          position: [0.7, 0.1, 0],
        },
        [fade(0.3)],
      ),
      layer(
        "contact-ring",
        "Contact ripple",
        "ring",
        "impact",
        0.56,
        1.4,
        {
          radius: 0.6,
          width: 0.035,
          intensity: 0.7,
          rotation: [0, 0.4, 0.1],
          position: [0.7, 0.1, 0],
        },
        [
          curve("radius", [
            [0, 0.05],
            [0.3, 0.85],
            [0.84, 1.3],
          ]),
          fade(0.84),
        ],
      ),
      layer("sparks", "Cutting sparks", "particles", "secondary", 0.575, 2.6, {
        count: 1200,
        radius: 0.3,
        width: 0.028,
        length: 0.12,
        speed: 3.5,
        spread: 0.8,
        rotation: [0.6, 0, -0.5],
        life: 1.3,
        intensity: 2.2,
        gravity: -0.7,
      }),
      layer("dust", "Lingering stardust", "particles", "residue", 0.8, 3, {
        count: 300,
        radius: 1.4,
        width: 0.018,
        length: 0.025,
        speed: 0.25,
        life: 1.8,
        emission: 0.3,
        gravity: 0.15,
        color: "#9984da",
        intensity: 0.7,
        spread: 1,
      }),
    ];
  if (id === "shockwave") {
    const hot = { color: "#ffbd65", secondaryColor: "#d54921" };
    base.layers = [
      layer(
        "charge",
        "Compressed core",
        "sprite",
        "anticipation",
        0,
        0.6,
        { ...hot, radius: 0.18, intensity: 2.5 },
        [
          curve(
            "radius",
            [
              [0, 0.15],
              [0.4, 0.4],
              [0.6, 0.03],
            ],
            "smooth",
          ),
          fade(0.6, 0.15),
        ],
      ),
      layer(
        "flash",
        "Ignition",
        "sprite",
        "impact",
        0.55,
        0.88,
        { color: "#fff0d8", radius: 1.1, intensity: 4 },
        [fade(0.33)],
      ),
      layer(
        "pressure",
        "Fractured pressure shell",
        "shell",
        "primary",
        0.55,
        2.15,
        { ...hot, radius: 1.3, intensity: 1.6, turbulence: 0.8 },
        [
          curve("radius", [
            [0, 0.06],
            [0.35, 1.65],
            [1.6, 2.9],
          ]),
          curve(
            "erosion",
            [
              [0, 0.1],
              [0.35, 0.32],
              [1.6, 1],
            ],
            "smooth",
          ),
          fade(1.6),
        ],
      ),
      ...[0, 1, 2].map((i) =>
        layer(
          `shock-${i}`,
          ["Main shock front", "Secondary compression", "Fine outer front"][i],
          "ring",
          i ? "secondary" : "primary",
          0.55 + i * 0.065,
          2.2 + i * 0.2,
          {
            ...hot,
            width: i === 2 ? 0.025 : 0.095,
            rotation: [-Math.PI / 2, 0, 0],
            position: [0, -0.45 + i * 0.055, 0],
            intensity: 2 - i * 0.4,
            turbulence: 0.2,
          },
          [
            curve("radius", [
              [0, 0.05],
              [0.4, 2.1 - i * 0.25],
              [1.6, 3.8 - i * 0.3],
            ]),
            fade(1.65 + i * 0.135),
          ],
        ),
      ),
      layer(
        "sparks",
        "Molten radial streaks",
        "particles",
        "secondary",
        0.56,
        3,
        {
          ...hot,
          count: 2000,
          radius: 0.07,
          speed: 5.4,
          width: 0.026,
          length: 0.2,
          life: 2,
          gravity: -1.3,
          drag: 1.2,
          spread: 0.65,
          intensity: 2.3,
        },
      ),
      layer("embers", "Cooling embers", "particles", "residue", 0.8, 3, {
        ...hot,
        count: 400,
        radius: 0.7,
        width: 0.014,
        length: 0.03,
        speed: 0.7,
        life: 1.9,
        gravity: 0.3,
        emission: 0.2,
        intensity: 1.4,
        spread: 1,
      }),
      layer(
        "smoke",
        "Residual smoke",
        "sprite",
        "residue",
        0.7,
        3,
        {
          color: "#56545f",
          secondaryColor: "#222128",
          radius: 1.4,
          intensity: 0.5,
          blend: "normal",
          turbulence: 1.3,
        },
        [
          curve("radius", [
            [0, 0.5],
            [2.3, 2],
          ]),
          fade(2.3, 0.35),
        ],
      ),
    ];
  }
  if (id === "magic")
    base.layers = [
      layer(
        "sigil",
        "Engraved celestial seal",
        "decal",
        "primary",
        0,
        4.8,
        {
          radius: 2,
          rotation: [-Math.PI / 2, 0, 0],
          position: [0, -0.65, 0],
          color: "#c89dff",
          intensity: 1.7,
          spin: 0.12,
        },
        [fade(4.8, 0.65)],
      ),
      ...[0, 1, 2].map((i) =>
        layer(
          `circle-${i}`,
          ["Outer orbit", "Counter-rotating runes", "Inner orbit"][i],
          "ring",
          "secondary",
          0.2 * i,
          4.8,
          {
            radius: [2.05, 1.58, 0.9][i],
            width: [0.023, 0.04, 0.018][i],
            rotation: [-Math.PI / 2, 0, 0],
            position: [0, -0.6 + i * 0.04, 0],
            color: i === 1 ? "#ffd492" : "#c2a3ff",
            intensity: 1.6,
            spin: i % 2 ? -0.2 : 0.2,
            turbulence: 0.05,
          },
          [fade(4.8 - i * 0.2, 0.65)],
        ),
      ),
      layer(
        "portal",
        "Aurora veil",
        "shell",
        "primary",
        1.3,
        4.7,
        {
          radius: 1.2,
          color: "#896aff",
          secondaryColor: "#dd91ff",
          intensity: 1.2,
          turbulence: 0.8,
          erosion: 0.3,
        },
        [
          curve(
            "radius",
            [
              [0, 0.06],
              [0.5, 1.35],
              [3.4, 0.2],
            ],
            "smooth",
          ),
          fade(3.4, 0.3),
        ],
      ),
      layer(
        "pillar",
        "Axial light",
        "beam",
        "impact",
        1.45,
        3.1,
        {
          width: 0.13,
          length: 4,
          color: "#efceff",
          intensity: 1.4,
          position: [0, 0.4, 0],
        },
        [fade(1.65, 0.2)],
      ),
      layer(
        "ignite",
        "Seal activation",
        "sprite",
        "impact",
        1.45,
        2,
        {
          radius: 0.9,
          color: "#ffe5c3",
          intensity: 2.5,
          position: [0, -0.5, 0],
        },
        [fade(0.55)],
      ),
      layer("fireflies", "Ascending motes", "particles", "residue", 0.4, 5, {
        count: 1600,
        radius: 1.6,
        width: 0.023,
        length: 0.06,
        speed: 0.3,
        spread: 0.1,
        gravity: 0.65,
        drag: 0.5,
        life: 2,
        emission: 2.6,
        color: "#e0b3ff",
        intensity: 1.5,
      }),
      layer(
        "gold",
        "Gold orbital fragments",
        "particles",
        "secondary",
        1.4,
        4.8,
        {
          count: 320,
          radius: 1.9,
          width: 0.02,
          length: 0.08,
          speed: 0.2,
          spread: 0.05,
          gravity: 0.1,
          life: 2,
          emission: 1.3,
          color: "#ffcf8a",
          intensity: 2,
        },
      ),
    ];
  return validateDocument(base);
}

// Small authored construction examples. These are renderer fixtures, not benchmark generation results.
function createConstructionPreset(id: RecipeId): VfxDocument {
  const duration = ["beam", "portal"].includes(id) ? 5 : id === "water" ? 4 : 3;
  const base: VfxDocument = {
    schemaVersion: "autov.lab/1",
    name: RECIPES[id].name,
    description: RECIPES[id].prompt,
    seed: 419,
    duration,
    impact: 0.4,
    post: { bloom: 0.4, exposure: 0.9, background: "#101112" },
    layers: [],
  };
  const add = (value: Layer) => {
    base.layers.push(value);
    return value;
  };
  if (id === "lightning") {
    add(
      layer(
        "charge",
        "Charge",
        "sprite",
        "anticipation",
        0,
        0.4,
        { radius: 0.2, intensity: 1.2, position: [0, -0.7, 0] },
        [fade(0.4, 0.15)],
      ),
    );
    const bolt = add(
      layer(
        "bolt",
        "Lightning silhouette",
        "beam",
        "primary",
        0.4,
        0.6,
        {
          length: 3.5,
          width: 0.035,
          color: "#e9ffff",
          secondaryColor: "#129fff",
          position: [0, 1.05, 0],
          turbulence: 0.15,
          intensity: 1.6,
        },
        [fade(0.2, 0.015)],
      ),
    );
    bolt.geometry = "lightning";
    bolt.surface = "solid";
    add(
      layer(
        "ring",
        "Ground ring",
        "ring",
        "residue",
        0.45,
        1.7,
        {
          position: [0, -0.7, 0],
          rotation: [-Math.PI / 2, 0, 0],
          color: "#2cdfff",
          intensity: 1,
          width: 0.018,
        },
        [
          curve("radius", [
            [0, 0.1],
            [0.6, 1.4],
            [1.25, 1.7],
          ]),
          fade(1.25, 0.05),
        ],
      ),
    );
  } else if (id === "projectile") {
    const head = add(
      layer(
        "head",
        "Flame head",
        "shell",
        "primary",
        0.1,
        2.8,
        {
          radius: 0.65,
          length: 1.8,
          rotation: [0, 0, Math.PI / 2],
          position: [-0.5, 0, 0],
          color: "#fff19b",
          secondaryColor: "#ff520d",
          intensity: 1.1,
        },
        [fade(2.7, 0.25)],
      ),
    );
    head.geometry = "teardrop";
    head.surface = "flame";
    for (let i = 0; i < 3; i++) {
      const tail = add(
        layer(
          `tail-${i}`,
          "Flame wake",
          "shell",
          "secondary",
          0.1,
          2.8,
          {
            radius: 0.38 - i * 0.08,
            length: 2.5 - i * 0.3,
            rotation: [0, 0, -Math.PI / 2],
            position: [0.6 + i * 0.3, 0, 0],
            color: "#ff9d20",
            secondaryColor: "#b82204",
            intensity: 0.6,
            erosion: i * 0.1,
          },
          [fade(2.7, 0.3)],
        ),
      );
      tail.geometry = "cone";
      tail.surface = "flame";
    }
  } else if (id === "smoke") {
    for (let i = 0; i < 5; i++) {
      const puff = add(
        layer(
          `puff-${i}`,
          "Smoke billow",
          "sprite",
          i < 3 ? "primary" : "residue",
          0.15 + i * 0.08,
          2.9,
          {
            radius: 0.5 + i * 0.06,
            color: i < 2 ? "#dc70ce" : "#8563b7",
            secondaryColor: "#422947",
            intensity: 0.85,
            blend: "normal",
            turbulence: 1,
            position: [(i % 2 ? 1 : -1) * i * 0.17, -0.4, 0],
          },
          [
            fade(2.75 - i * 0.08, 0.2),
            curve("radius", [
              [0, 0.3],
              [0.8, 1.1 + i * 0.09],
              [2.75 - i * 0.08, 1.4 + i * 0.1],
            ]),
            curve("erosion", [
              [0, 0],
              [1.5, 0.1],
              [2.75 - i * 0.08, 0.9],
            ]),
          ],
        ),
      );
      puff.surface = "smoke";
      puff.motion = {
        keys: [
          [0, 0, 0, 0],
          [2.75 - i * 0.08, i * 0.08, 1.5 + i * 0.15, 0],
        ],
        ease: "linear",
      };
    }
  } else if (id === "water") {
    base.post = { bloom: 0.16, exposure: 0.95, background: "#101112" };
    const head = add(
      layer(
        "head",
        "Rounded water head",
        "shell",
        "primary",
        0,
        3.65,
        {
          position: [-0.6, 0, 0],
          radius: 0.46,
          length: 1.45,
          rotation: [0, 0, Math.PI / 2],
          color: "#ddffff",
          secondaryColor: "#21b8df",
          intensity: 1.15,
          turbulence: 0.65,
          blend: "normal",
          spin: 0,
        },
        [
          curve(
            "opacity",
            [
              [0, 0],
              [0.4, 1],
              [3, 0.95],
              [3.65, 0],
            ],
            "smooth",
          ),
          curve(
            "erosion",
            [
              [0, 0],
              [3, 0],
              [3.65, 1],
            ],
            "smooth",
          ),
        ],
      ),
    );
    head.geometry = "teardrop";
    head.surface = "water";
    const streaks = structuredClone(head);
    streaks.id = "head-highlights";
    streaks.name = "White water streaks";
    streaks.role = "secondary";
    streaks.surface = "water-streaks";
    streaks.params.radius *= 1.015;
    streaks.params.length *= 1.015;
    streaks.params.color = "#f5ffff";
    streaks.params.intensity = 0.95;
    add(streaks);

    for (let i = 0; i < 2; i++) {
      const tail = add(
        layer(
          `membrane-${i}`,
          "Connected water membrane",
          "shell",
          "secondary",
          0.06,
          3.85,
          {
            position: [0.55, -0.06 + i * 0.13, -0.06 - i * 0.04],
            radius: 0.43 - i * 0.08,
            length: 2.35 - i * 0.2,
            rotation: [0.16 * i, 0, -Math.PI / 2],
            color: i ? "#72e9ff" : "#18b8f5",
            secondaryColor: "#074cc5",
            intensity: 1,
            turbulence: 0.85 + i * 0.2,
            blend: "normal",
            spin: 0,
          },
          [
            curve(
              "opacity",
              [
                [0, 0],
                [0.34, 0.88],
                [2.94, 0.85],
                [3.79, 0],
              ],
              "smooth",
            ),
            curve(
              "erosion",
              [
                [0, 0],
                [3, 0],
                [3.79, 1],
              ],
              "smooth",
            ),
          ],
        ),
      );
      tail.geometry = "streamer";
      tail.surface = "water";
    }
    for (let i = 0; i < 3; i++) {
      const start = 0.4 + i * 0.4,
        end = 3.9;
      const droplet = add(
        layer(
          `droplet-${i}`,
          "Rounded trailing droplet",
          "shell",
          "residue",
          start,
          end,
          {
            position: [0.65 + i * 0.23, 0.1 * (i - 1), 0.04],
            radius: 0.065 + i * 0.014,
            length: 0.17 + i * 0.03,
            rotation: [0, 0, Math.PI / 2],
            color: "#9cedff",
            secondaryColor: "#075dd5",
            intensity: 1,
            turbulence: 0.2,
            blend: "normal",
            spin: 0,
          },
          [fade(end - start, 0.2)],
        ),
      );
      droplet.geometry = "teardrop";
      droplet.surface = "water";
      droplet.motion = {
        keys: [
          [0, 0, 0, 0],
          [end - start, 0.7 + i * 0.12, 0.07 * (i - 1), 0],
        ],
        ease: "linear",
      };
    }
  } else if (id === "beam") {
    base.impact = 1;
    for (let i = 0; i < 2; i++)
      add(
        layer(
          `beam-${i}`,
          i ? "White core" : "Magenta beam",
          "beam",
          "primary",
          1,
          4,
          {
            rotation: [0, 0, Math.PI / 2],
            width: i ? 0.04 : 0.18,
            length: 5,
            color: i ? "#fff4ff" : "#dd32f7",
            secondaryColor: "#741099",
            intensity: i ? 1.8 : 1.1,
          },
          [
            fade(3, 0.2),
            curve("length", [
              [0, 0.02],
              [0.2, 5],
              [2.5, 5],
              [3, 0.02],
            ]),
          ],
        ),
      );
    add(
      layer(
        "charge",
        "Emitter charge",
        "sprite",
        "anticipation",
        0,
        1.2,
        {
          position: [2.5, 0, 0],
          radius: 0.35,
          color: "#c472ff",
          intensity: 1.4,
        },
        [fade(1.2, 0.35)],
      ),
    );
  } else {
    base.impact = 0.7;
    const portal = add(
      layer(
        "opening",
        "Amber opening",
        "decal",
        "primary",
        0,
        5,
        {
          radius: 1,
          length: 3.2,
          color: "#ffd46e",
          secondaryColor: "#bf710e",
          intensity: 1.2,
          rotation: [0, 0.25, 0],
        },
        [fade(5, 0.7)],
      ),
    );
    portal.geometry = "plane";
    portal.surface = "portal";
  }
  return validateDocument(base);
}
