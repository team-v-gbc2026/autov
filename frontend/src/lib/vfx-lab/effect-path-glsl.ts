import { PATH_SAMPLES } from "./effect-path";
/** Identical table interpolation to pathFrameAt. Endpoint extrapolation avoids
 * piling live particles onto a clamped endpoint. No native curve logic here. */
export const effectPathGLSL = /* glsl */ `
uniform int uEffectPathMode,uEffectPathSpread;
uniform float uEffectPathLength,uEffectPathBaseLength;
// One buffer keeps trail materials within WebGPU per-stage binding limits.
uniform vec3 uEffectPathData[${PATH_SAMPLES * 3}];
void effectPathFrame(float d, out vec3 pathPositionOut, out vec3 pathNormalOut, out vec3 pathTangentOut){
  float x=clamp(d/uEffectPathLength,0.,1.)*float(${PATH_SAMPLES - 1});
  int i=int(min(floor(x),float(${PATH_SAMPLES - 2})));
  float f=x-float(i);
  pathTangentOut=normalize(mix(uEffectPathData[i*3+2],uEffectPathData[(i+1)*3+2],f));
  pathNormalOut=mix(uEffectPathData[i*3+1],uEffectPathData[(i+1)*3+1],f);
  pathNormalOut=normalize(pathNormalOut-pathTangentOut*dot(pathNormalOut,pathTangentOut));
  pathPositionOut=mix(uEffectPathData[i*3+0],uEffectPathData[(i+1)*3+0],f)+pathTangentOut*(d-clamp(d,0.,uEffectPathLength));
}
vec3 effectPathVector(vec3 v,vec3 n,vec3 t){ return n*v.x+cross(t,n)*v.y+t*v.z; }
`;
