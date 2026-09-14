import * as THREE from "three/webgpu";
import type { IUniform } from "three";

export const SMOKE_LIGHT_LIMIT = 4;
export function smokeLightingUniforms(
  lit: boolean,
  card = true,
): Record<string, IUniform> {
  return {
    uSmokeLit: { value: lit ? 1 : 0 },
    uSmokeCard: { value: card ? 1 : 0 },
    uSmokeAmbient: { value: 0 },
    uSmokeRight: { value: new THREE.Vector3(1, 0, 0) },
    uSmokeUp: { value: new THREE.Vector3(0, 1, 0) },
    uSmokeForward: { value: new THREE.Vector3(0, 0, 1) },
    uSmokeLightPosition: {
      value: Array.from(
        { length: SMOKE_LIGHT_LIMIT },
        () => new THREE.Vector4(),
      ),
    },
    uSmokeLightColor: {
      value: Array.from(
        { length: SMOKE_LIGHT_LIMIT },
        () => new THREE.Vector4(),
      ),
    },
  };
}

/** Bounded approximate diffuse smoke shading. No shadows or volume transport. */
export function updateSmokeLighting(
  scene: THREE.Scene,
  camera: THREE.Camera,
  ambient: number,
) {
  const candidates: THREE.PointLight[] = [];
  scene.updateMatrixWorld();
  scene.traverseVisible((object) => {
    if (object instanceof THREE.PointLight && object.intensity > 0)
      candidates.push(object);
  });
  const lights = candidates
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, SMOKE_LIGHT_LIMIT);
  camera.updateMatrixWorld();
  scene.traverse((object) => {
    const uniforms = (
      (object as THREE.Mesh).material as THREE.NodeMaterial & {
        uniforms?: Record<string, IUniform>;
      }
    )?.uniforms;
    if (!uniforms?.uSmokeLit?.value) return;
    uniforms.uSmokeAmbient.value = Math.max(0, ambient) * 0.3;
    (uniforms.uSmokeRight.value as THREE.Vector3).setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    (uniforms.uSmokeUp.value as THREE.Vector3).setFromMatrixColumn(
      camera.matrixWorld,
      1,
    );
    (uniforms.uSmokeForward.value as THREE.Vector3).setFromMatrixColumn(
      camera.matrixWorld,
      2,
    );
    for (let i = 0; i < SMOKE_LIGHT_LIMIT; i++) {
      const position = uniforms.uSmokeLightPosition.value[i] as THREE.Vector4;
      const color = uniforms.uSmokeLightColor.value[i] as THREE.Vector4;
      const light = lights[i];
      if (!light) {
        position.set(0, 0, 0, 1);
        color.set(0, 0, 0, 2);
        continue;
      }
      const elements = light.matrixWorld.elements;
      position.set(
        elements[12],
        elements[13],
        elements[14],
        light.distance > 0 ? light.distance : 1e10,
      );
      color.set(
        light.color.r * light.intensity,
        light.color.g * light.intensity,
        light.color.b * light.intensity,
        light.decay,
      );
    }
  });
}
