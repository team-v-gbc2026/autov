/** Small deterministic ZIP (STORE) writer. No compression dependency, ZIP64,
 * timestamps, platform paths or executable entries. .avfx is an ordinary ZIP. */
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export function jsonBytes(value: unknown) { return encoder.encode(JSON.stringify(value)); }

export function zipStore(files: ReadonlyMap<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  if (files.size > 65535) throw new Error("Too many AVFX files (ZIP64 is not supported).");
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(path) || path.startsWith("/") || path.split("/").includes(".."))
      throw new Error(`Unsafe bundle path: ${path}`);
    const name = encoder.encode(path), crc = crc32(data);
    if (name.length > 65535 || data.length + offset > 0xffffffff) throw new Error("AVFX exceeds ZIP32 limits.");
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
    h.setUint16(12, 33, true); // 1980-01-01
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    local.push(header, name, data);
    const entry = new Uint8Array(46), c = new DataView(entry.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(14, 33, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(entry, name);
    offset += header.length + name.length + data.length;
  }
  const directory = concat(central), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.size, true); e.setUint16(10, files.size, true);
  e.setUint32(12, directory.length, true); e.setUint32(16, offset, true);
  return concat([...local, directory, end]);
}

export type PackedAttribute = { itemSize: number; count: number; values: number[] };
export type PackedMesh = { attributes: Record<string, PackedAttribute>; indices: number[] | null };

/** Geometry-only glTF 2.0. Shader materials/instances live in layer JSON, not
 * in a misleading PBR approximation. All custom attributes use glTF's _ prefix. */
export function meshGlb(mesh: PackedMesh): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const bufferViews: object[] = [], accessors: object[] = [];
  const attributes: Record<string, number> = {}, attributeMap: Record<string, string> = {};
  let byteLength = 0;
  function accessor(values: number[], itemSize: number, index = false) {
    const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
    values.forEach((value, i) => index ? view.setUint32(i * 4, value, true) : view.setFloat32(i * 4, value, true));
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target: index ? 34963 : 34962 });
    chunks.push(bytes); byteLength += bytes.length;
    const min = Array.from({ length: itemSize }, () => Infinity), max = min.map(() => -Infinity);
    values.forEach((v, i) => { min[i % itemSize] = Math.min(min[i % itemSize], v); max[i % itemSize] = Math.max(max[i % itemSize], v); });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: index ? 5125 : 5126,
      count: values.length / itemSize, type: ["", "SCALAR", "VEC2", "VEC3", "VEC4"][itemSize], min, max });
    return accessors.length - 1;
  }
  for (const [name, attr] of Object.entries(mesh.attributes)) {
    if (attr.itemSize < 1 || attr.itemSize > 4 || !attr.count) throw new Error(`Invalid mesh attribute: ${name}`);
    const semantic = ({ position: "POSITION", normal: "NORMAL", uv: "TEXCOORD_0", color: "COLOR_0" } as Record<string, string>)[name] ?? `_${name.toUpperCase()}`;
    attributeMap[name] = semantic;
    attributes[semantic] = accessor(attr.values, attr.itemSize);
  }
  const indices = mesh.indices ? accessor(mesh.indices, 1, true) : undefined;
  const json = jsonBytes({ asset: { version: "2.0", generator: "autoV AVFX" }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes, ...(indices === undefined ? {} : { indices }), mode: 4 }], extras: { attributeMap } }],
    buffers: [{ byteLength }], bufferViews, accessors });
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(32); padded.set(json);
  const header = new Uint8Array(20), h = new DataView(header.buffer);
  h.setUint32(0, 0x46546c67, true); h.setUint32(4, 2, true); h.setUint32(8, 28 + padded.length + byteLength, true);
  h.setUint32(12, padded.length, true); h.setUint32(16, 0x4e4f534a, true);
  const binHeader = new Uint8Array(8), b = new DataView(binHeader.buffer);
  b.setUint32(0, byteLength, true); b.setUint32(4, 0x004e4942, true);
  return concat([header, padded, binHeader, ...chunks]);
}
