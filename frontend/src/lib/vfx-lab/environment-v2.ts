import * as THREE from "three";
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
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  fill: THREE.HemisphereLight;
  apply(doc: VfxDocumentV2, scene: THREE.Scene, showGround: boolean): void;
  dispose(): void;
}

export function createEnvironment(scene: THREE.Scene): EnvironmentV2 {
  const gridColor = { value: new THREE.Color("#9a9cab") };
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#4a4952"),
    roughness: 0.9,
    metalness: 0,
  });
  const gridOn = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = gridColor;
    shader.uniforms.uGridOn = gridOn;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvWp=(modelMatrix*vec4(transformed,1.)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uGrid; uniform float uGridOn; varying vec3 vWp;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 g=abs(fract(vWp.xz*1.0-0.5)-0.5)/max(fwidth(vWp.xz*1.0),vec2(1e-5));
        float line=1.-min(min(g.x,g.y),1.);
        vec2 g2=abs(fract(vWp.xz*4.0-0.5)-0.5)/max(fwidth(vWp.xz*4.0),vec2(1e-5));
        float line2=1.-min(min(g2.x,g2.y),1.);
        diffuseColor.rgb=mix(diffuseColor.rgb, uGrid, (line*0.30+line2*0.07)*uGridOn);`,
      );
  };
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    material,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.name = "environment-ground";
  scene.add(ground);

  const fill = new THREE.HemisphereLight(
    new THREE.Color("#8a8894"),
    new THREE.Color("#3a3840"),
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
      material.color.set(doc.environment.groundColor);
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
