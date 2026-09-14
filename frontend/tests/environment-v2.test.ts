import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { createEnvironment } from "../src/lib/vfx-lab/environment-v2";
import { createPresetV2 } from "../src/lib/vfx-lab/recipes-v2";

test("environment edits preserve the fog identity used by WebGPU's node cache", () => {
  const scene = new THREE.Scene();
  const environment = createEnvironment(scene);
  const doc = createPresetV2("fire-projectile");
  try {
    doc.environment.fog.density = 0.03;
    environment.apply(doc, scene, true);
    const fog = scene.fog as THREE.FogExp2;
    const background = scene.background;
    for (let frame = 0; frame < 60; frame++) environment.apply(doc, scene, true);
    assert.equal(scene.fog, fog);
    assert.equal(scene.background, background);

    doc.environment.fog = { color: "#123456", density: 0.08 };
    environment.apply(doc, scene, true);
    assert.equal(scene.fog, fog);
    assert.equal(fog.color.getHexString(), "123456");
    assert.equal(fog.density, 0.08);

    doc.environment.fog.density = 0;
    environment.apply(doc, scene, false);
    assert.equal(scene.fog, null);
    assert.equal(environment.ground.visible, false);
    doc.environment.fog.density = 0.02;
    environment.apply(doc, scene, true);
    assert.equal(scene.fog, fog);
    assert.equal(fog.density, 0.02);
  } finally {
    environment.dispose();
  }
});
