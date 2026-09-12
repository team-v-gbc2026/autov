import * as THREE from "three";
import type { Layer } from "./schema";
import { random } from "./evaluate";

// Bounded, deterministic meshes. No model download, arbitrary code, or frame-dependent simulation.
export function buildGeometry(layer: Layer, seed: number): THREE.BufferGeometry {
  switch (layer.geometry) {
    case "plane": return new THREE.PlaneGeometry(2,2);
    case "teardrop": return new THREE.LatheGeometry([
      new THREE.Vector2(0,-1),new THREE.Vector2(.22,-.85),new THREE.Vector2(.68,-.45),new THREE.Vector2(.95,0),new THREE.Vector2(.85,.4),new THREE.Vector2(.52,.8),new THREE.Vector2(0,1),
    ],40);
    case "cone": return new THREE.ConeGeometry(1, 2, 24, 4, true);
    case "crystal": return new THREE.CylinderGeometry(0, .45, 2, 5, 1, false);
    case "torus": return new THREE.TorusGeometry(.78, Math.min(.35, layer.params.width / layer.params.radius), 8, 64);
    case "ribbon": {
      const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
      const segments = 64, arc = layer.params.arc;
      for (let i=0; i<=segments; i++) {
        const u=i/segments, a=u*arc, taper=Math.pow(Math.sin(Math.PI*u), .6);
        const width=Math.max(.003, layer.params.width / layer.params.radius * taper);
        for (const side of [-1,1]) {
          const radius=.72 + side*width;
          positions.push(Math.cos(a)*radius, Math.sin(a)*radius, .12*Math.sin(a*2));
          uvs.push(u, (side+1)/2);
        }
        if(i<segments) { const j=i*2; indices.push(j,j+1,j+2,j+1,j+3,j+2); }
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
      g.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
      g.setIndex(indices); g.computeVertexNormals(); return g;
    }
    case "lightning": {
      const paths: THREE.BufferGeometry[] = [];
      const points = Array.from({length:13},(_,i) => new THREE.Vector3(
        i===0 || i===12 ? 0 : (random(seed,layer.id,i,"bolt")-.5)*.6,
        1-i/6,
        (random(seed,layer.id,i,"depth")-.5)*.12,
      ));
      // A piecewise linear tube gives sharp bends and real depth, with the same seed at every seek.
      const make = (points: THREE.Vector3[], radius: number) => {
        const curve = new THREE.CurvePath<THREE.Vector3>();
        for (let i=1;i<points.length;i++) curve.add(new THREE.LineCurve3(points[i-1],points[i]));
        return new THREE.TubeGeometry(curve, points.length*3, radius, 4, false).toNonIndexed();
      };
      const width=Math.max(.006, Math.min(.12,layer.params.width));
      paths.push(make(points,width));
      for (const index of (layer.params.turbulence < .3 ? [] : [3,7])) {
        const base=points[index];
        const side=index===3 ? -1 : 1;
        paths.push(make([base,base.clone().add(new THREE.Vector3(.3*side,-.2,0)),base.clone().add(new THREE.Vector3(.55*side,-.6,.1))],width*.4));
      }
      const result = new THREE.BufferGeometry();
      for (const name of ["position","normal","uv"]) {
        const arrays=paths.map(g => g.getAttribute(name));
        const merged=new Float32Array(arrays.reduce((n,a)=>n+a.array.length,0));
        let cursor=0; for(const a of arrays) { merged.set(a.array,cursor); cursor+=a.array.length; }
        result.setAttribute(name,new THREE.BufferAttribute(merged,arrays[0].itemSize));
      }
      paths.forEach(g=>g.dispose()); return result;
    }
    default: return layer.kind === "shell" ? new THREE.SphereGeometry(1,48,28) : new THREE.PlaneGeometry(2,2);
  }
}
