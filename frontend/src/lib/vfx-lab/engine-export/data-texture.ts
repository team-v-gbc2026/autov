import * as THREE from 'three/webgpu';

/** Store data textures as raw RGBA float32, preserving signed/HDR site data. */
export function dataTextureBytes(texture: THREE.DataTexture) {
  const {width,height,data}=texture.image;
  if(!data||!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)
    throw new Error('Missing or invalid data texture image');
  const channels=data.length/(width*height);
  if(![1,2,3,4].includes(channels)) throw new Error('Unsupported data texture channel count');
  const supported=new Set<number>([THREE.UnsignedByteType,THREE.FloatType,THREE.HalfFloatType]);
  if(!supported.has(texture.type)) throw new Error('Unsupported data texture numeric type');
  const pixels=new Float32Array(width*height*4);
  for(let pixel=0;pixel<width*height;pixel++) for(let c=0;c<4;c++) {
    const target=texture.flipY?(height-1-Math.floor(pixel/width))*width+pixel%width:pixel;
    let value=c<channels?Number(data[pixel*channels+c]):c===3?1:0;
    if(c<channels&&texture.type===THREE.UnsignedByteType) value/=255;
    if(c<channels&&texture.type===THREE.HalfFloatType) value=THREE.DataUtils.fromHalfFloat(value);
    if(!Number.isFinite(value)) throw new Error('Non-finite data texture value');
    pixels[target*4+c]=value;
  }
  return {pixels,width,height};
}
