/** Lossless data PNG; canvas encoding cannot preserve RGB bytes when alpha=0. */
export async function floatDataPng(values: Float32Array, width = 1024) {
  const height = Math.max(1, Math.ceil(values.length / width));
  const bytes = new Uint8Array(width * height * 4);
  const view = new DataView(bytes.buffer);
  for (let i=0;i<values.length;i++) view.setFloat32(i*4,values[i],true);
  const scan = new Uint8Array(height*(width*4+1));
  for(let y=0;y<height;y++) scan.set(bytes.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);
  const compressed = new Uint8Array(await new Response(new Blob([scan]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const encoder = new TextEncoder();
  function chunk(type: string, data: Uint8Array) {
    const out = new Uint8Array(data.length+12); const v=new DataView(out.buffer);
    v.setUint32(0,data.length); out.set(encoder.encode(type),4); out.set(data,8);
    let crc=0xffffffff; for(const byte of out.subarray(4,out.length-4)) { crc^=byte; for(let b=0;b<8;b++)crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
    v.setUint32(out.length-4,(crc^0xffffffff)>>>0); return out;
  }
  const header=new Uint8Array(13);const hv=new DataView(header.buffer);hv.setUint32(0,width);hv.setUint32(4,height);header[8]=8;header[9]=6;
  return { blob: new Blob([new Uint8Array([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",compressed),chunk("IEND",new Uint8Array())],{type:"image/png"}), width,height };
}
/** Minimal glTF 2.0 binary mesh with UV0 plus an exact float32 particle index in UV1. */
export function particleGlb(positions: number[], normals: number[], uv: number[], indices: number[]) {
  const count=positions.length/3;
  const indexUv=Array.from({length:count*2},(_,i)=>i%2===0?Math.floor(i/2/4):0);
  const arrays=[new Float32Array(positions),new Float32Array(normals),new Float32Array(uv),new Float32Array(indexUv),new Uint32Array(indices)];
  let offset=0;const views=arrays.map(a=>{const v={buffer:0,byteOffset:offset,byteLength:a.byteLength};offset+=a.byteLength;return v;});
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i++){min[i%3]=Math.min(min[i%3],positions[i]);max[i%3]=Math.max(max[i%3],positions[i]);}
  const gltf={asset:{version:"2.0",generator:"autoV native export"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2,TEXCOORD_1:3},indices:4}]}],buffers:[{byteLength:offset}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count,type:"VEC3",min,max},{bufferView:1,componentType:5126,count,type:"VEC3"},{bufferView:2,componentType:5126,count,type:"VEC2"},{bufferView:3,componentType:5126,count,type:"VEC2"},{bufferView:4,componentType:5125,count:indices.length,type:"SCALAR"}]};
  const encoded=new TextEncoder().encode(JSON.stringify(gltf));const jsonLength=Math.ceil(encoded.length/4)*4;const out=new Uint8Array(12+8+jsonLength+8+offset);const v=new DataView(out.buffer);
  v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);v.setUint32(12,jsonLength,true);v.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jsonLength);out.set(encoded,20);v.setUint32(20+jsonLength,offset,true);v.setUint32(24+jsonLength,0x004e4942,true);let start=28+jsonLength;for(const a of arrays){out.set(new Uint8Array(a.buffer),start);start+=a.byteLength;}return new Blob([out],{type:"model/gltf-binary"});
}
