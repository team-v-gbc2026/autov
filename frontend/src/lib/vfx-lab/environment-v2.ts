import * as THREE from "three/webgpu";
import {
  uniform,
  positionWorld,
  abs,
  fract,
  fwidth,
  max,
  min,
  mix,
} from "three/tsl";
import type { VfxDocumentV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// Scene dressing for the v2 renderer: background, fog, ground plane (with a
// procedural grid patched into MeshStandardMaterial) and the hemisphere fill
// that keeps the grid readable while the effect's own lights flicker.
// ---------------------------------------------------------------------------

/**
 * Fill light strength at environment.ambient = 1; the grid reads as a lit
 * surface rather than a decal. The document scales it from there.
 */
const HEMISPHERE_INTENSITY = 5;
const GROUND_SIZE = 60;

export interface EnvironmentV2 {
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>;
  fill: THREE.HemisphereLight;
  apply(doc: VfxDocumentV2, scene: THREE.Scene, showGround: boolean): void;
  dispose(): void;
}

export function createEnvironment(scene: THREE.Scene): EnvironmentV2 {
  const gridColor = uniform(new THREE.Color("#737779"));
  const groundColor = uniform(new THREE.Color("#484b4e"));
  const gridOn = uniform(1);
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0,
  });
  const grid = (scale: number) => {
    const p = positionWorld.xz.mul(scale);
    const g = abs(fract(p.sub(0.5)).sub(0.5)).div(max(fwidth(p), 1e-5));
    return min(min(g.x, g.y), 1).oneMinus();
  };
  material.colorNode = mix(
    groundColor,
    gridColor,
    grid(1).mul(0.32).add(grid(4).mul(0.06)).mul(gridOn),
  );
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    material,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = "environment-ground";
  scene.add(ground);

  const fill = new THREE.HemisphereLight(
    new THREE.Color("#909090"),
    new THREE.Color("#383838"),
    HEMISPHERE_INTENSITY,
  );
  scene.add(fill);

  return {
    ground,
    fill,
    apply(doc, target, showGround) {
      target.background = new THREE.Color(doc.environment.background);
      const fog = doc.environment.fog;
      target.fog =
        fog.density > 0
          ? new THREE.FogExp2(new THREE.Color(fog.color).getHex(), fog.density)
          : null;
      gridOn.value = doc.environment.ground === "grid" ? 1 : 0;
      groundColor.value.set(doc.environment.groundColor);
      ground.position.y = doc.environment.groundY;
      ground.visible = showGround && doc.environment.ground !== "none";
      fill.intensity = HEMISPHERE_INTENSITY * doc.environment.ambient;
      fill.visible = showGround;
    },
    dispose() {
      ground.geometry.dispose();
      material.dispose();
      ground.removeFromParent();
      fill.removeFromParent();
      fill.dispose();
    },
  };
}
