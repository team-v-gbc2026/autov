import * as THREE from "three";
import type { Curve, Ramp } from "./schema-v2";

// ---------------------------------------------------------------------------
// GLSL for the autov.lab/2 renderer.
//
// Everything here is a pure function of (uniforms, attributes, time): no
// feedback buffers, no per-frame accumulation. A particle that is not alive at
// the sampled time is pushed to clip space (2,2,2,1) so it never rasterizes,
// and every pow()/normalize() guards its input so a degenerate document can
// not produce NaN (which would show up as a black or white frame).
// ---------------------------------------------------------------------------

/** Curves carry at most 8 keys, ramps at most 6 stops (schema-v2 bounds). */
export const CURVE_KEYS = 8;
export const RAMP_STOPS = 6;

export const glslNoise = /* glsl */ `
vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute289(vec4 x){return mod289v4(((x*34.)+1.)*x);}
vec4 taylorInvSqrtV(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289v3(i);
  vec4 p=permute289(permute289(permute289(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrtV(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm3(vec3 p){ return .5*snoise(p)+.25*snoise(p*2.02+7.)+.125*snoise(p*4.05+3.)+.0625*snoise(p*8.1+1.); }
vec3 curl3(vec3 p){
  float e=.1;
  vec3 dx=vec3(e,0.,0.), dy=vec3(0.,e,0.), dz=vec3(0.,0.,e);
  float dady=snoise(p+dy)-snoise(p-dy), dadz=snoise(p+dz)-snoise(p-dz);
  float dbdx=snoise(p+dx+31.4)-snoise(p-dx+31.4), dbdz=snoise(p+dz+31.4)-snoise(p-dz+31.4);
  float dcdx=snoise(p+dx-17.2)-snoise(p-dx-17.2), dcdy=snoise(p+dy-17.2)-snoise(p-dy-17.2);
  return vec3(dcdy-dbdz, dadz-dcdx, dbdx-dady)/(2.*e);
}
/** normalize() with a defined result for the zero vector. */
vec3 safeDir(vec3 v, vec3 fallback){ float l=length(v); return l>1e-5 ? v/l : fallback; }
/** pow() that can never see a negative base. */
float safePow(float base, float e){ return pow(max(base,1e-5), e); }
`;

export const glslRamp = /* glsl */ `
uniform vec4 uRamp[${RAMP_STOPS}]; uniform float uRampT[${RAMP_STOPS}]; uniform int uRampN;
vec3 rampColor(float u){
  u=clamp(u,0.,1.);
  vec3 c=uRamp[0].rgb*uRamp[0].a; float prev=uRampT[0];
  for(int i=1;i<${RAMP_STOPS};i++){
    if(i>=uRampN) break;
    float t=uRampT[i]; vec3 ci=uRamp[i].rgb*uRamp[i].a;
    c=mix(c,ci,smoothstep(prev,max(t,prev+1e-4),u)); prev=t;
  }
  return c;
}
`;

/** One uniform array + lookup per curve slot, mirroring the spike's layout. */
export function glslCurve(name: string) {
  return /* glsl */ `
uniform vec2 uCurve${name}[${CURVE_KEYS}]; uniform int uCurve${name}N; uniform float uCurve${name}Ease;
float curve${name}(float u){
  u=clamp(u,0.,1.); float v=uCurve${name}[0].y;
  for(int i=1;i<${CURVE_KEYS};i++){
    if(i>=uCurve${name}N) break;
    float a=uCurve${name}[i-1].x, b=uCurve${name}[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurve${name}Ease);
    v=mix(v,uCurve${name}[i].y,step(a,u)*f);
  }
  return v;
}`;
}

export const glslSoft = /* glsl */ `
uniform sampler2D tDepth; uniform vec2 uResolution; uniform float uNear,uFar,uSoft;
float linDepth(float z){ float zn=z*2.-1.; return (2.*uNear*uFar)/max(uFar+uNear-zn*(uFar-uNear),1e-5); }
float softDepth(){
  if(uSoft<=0.) return 1.;
  vec2 sc=gl_FragCoord.xy/max(uResolution,vec2(1.));
  float sd=linDepth(texture2D(tDepth,sc).x); float fd=linDepth(gl_FragCoord.z);
  return clamp((sd-fd)/uSoft,0.,1.);
}
`;

