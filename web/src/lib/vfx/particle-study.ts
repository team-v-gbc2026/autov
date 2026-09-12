import * as THREE from "three/webgpu";
import { color, instancedBufferAttribute, uniform, uv, vec2, vec3 } from "three/tsl";

export const EFFECT_DURATION = 8;
export const PARTICLE_COUNT = 12000;

/** Analytic motion makes every frame seekable without simulation history. */
export function createParticleStudy() {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const seeds = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const y = 1 - 2 * (i + .5) / PARTICLE_COUNT;
    const r = Math.sqrt(1 - y * y);
    positions.set([Math.cos(angle) * r, y, Math.sin(angle) * r], i * 3);
    seeds[i] = (i * .61803398875) % 1;
  }
  const clock = uniform(0);
  const position = instancedBufferAttribute(new THREE.InstancedBufferAttribute(positions, 3), "vec3" as const);
  const seed = instancedBufferAttribute(new THREE.InstancedBufferAttribute(seeds, 1), "float" as const);
  const phase = clock.mul(2 * Math.PI / EFFECT_DURATION);
  const wave = position.y.mul(11).add(seed.mul(6.28)).add(phase).sin();
  const radius = wave.mul(.1).add(1.55);
  const angle = phase.add(position.y.mul(.35));
  const x = position.x.mul(angle.cos()).sub(position.z.mul(angle.sin()));
  const z = position.x.mul(angle.sin()).add(position.z.mul(angle.cos()));
  const material = new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  material.positionNode = vec3(x, position.y, z).mul(radius);
  material.scaleNode = vec2(seed.mul(.009).add(.009));
  material.colorNode = color("#dce4ec").mul(seed.mul(.5).add(.65));
  material.opacityNode = uv().sub(.5).length().mul(2).oneMinus().max(0).pow(1.8).mul(.8);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, PARTICLE_COUNT);
  mesh.frustumCulled = false;
  mesh.rotation.z = -.22;
  mesh.name = "Silver particle study";
  return {
    object: mesh,
    update(seconds: number) { clock.value = seconds; },
    dispose() { mesh.dispose(); geometry.dispose(); material.dispose(); },
  };
}
