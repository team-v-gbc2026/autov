import * as THREE from "three/webgpu";
import type { GeometryData } from "./types";

export function geometryData(mesh: THREE.Mesh): GeometryData {
  const g = mesh.geometry;
  const instanceCount = (g as THREE.InstancedBufferGeometry).isInstancedBufferGeometry
    ? (g as THREE.InstancedBufferGeometry).instanceCount : 1;
  if (!Number.isFinite(instanceCount) || instanceCount < 0) throw new Error("Invalid particle count.");
  const count = g.getAttribute("position").count;
  if (count * instanceCount > 1_000_000) throw new Error("This draw exceeds the one-million-vertex export limit.");
  const attributes: GeometryData["attributes"] = {};
  const sourceAttributes = Object.entries(g.attributes).map(([key,a]) => {
    const interleaved = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
      ? (a as THREE.InterleavedBufferAttribute).data as THREE.InstancedInterleavedBuffer & { isInstancedInterleavedBuffer?: boolean } : undefined;
    const divisor = interleaved?.isInstancedInterleavedBuffer ? interleaved.meshPerAttribute
      : (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute
        ? (a as THREE.InstancedBufferAttribute).meshPerAttribute : 0;
    attributes[key] = { size:a.itemSize, values:[] };
    return {key,a,divisor,custom:!["position","normal","uv"].includes(key)};
  });
  const custom = sourceAttributes.filter(a=>a.custom);
  const rows = new Map<string,number>();
  const attributeIndex: number[] = [];
  for(let instance=0;instance<instanceCount;instance++) for(let vertex=0;vertex<count;vertex++) {
    const sourceIndex=(a:typeof sourceAttributes[number])=>a.divisor?Math.floor(instance/a.divisor):vertex;
    // A seed shared by every vertex of a particle is stored only once. Mixed
    // per-vertex and per-instance inputs (strips/crystals) keep distinct rows.
    const key=custom.map(a=>sourceIndex(a)).join(",");
    let row=rows.get(key);
    const fresh=row===undefined;
    if(fresh) { row=rows.size; rows.set(key,row); }
    attributeIndex.push(row!);
    for(const source of sourceAttributes) {
      if(source.custom&&!fresh) continue;
      const index=sourceIndex(source);
      for(let c=0;c<source.a.itemSize;c++) attributes[source.key].values.push(source.a.getComponent(index,c));
    }
  }
  const indices: number[] = [];
  const source = g.index ? Array.from(g.index.array) : Array.from({ length: count }, (_, i) => i);
  const start = g.drawRange.start, end = Math.min(source.length, start + g.drawRange.count);
  for (let instance = 0; instance < instanceCount; instance++)
    for (let i = start; i < end; i++) indices.push(source[i] + instance * count);
  const result: GeometryData = {
    baseGeometry: -1, attributeIndex,
    positions: attributes.position.values,
    normals: attributes.normal?.values ?? Array(count * instanceCount * 3).fill(0),
    uv: attributes.uv?.values ?? Array(count * instanceCount * 2).fill(0),
    indices, attributes: Object.fromEntries(Object.entries(attributes).filter(([k]) => !["position", "normal", "uv"].includes(k))),
    primitive: (mesh as unknown as THREE.LineSegments).isLineSegments ? "lines" : "triangles",
  };
  return result;
}