/** Procedural stand-ins used when a layer references no mask texture. */
export const glslProcedural = /* glsl */ `
// uProcedural: 0 = soft disc, 1 = flame-ish, 2 = smoke-ish.
float proceduralShape(vec2 p, float n, int mode){
  float disc=smoothstep(.5,.1,length(p));
  if(mode==1) return clamp(disc*(.45+n*1.1),0.,1.);
  if(mode==2) return clamp(disc*(.6+n*.8),0.,1.);
  return disc;
}
`;

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

export const particleVertexV2 = /* glsl */ `
attribute vec4 aSeed, aExtra, aExtra2;
uniform float uTime,uPeriod,uSpawnWindow,uSpawnDuration,uShapeLength,uShapeRadius,uShapeInner,uShapeAngle;
uniform float uDrag,uCurl,uCurlFreq,uCurlSpeed,uStretch,uFloorY,uFloorSoft,uAngle,uAtlasTiles;
uniform int uSpawnMode,uShapeType,uVelMode,uRenderMode,uHasFloor,uHasAlphaSpawn,uSurfaceOnly,uAtlasCols,uAtlasRows;
uniform vec3 uAxis,uDir,uGravity,uWind,uBias,uShapeSize;
uniform vec2 uLife,uSpeed,uSize,uRot,uRotInit;
uniform float uBurstT[${CURVE_KEYS}]; uniform float uBurstC[${CURVE_KEYS}]; uniform int uBurstN;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
${glslNoise}
${glslCurve("A")}
${glslCurve("B")}
${glslCurve("D")}
${glslCurve("E")}
vec3 orthoOf(vec3 a){ return safeDir(abs(a.y)<.9?cross(a,vec3(0,1,0)):cross(a,vec3(1,0,0)), vec3(1,0,0)); }

void main(){
  vUv=uv; vSeed=aExtra2.xyz;
  float instance=aSeed.x;

  // --- birth time (closed form) --------------------------------------------
  float birth=instance*uSpawnWindow;
  float life=mix(uLife.x,uLife.y,aSeed.y);
  float age;
  if(uSpawnMode==1){
    // continuous: the emitter loops with period = count / rate.
    float cycle=floor((uTime-birth)/max(uPeriod,1e-4));
    float absBirth=birth+cycle*uPeriod;
    age=uTime-absBirth;
    if(absBirth<0. || absBirth>uSpawnDuration){ gl_Position=vec4(2.,2.,2.,1.); vAlpha=0.; vU=0.; vRot=0.; vTile=vec2(0.); vWp=vec3(0.); return; }
  } else if(uSpawnMode==2){
    // bursts: pick the burst whose cumulative share covers this instance.
    float t0=uBurstT[0];
    for(int i=0;i<${CURVE_KEYS};i++){ if(i>=uBurstN) break; if(instance<=uBurstC[i]){ t0=uBurstT[i]; break; } }
    birth=t0+fract(instance*7.13+0.37)*uSpawnWindow;
    age=uTime-birth;
  } else {
    age=uTime-birth;
  }
  if(age<0. || age>=life){ gl_Position=vec4(2.,2.,2.,1.); vAlpha=0.; vU=0.; vRot=0.; vTile=vec2(0.); vWp=vec3(0.); return; }
  float u=age/max(life,1e-4); vU=u;

  // --- spawn position -------------------------------------------------------
  float ca=aExtra.x*6.2831853, cz=aExtra.y*2.-1., cr=sqrt(max(0.,1.-cz*cz));
  vec3 unit=vec3(cr*cos(ca),cz,cr*sin(ca));
  float fill=uSurfaceOnly==1?1.:safePow(aExtra.z,.5);
  vec3 sph=unit*fill;
  // bias mirrors samples toward the positive axis (0 = symmetric, 1 = fully biased).
  sph=mix(sph,abs(sph),clamp(uBias,0.,1.));

  vec3 axis=safeDir(uAxis,vec3(0,1,0));
  vec3 a1=orthoOf(axis), a2=cross(axis,a1);
  vec3 origin=vec3(0.);
  vec3 radial=safeDir(sph,axis);
  if(uShapeType==0){ origin=vec3(0.); }
  else if(uShapeType==1){ origin=sph*uShapeRadius; }
  else if(uShapeType==2){ origin=vec3(sph.x,abs(sph.y),sph.z)*uShapeRadius; }
  else if(uShapeType==3){
    float h=aExtra.w*uShapeLength;
    float rr=uShapeRadius+h*tan(min(uShapeAngle,1.5));
    origin=axis*h+(a1*cos(ca)+a2*sin(ca))*rr*safePow(aExtra.z,.5);
  }
  else if(uShapeType==4){ origin=(a1*cos(ca)+a2*sin(ca))*uShapeRadius; }
  else if(uShapeType==5){
    float rr=mix(uShapeInner,uShapeRadius,safePow(aExtra.z,.5));
    origin=(a1*cos(ca)+a2*sin(ca))*rr;
  }
  else if(uShapeType==6){ origin=vec3(aExtra.x*2.-1.,aExtra.y*2.-1.,aExtra.z*2.-1.)*uShapeSize*.5; }
  else { origin=axis*(uShapeLength*aExtra.w)+sph*uShapeRadius; }

  // --- initial direction ----------------------------------------------------
  vec3 dir;
  vec3 base=safeDir(uDir,vec3(0,1,0));
  if(uVelMode==0) dir=safeDir(origin,radial);
  else if(uVelMode==1) dir=base;
  else if(uVelMode==2) dir=safeDir(cross(axis,safeDir(origin,radial)),base);
  else {
    vec3 t1=orthoOf(base), t2=cross(base,t1);
    float ph=aSeed.z*6.2831853, cone=aSeed.w*uAngle;
    dir=safeDir(base+(t1*cos(ph)+t2*sin(ph))*cone, base);
  }

  // --- trajectory -----------------------------------------------------------
  float v0=mix(uSpeed.x,uSpeed.y,aExtra2.w);
  float d=uDrag<.001?age:(1.-exp(-uDrag*age))/uDrag;
  vec3 pos=origin+dir*v0*d+.5*uGravity*age*age+uWind*age;
  vec3 vel=dir*v0*exp(-uDrag*age)+uGravity*age+uWind;
  if(uCurl>0.){
    vec3 c=curl3(pos*uCurlFreq+vec3(0.,-uTime*uCurlSpeed,0.)+vSeed*3.);
    pos+=c*uCurl*curveE(u)*age;
  }
  if(uHasFloor==1){ float dy=pos.y-uFloorY; pos.y=uFloorY+max(dy,dy*uFloorSoft); }
  vWp=pos;

  // --- billboard ------------------------------------------------------------
  float size=mix(uSize.x,uSize.y,aExtra2.x)*curveA(u);
  float rot=mix(uRotInit.x,uRotInit.y,aExtra2.y)+mix(uRot.x,uRot.y,aExtra2.z)*age;
  vec4 mv;
  if(uRenderMode==2 || uRenderMode==3){
    // World-oriented quads: horizontal lies in XZ, vertical in XY.
    float c=cos(rot), s=sin(rot);
    vec2 q=mat2(c,-s,s,c)*position.xy*size;
    vec3 world=uRenderMode==2?vec3(q.x,0.,q.y):vec3(q.x,q.y,0.);
    mv=modelViewMatrix*vec4(pos+world,1.);
    rot=0.;
  } else {
    mv=modelViewMatrix*vec4(pos,1.);
    vec3 sv3=(modelViewMatrix*vec4(vel,0.)).xyz;
    vec2 sv=vec2(sv3.x,sv3.y);
    float svl=length(sv);
    vec2 along=vec2(0.,1.), across=vec2(1.,0.);
    float stretch=1.;
    if(uRenderMode==1 && svl>1e-4){
      along=sv/svl;
      // Winding: the across axis must be the clockwise perpendicular or the
      // quad is mirrored and back-face culled away.
      across=vec2(along.y,-along.x);
      rot=0.; stretch=1.+uStretch*svl;
    }
    mv.xy+=across*position.x*size+along*position.y*size*stretch;
  }
  vRot=rot;
  gl_Position=projectionMatrix*mv;

  vAlpha=curveB(u)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) vAlpha*=curveD(aExtra.w);

  float cols=float(max(uAtlasCols,1)), rows=float(max(uAtlasRows,1));
  float ti=floor(aExtra.z*max(uAtlasTiles,1.)*.9999);
  vTile=vec2(mod(ti,cols)/cols, floor(ti/cols)/rows);
}
`;

