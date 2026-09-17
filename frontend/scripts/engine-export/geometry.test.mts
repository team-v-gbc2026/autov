import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { geometryData } from '../../src/lib/vfx-lab/engine-export/geometry';
import { sampleTimes } from '../../src/lib/vfx-lab/engine-export/types';
import { dataTextureBytes } from '../../src/lib/vfx-lab/engine-export/data-texture';

test('each expanded quad retains its own interleaved particle seed', () => {
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  g.setIndex(plane.index); g.instanceCount = 2;
  const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array([11,12,99,21,22,98]),3,1);
  g.setAttribute('seed',new THREE.InterleavedBufferAttribute(buffer,2,0));
  const result = geometryData(new THREE.Mesh(g));
  assert.deepEqual(result.attributeIndex,[0,0,0,0,1,1,1,1]);
  assert.deepEqual(result.attributes.seed.values,[11,12,21,22]);
  assert.deepEqual(result.indices.slice(6),result.indices.slice(0,6).map(i=>i+4));
  assert.equal(result.positions.length,24);
});

test('sampling includes the exact end without exceeding duration', () => {
  const times = sampleTimes(1.01,15);
  assert.equal(times[0],0); assert.equal(times.at(-1),1.01);
  assert.equal(new Set(times).size,times.length);
  assert.ok(times.every(t=>t<=1.01));
  assert.throws(()=>sampleTimes(Infinity,30)); assert.throws(()=>sampleTimes(1,0));
});

test('an emitter before its first birth exports an empty frame', () => {
  const base = new THREE.PlaneGeometry(1,1);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position',base.getAttribute('position'));
  g.setIndex(base.index); g.instanceCount=0;
  const frame=geometryData(new THREE.Mesh(g));
  assert.deepEqual(frame.positions,[]); assert.deepEqual(frame.indices,[]);
});

test('mixed strip vertex and instance fields reconstruct without loss', () => {
  const base = new THREE.PlaneGeometry(1,1);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position',base.getAttribute('position'));
  g.setAttribute('along',new THREE.Float32BufferAttribute([0,1,2,3],1));
  g.setAttribute('seed',new THREE.InstancedBufferAttribute(new Float32Array([10,20]),1));
  g.instanceCount=2; g.setIndex(base.index);
  const frame=geometryData(new THREE.Mesh(g));
  const reconstructed=frame.attributeIndex.map(i=>[frame.attributes.along.values[i],frame.attributes.seed.values[i]]);
  assert.deepEqual(reconstructed,[[0,10],[1,10],[2,10],[3,10],[0,20],[1,20],[2,20],[3,20]]);
});

test('data texture export retains signed positions and HDR values', () => {
  const values=new Float32Array([-12.5,0.125,32,1,2,3,4,5]);
  const texture=new THREE.DataTexture(values,1,2,THREE.RGBAFormat,THREE.FloatType);
  assert.deepEqual(dataTextureBytes(texture).pixels,values);
  texture.flipY=true;
  assert.deepEqual([...dataTextureBytes(texture).pixels],[2,3,4,5,-12.5,0.125,32,1]);
});