export const particleFragmentV2 = /* glsl */ `
precision highp float;
uniform sampler2D uMask,uNoise;
uniform int uHasMask,uHasNoise,uUseErosion,uBlendMode,uProcedural,uAtlasCols,uAtlasRows;
uniform float uTime,uDistort,uErodeSoft,uEdgeW,uEdgeI,uOpacity;
uniform vec2 uNoiseScale,uNoisePan,uMaskScale,uMaskPan;
uniform vec3 uEdgeCol;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
${glslNoise}
${glslRamp}
${glslCurve("C")}
${glslSoft}
${glslProcedural}
void main(){
  if(vAlpha<=0.) discard;
  vec2 p=vUv-.5; float c=cos(vRot), s=sin(vRot); p=mat2(c,-s,s,c)*p; vec2 uvp=p+.5;
  float n=.5;
  if(uHasNoise==1){
    vec2 nuv=uvp*uNoiseScale+uNoisePan*uTime+vSeed.xy*7.;
    float n1=texture2D(uNoise,nuv).r;
    float n2=texture2D(uNoise,nuv*1.7+vec2(.3,.1)-uNoisePan*uTime*.6).r;
    n=n1*.65+n2*.35;
  } else {
    n=.5+.5*fbm3(vec3(uvp*uNoiseScale*2.+uNoisePan*uTime, vSeed.x*17.));
  }
  vec2 duv=uvp+(n-.5)*uDistort*(.4+vU);
  float inside=step(0.,duv.x)*step(duv.x,1.)*step(0.,duv.y)*step(duv.y,1.);
  vec2 muv=duv*uMaskScale+uMaskPan;
  vec2 auv=vec2(muv.x/float(max(uAtlasCols,1)), muv.y/float(max(uAtlasRows,1)))+vTile;
  float shape;
  if(uHasMask==1){ vec4 m=texture2D(uMask,auv); shape=m.a*max(m.r,max(m.g,m.b)); }
  else shape=proceduralShape(p,n,uProcedural);
  shape*=inside;
  float er=shape, edge=0.;
  if(uUseErosion==1){
    float th=curveC(vU);
    float field=shape*(.35+n*.9);
    er=smoothstep(th,th+uErodeSoft,field);
    edge=smoothstep(th-uEdgeW,th+uErodeSoft*.5,field)-er;
  }
  vec3 col=rampColor(vU);
  col+=uEdgeCol*uEdgeI*edge*shape;
  float a=er*vAlpha*uOpacity*softDepth();
  if(a<.002) discard;
  // Alpha blending is set up premultiplied for every mode but "alpha".
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

// ---------------------------------------------------------------------------
// Surface meshes (shell / sprite / ring / beam / trail / decal)
// ---------------------------------------------------------------------------

export const surfaceVertexV2 = /* glsl */ `
uniform float uTime,uLength,uRadius,uVertexAmp,uVertexFreq,uVertexSpeed,uDisplaceShift;
uniform int uShell,uHasVertexNoise;
uniform vec3 uVertexBias;
varying vec3 vN,vWp; varying float vAlong,vLobe; varying vec2 vUv;
${glslNoise}
${glslCurve("F")}
vec3 orthoOf(vec3 a){ return safeDir(abs(a.y)<.9?cross(a,vec3(0,1,0)):cross(a,vec3(1,0,0)), vec3(1,0,0)); }
void main(){
  vUv=uv; vLobe=0.;
  vec3 worldPos, worldNormal;
  if(uShell==1){
    // Unit sphere -> teardrop: along = (1-z)/2 on the local +Z axis (z=+1 is
    // the head). The tube frame is built from the WORLD axis so that the ring
    // "up" reference and the bias push direction live in the same space no
    // matter how the layer's transform decomposes into euler angles.
    float along=clamp((1.-position.z)*.5,0.,1.); vAlong=along;
    // Squaring, not pow(): a negative base would be clamped by safePow and the
    // bulbous nose would flatten into a full-radius cylinder.
    float taper=along*2.-1.;
    float r=uRadius*(1.05*sqrt(max(0.,1.-taper*taper))*(1.-along*.45)+.06);
    float len=uLength*(along<.5? along*.9 : .45+(along-.5)*1.1);
    vec3 head=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
    vec3 axis=safeDir((modelMatrix*vec4(0.,0.,1.,0.)).xyz, vec3(0.,0.,1.));
    vec3 t1=orthoOf(axis), t2=cross(axis,t1);
    vec2 ring=normalize(position.xy+vec2(1e-5));
    vec3 radial=t1*ring.x+t2*ring.y;
    vec3 base=head+axis*len+radial*r;
    float amp=uHasVertexNoise==1?uVertexAmp:0.;
    float nz=fbm3(vec3(ring*uVertexFreq+vec2(along*3.5,0.), along*4.-uTime*uVertexSpeed)+vec3(0.,0.,along*3.));
    float disp=nz*amp*curveF(along)*uRadius*2.4;
    // Low-frequency lobes on one side of the tube only: a few big licks lift
    // off the tail along the bias direction, so the body silhouette stays thin.
    vec3 bias=safeDir(uVertexBias,vec3(0.,1.,0.));
    float lobe=snoise(vec3(ring*(uVertexFreq*.36)+vec2(along*1.4,0.), along*2.2-uTime*(uVertexSpeed*.75)));
    float up=smoothstep(.2,.95,ring.y)*smoothstep(.35,.8,along);
    vLobe=max(0.,lobe)*up*step(1e-4,amp);
    float lick=vLobe*uRadius*(amp*6.2);
    worldPos=base+radial*disp+axis*nz*.25*along
      +bias*(uLength*.236*safePow(along,2.3)*(.6+.4*nz)+lick);
    worldNormal=safeDir(radial, vec3(0.,1.,0.));
  } else {
    vAlong=clamp(uv.y,0.,1.);
    vec3 pos=position;
    if(uHasVertexNoise==1){
      float nz=fbm3(vec3(position.xy*uVertexFreq, position.z*uVertexFreq-uTime*uVertexSpeed));
      vec3 bias=safeDir(uVertexBias,normal);
      pos+=mix(normal,bias,.5)*nz*uVertexAmp*curveF(vAlong);
    }
    worldPos=(modelMatrix*vec4(pos,1.)).xyz;
    worldNormal=safeDir((modelMatrix*vec4(normal,0.)).xyz, vec3(0.,1.,0.));
  }
  vWp=worldPos;
  vN=worldNormal;
  gl_Position=projectionMatrix*viewMatrix*vec4(worldPos,1.);
}
`;

export const surfaceFragmentV2 = /* glsl */ `
precision highp float;
uniform float uTime,uOpacity,uErodeSoft,uEdgeW,uEdgeI,uProtect,uRimBias,uDisplaceShift;
uniform float uFresnelPower,uFresnelStrength,uDistort,uRampKeyMode,uLayerU;
uniform int uShell,uHasMask,uHasNoise,uUseErosion,uBlendMode,uProcedural,uHasFresnel;
uniform vec2 uNoiseScale,uNoisePan,uMaskScale,uMaskPan;
uniform vec3 uEdgeCol,uCam;
uniform sampler2D uMask,uNoise;
varying vec3 vN,vWp; varying float vAlong,vLobe; varying vec2 vUv;
${glslNoise}
${glslRamp}
${glslCurve("C")}
${glslProcedural}
void main(){
  vec3 V=safeDir(uCam-vWp, vec3(0.,0.,1.));
  float fres=1.-abs(dot(vN,V));
  float n=.5;
  if(uShell==1){
    n=.5+.5*(.7*snoise(vec3(vUv.x*3.0, vAlong*3.2-uTime*2.0, .7))+.3*snoise(vec3(vUv.x*6.0, vAlong*6.0-uTime*3.1, 2.3)));
    if(uHasNoise==1){
      float ntex=texture2D(uNoise, vec2(vUv.x*uNoiseScale.x, vAlong*uNoiseScale.y+uNoisePan.y*uTime)).r;
      n=n*.75+ntex*.25;
    }
  } else if(uHasNoise==1){
    n=texture2D(uNoise, vUv*uNoiseScale+uNoisePan*uTime).r;
  } else {
    n=.5+.5*fbm3(vec3(vUv*uNoiseScale*2.+uNoisePan*uTime, 3.1));
  }

  float shape=1.;
  if(uShell==0){
    vec2 duv=vUv+(n-.5)*uDistort;
    vec2 muv=duv*uMaskScale+uMaskPan;
    if(uHasMask==1){ vec4 m=texture2D(uMask,muv); shape=m.a*max(m.r,max(m.g,m.b)); }
    else shape=proceduralShape(vUv-.5,n,uProcedural);
  }

  float key;
  if(uRampKeyMode>1.5) key=clamp(vAlong*1.08+(n-.5)*.35*smoothstep(.15,.7,vAlong),0.,1.);
  else if(uRampKeyMode>0.5) key=clamp(uLayerU,0.,1.);
  else key=clamp(vAlong,0.,1.);
  if(uHasFresnel==1) key+=safePow(fres,uFresnelPower)*uFresnelStrength*smoothstep(0.,.4,vAlong);
  key+=uDisplaceShift*vLobe;
  key=clamp(key,0.,1.);

  float alpha=uOpacity;
  float rim=0.;
  if(uUseErosion==1){
    // The field stays mostly low frequency so a tail carves into a few long
    // tongues instead of confetti.
    float low=.5+.5*snoise(vec3(vUv.x*1.15, vAlong*1.25-uTime*1.5, 4.1));
    float field=uShell==1?((.25*low+.75*n)*.9+.2):(shape*(.35+n*.9));
    float th=max(0., curveC(vAlong) - vLobe*uProtect + fres*uRimBias*.5);
    float er=smoothstep(th,th+uErodeSoft,field);
    if(er<.01) discard;
    rim=smoothstep(th-uEdgeW,th+uErodeSoft*.5,field)-er;
    alpha*=uShell==1?er:er;
  }
  if(uShell==0) alpha*=shape;

  vec3 col=rampColor(key);
  if(uShell==1){
    col*=mix(1.+(n-.5)*.18, 1., smoothstep(.08,.45,vAlong));
    col+=vec3(.9,.82,.62)*.7*smoothstep(.04,0.,vAlong)*(.85+.15*n);
    alpha*=(1.-smoothstep(.5,1.,vAlong)*.5);
  }
  col+=uEdgeCol*uEdgeI*rim*(1.-smoothstep(.5,.95,vAlong));
  if(alpha<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,alpha);
  else gl_FragColor=vec4(col*alpha,alpha);
}
`;

// ---------------------------------------------------------------------------
// Uniform builders
// ---------------------------------------------------------------------------

export function rampUniforms(ramp: Ramp) {
  const colors: THREE.Vector4[] = [];
  const stops: number[] = [];
  for (let i = 0; i < RAMP_STOPS; i++) {
    const stop = ramp.stops[Math.min(i, ramp.stops.length - 1)];
    // `new THREE.Color(hex)` already converts sRGB -> linear; converting again
    // washes the whole palette out.
    const color = new THREE.Color(stop.color);
    colors.push(new THREE.Vector4(color.r, color.g, color.b, stop.intensity));
    stops.push(stop.t);
  }
  return {
    uRamp: { value: colors },
    uRampT: { value: stops },
    uRampN: { value: ramp.stops.length },
  };
}

export function writeRamp(
  uniforms: Record<string, THREE.IUniform>,
  ramp: Ramp,
) {
  const colors = uniforms.uRamp.value as THREE.Vector4[];
  const stops = uniforms.uRampT.value as number[];
  for (let i = 0; i < RAMP_STOPS; i++) {
    const stop = ramp.stops[Math.min(i, ramp.stops.length - 1)];
    const color = new THREE.Color(stop.color);
    colors[i].set(color.r, color.g, color.b, stop.intensity);
    stops[i] = stop.t;
  }
  uniforms.uRampN.value = ramp.stops.length;
}

const FALLBACK_CURVE: Curve = { keys: [[0, 1] as [number, number], [1, 1]], ease: "linear" };

export function curveUniforms(name: string, curve: Curve | null) {
  const source = curve ?? FALLBACK_CURVE;
  const keys: THREE.Vector2[] = [];
  for (let i = 0; i < CURVE_KEYS; i++) {
    const key = source.keys[Math.min(i, source.keys.length - 1)];
    keys.push(new THREE.Vector2(key[0], key[1]));
  }
  return {
    [`uCurve${name}`]: { value: keys },
    [`uCurve${name}N`]: { value: source.keys.length },
    [`uCurve${name}Ease`]: { value: source.ease === "smooth" ? 1 : 0 },
  };
}

export function writeCurve(
  uniforms: Record<string, THREE.IUniform>,
  name: string,
  curve: Curve | null,
) {
  const source = curve ?? FALLBACK_CURVE;
  const keys = uniforms[`uCurve${name}`].value as THREE.Vector2[];
  for (let i = 0; i < CURVE_KEYS; i++) {
    const key = source.keys[Math.min(i, source.keys.length - 1)];
    keys[i].set(key[0], key[1]);
  }
  uniforms[`uCurve${name}N`].value = source.keys.length;
  uniforms[`uCurve${name}Ease`].value = source.ease === "smooth" ? 1 : 0;
}
