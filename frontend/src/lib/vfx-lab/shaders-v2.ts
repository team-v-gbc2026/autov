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
// uProcedural: 0 = soft disc, 1 = flame-ish, 2 = smoke-ish, 3 = solid.
float proceduralShape(vec2 p, float n, int mode){
  if(mode==3) return 1.;
  float disc=smoothstep(.5,.1,length(p));
  if(mode==1) return clamp(disc*(.45+n*1.1),0.,1.);
  if(mode==2) return clamp(disc*(.6+n*.8),0.,1.);
  return disc;
}
`;

// ---------------------------------------------------------------------------
// Particles
//
// The whole trajectory — spawn position, initial direction, speed curve,
// forces, vortex, curl, floor — lives in one GLSL chunk that is emitted twice
// when a layer has a sub-emitter: once under the layer's own uniforms (prefix
// "", functions `self*`) and once under the parent layer's uniforms (prefix
// "Parent", functions `parent*`). Both the billboard vertex shader and the
// trail ribbon vertex shader call the same functions, so a trail vertex at
// age - k*spacing is exactly the position the billboard had at that age.
// ---------------------------------------------------------------------------

/**
 * Trajectory chunk. `P` prefixes the uniform names, `p` the function names and
 * `curlEnv` is the curl envelope expression (the parent copy has none, so its
 * caller passes a constant).
 */
export function glslParticleCore(P: string, p: string, curlEnv: string) {
  return /* glsl */ `
uniform float u${P}Period,u${P}SpawnWindow,u${P}SpawnDuration,u${P}ShapeLength,u${P}ShapeRadius,u${P}ShapeInner,u${P}ShapeAngle;
uniform float u${P}Drag,u${P}Curl,u${P}CurlFreq,u${P}CurlSpeed,u${P}FloorY,u${P}FloorSoft,u${P}Angle;
uniform float u${P}VortexW,u${P}VortexFalloff;
uniform int u${P}SpawnMode,u${P}ShapeType,u${P}VelMode,u${P}HasFloor,u${P}SurfaceOnly,u${P}SpeedN,u${P}BurstN;
uniform vec3 u${P}Axis,u${P}Dir,u${P}Gravity,u${P}Wind,u${P}Bias,u${P}ShapeSize,u${P}VortexAxis;
uniform vec2 u${P}Life,u${P}Speed;
uniform vec2 u${P}SpeedKey[${CURVE_KEYS}];
uniform float u${P}BurstT[${CURVE_KEYS}]; uniform float u${P}BurstC[${CURVE_KEYS}];

float ${p}Life(vec4 s){ return mix(u${P}Life.x,u${P}Life.y,s.y); }

/** Birth time in layer-local seconds, or 1e9 when the instance never spawns. */
float ${p}Birth(vec4 s, float t){
  float instance=s.x;
  float birth=instance*u${P}SpawnWindow;
  if(u${P}SpawnMode==1){
    // continuous: the emitter loops with period = count / rate.
    float cycle=floor((t-birth)/max(u${P}Period,1e-4));
    float absBirth=birth+cycle*u${P}Period;
    if(absBirth<0. || absBirth>u${P}SpawnDuration) return 1e9;
    return absBirth;
  }
  if(u${P}SpawnMode==2){
    // bursts: pick the burst whose cumulative share covers this instance.
    float t0=u${P}BurstT[0];
    for(int i=0;i<${CURVE_KEYS};i++){ if(i>=u${P}BurstN) break; if(instance<=u${P}BurstC[i]){ t0=u${P}BurstT[i]; break; } }
    return t0+fract(instance*7.13+0.37)*u${P}SpawnWindow;
  }
  return birth;
}

vec3 ${p}Origin(vec4 s, vec4 e, vec4 e2){
  float ca=e.x*6.2831853, cz=e.y*2.-1., cr=sqrt(max(0.,1.-cz*cz));
  vec3 unit=vec3(cr*cos(ca),cz,cr*sin(ca));
  float fill=u${P}SurfaceOnly==1?1.:safePow(e.z,.5);
  vec3 sph=unit*fill;
  // bias mirrors samples toward the positive axis (0 = symmetric, 1 = fully biased).
  sph=mix(sph,abs(sph),clamp(u${P}Bias,0.,1.));
  vec3 axis=safeDir(u${P}Axis,vec3(0,1,0));
  vec3 a1=orthoOf(axis), a2=cross(axis,a1);
  if(u${P}ShapeType==0) return vec3(0.);
  if(u${P}ShapeType==1) return sph*u${P}ShapeRadius;
  if(u${P}ShapeType==2) return vec3(sph.x,abs(sph.y),sph.z)*u${P}ShapeRadius;
  if(u${P}ShapeType==3){
    float h=e.w*u${P}ShapeLength;
    float rr=u${P}ShapeRadius+h*tan(min(u${P}ShapeAngle,1.5));
    return axis*h+(a1*cos(ca)+a2*sin(ca))*rr*safePow(e.z,.5);
  }
  if(u${P}ShapeType==4) return (a1*cos(ca)+a2*sin(ca))*u${P}ShapeRadius;
  if(u${P}ShapeType==5){
    float rr=mix(u${P}ShapeInner,u${P}ShapeRadius,safePow(e.z,.5));
    return (a1*cos(ca)+a2*sin(ca))*rr;
  }
  if(u${P}ShapeType==6) return vec3(e.x*2.-1.,e.y*2.-1.,e.z*2.-1.)*u${P}ShapeSize*.5;
  return axis*(u${P}ShapeLength*e.w)+sph*u${P}ShapeRadius;
}

vec3 ${p}Dir(vec4 s, vec4 e, vec4 e2, vec3 origin){
  vec3 axis=safeDir(u${P}Axis,vec3(0,1,0));
  vec3 base=safeDir(u${P}Dir,vec3(0,1,0));
  vec3 radial=safeDir(origin,axis);
  if(u${P}VelMode==0) return safeDir(origin,radial);
  if(u${P}VelMode==1) return base;
  if(u${P}VelMode==2) return safeDir(cross(axis,radial),base);
  vec3 t1=orthoOf(base), t2=cross(base,t1);
  float ph=s.z*6.2831853, cone=s.w*u${P}Angle;
  return safeDir(base+(t1*cos(ph)+t2*sin(ph))*cone, base);
}

/** Speed multiplier at normalized life u (1 when the layer has no speedCurve). */
float ${p}SpeedAt(float u){
  if(u${P}SpeedN<2) return 1.;
  u=clamp(u,0.,1.);
  float v=u${P}SpeedKey[0].y;
  for(int i=1;i<${CURVE_KEYS};i++){
    if(i>=u${P}SpeedN) break;
    float a=u${P}SpeedKey[i-1].x, b=u${P}SpeedKey[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    v=mix(v,u${P}SpeedKey[i].y,step(a,u)*f);
  }
  return v;
}

/**
 * Integral of the piecewise-linear speed table from 0 to u. Each trapezoid is
 * closed form, so distance travelled stays a pure function of time.
 */
float ${p}SpeedI(float u){
  u=clamp(u,0.,1.);
  float acc=min(u,u${P}SpeedKey[0].x)*u${P}SpeedKey[0].y;
  for(int i=1;i<${CURVE_KEYS};i++){
    if(i>=u${P}SpeedN) break;
    float a=u${P}SpeedKey[i-1].x, b=u${P}SpeedKey[i].x;
    float va=u${P}SpeedKey[i-1].y, vb=u${P}SpeedKey[i].y;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    acc+=(b-a)*f*(va+(vb-va)*f*.5);
    if(i==u${P}SpeedN-1) acc+=max(u-b,0.)*vb;
  }
  return acc;
}

void ${p}Traj(vec4 s, vec4 e, vec4 e2, float age, float life, float t, out vec3 pos, out vec3 vel){
  vec3 origin=${p}Origin(s,e,e2);
  vec3 dir=${p}Dir(s,e,e2,origin);
  float a=max(age,0.);
  float u=clamp(a/max(life,1e-4),0.,1.);
  float v0=mix(u${P}Speed.x,u${P}Speed.y,e2.w);
  float d,scale;
  if(u${P}SpeedN>1){
    // speedCurve replaces the drag integral: distance = v0 * life * I(u).
    d=life*${p}SpeedI(u); scale=${p}SpeedAt(u);
  } else {
    d=u${P}Drag<.001?a:(1.-exp(-u${P}Drag*a))/u${P}Drag; scale=exp(-u${P}Drag*a);
  }
  pos=origin+dir*v0*d+.5*u${P}Gravity*a*a+u${P}Wind*a;
  vel=dir*v0*scale+u${P}Gravity*a+u${P}Wind;
  if(abs(u${P}VortexW)>1e-5){
    // Rotate the radial part of the displacement about the vortex axis by
    // omega*age, with omega falling off with distance from that axis.
    vec3 ax=safeDir(u${P}VortexAxis,vec3(0.,1.,0.));
    float h=dot(pos,ax); vec3 rad=pos-ax*h; float r=length(rad);
    if(r>1e-5){
      float w=u${P}VortexW/(1.+u${P}VortexFalloff*r);
      float ang=w*a, c=cos(ang), sn=sin(ang);
      pos=ax*h+rad*c+cross(ax,rad)*sn;
      vel=vel*c+cross(ax,vel)*sn;
    }
  }
  if(u${P}Curl>0.){
    vec3 c=curl3(pos*u${P}CurlFreq+vec3(0.,-t*u${P}CurlSpeed,0.)+e2.xyz*3.);
    pos+=c*u${P}Curl*(${curlEnv})*a;
  }
  if(u${P}HasFloor==1){ float dy=pos.y-u${P}FloorY; pos.y=u${P}FloorY+max(dy,dy*u${P}FloorSoft); }
}
`;
}

/** Sub-emitter uniforms plus the sampled parent-transform path. */
const glslSubEmitter = /* glsl */ `
uniform float uParentTimeShift,uInherit,uPathT0,uPathDt;
uniform int uSubMode;
uniform vec2 uSubOffset;
uniform vec3 uParentPath[${CURVE_KEYS}];
/** Parent layer transform delta at absolute time t, from an 8-sample table. */
vec3 parentPathAt(float t){
  float x=clamp((t-uPathT0)/max(uPathDt,1e-4),0.,float(${CURVE_KEYS}-1));
  float i0=floor(x), f=x-i0;
  vec3 a=vec3(0.), b=vec3(0.);
  for(int i=0;i<${CURVE_KEYS};i++){
    float fi=float(i);
    a+=uParentPath[i]*step(abs(fi-i0),.5);
    b+=uParentPath[i]*step(abs(fi-min(i0+1.,float(${CURVE_KEYS}-1))),.5);
  }
  return mix(a,b,f);
}
`;

const glslOrtho = /* glsl */ `
vec3 orthoOf(vec3 a){ return safeDir(abs(a.y)<.9?cross(a,vec3(0,1,0)):cross(a,vec3(1,0,0)), vec3(1,0,0)); }
`;

/**
 * Resolves this instance's birth, life and — for sub-emitters — the parent
 * state it is launched from. `dead` is set when the instance is not alive at
 * the sampled time; both vertex shaders then push it to clip space.
 */
const glslResolveBirth = (sub: boolean) => /* glsl */ `
  float life=selfLife(aSeed);
  float birth; vec3 subOrigin=vec3(0.); vec3 subVel=vec3(0.);
  bool dead=false;
${
  sub
    ? /* glsl */ `
  // Sub-emitter: the child is born where and when the parent was at
  // parentBirth + offset, in the parent's own closed-form trajectory.
  float pLife=parentLife(aPSeed);
  float r=fract(aSeed.x*13.37+aSeed.w*7.77+0.113);
  float off = uSubMode==1 ? pLife
            : uSubMode==2 ? mix(uSubOffset.x,uSubOffset.y,r)
            : mix(uSubOffset.x,uSubOffset.y,fract(aSeed.x*3.0));
  off=clamp(off,0.,pLife);
  float pNow=uTime+uParentTimeShift;
  float pBirth=parentBirth(aPSeed,pNow-off);
  vec3 ppos,pvel;
  parentTraj(aPSeed,aPExtra,aPExtra2,off,pLife,pBirth+off,ppos,pvel);
  birth=pBirth+off-uParentTimeShift;
  subOrigin=ppos+parentPathAt(pBirth+off);
  subVel=pvel*uInherit;
  if(pBirth>1e8) dead=true;
`
    : `  birth=selfBirth(aSeed,uTime);
  if(birth>1e8) dead=true;
`
}
  float age=uTime-birth;
  if(age<0. || age>=life) dead=true;
  float u=clamp(age/max(life,1e-4),0.,1.);
`;

export function particleVertexSource(sub = false) {
  return /* glsl */ `
attribute vec4 aSeed, aExtra, aExtra2;
${sub ? "attribute vec4 aPSeed, aPExtra, aPExtra2;" : ""}
uniform float uTime,uStretch,uAtlasTiles,uMotionBlur,uFlipFps;
uniform int uRenderMode,uHasAlphaSpawn,uAtlasCols,uAtlasRows,uFlipMode;
uniform vec2 uSize,uRot,uRotInit;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
${glslNoise}
${glslOrtho}
${glslCurve("A")}
${glslCurve("B")}
${glslCurve("D")}
${glslCurve("E")}
${glslParticleCore("", "self", "curveE(u)")}
${sub ? glslParticleCore("Parent", "parent", "1.0") : ""}
${sub ? glslSubEmitter : ""}
void kill(){ gl_Position=vec4(2.,2.,2.,1.); vAlpha=0.; vU=0.; vRot=0.; vTile=vec2(0.); vWp=vec3(0.); }

void main(){
  vUv=uv; vSeed=aExtra2.xyz;
${glslResolveBirth(sub)}
  if(dead){ kill(); return; }
  vU=u;

  vec3 pos,vel;
  selfTraj(aSeed,aExtra,aExtra2,age,life,uTime,pos,vel);
  pos+=subOrigin+subVel*age;
  vel+=subVel;
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
      // post.motionBlur is a multiplier on the velocity stretch, nothing else.
      rot=0.; stretch=1.+uStretch*(1.+2.*uMotionBlur)*svl;
    }
    vec2 off=across*position.x*size+along*position.y*size*stretch;
    if(uMotionBlur>0. && svl>1e-4){
      // Non-stretched modes still elongate along screen velocity, never rotate.
      vec2 vdir=sv/svl;
      off+=vdir*dot(off,vdir)*uMotionBlur*min(svl,8.)*.25;
    }
    mv.xy+=off;
  }
  vRot=rot;
  gl_Position=projectionMatrix*mv;

  vAlpha=curveB(u)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) vAlpha*=curveD(aExtra.w);

  float cols=float(max(uAtlasCols,1)), rows=float(max(uAtlasRows,1));
  float tiles=max(uAtlasTiles,1.);
  // uFlipMode: 0 = random atlas tile, 1 = flipbook over life, 2 = flipbook at fps.
  float ti=floor(aExtra.z*tiles*.9999);
  if(uFlipMode==1) ti=floor(clamp(u,0.,.9999)*tiles);
  else if(uFlipMode==2) ti=floor(mod(max(age,0.)*uFlipFps,tiles));
  vTile=vec2(mod(ti,cols)/cols, floor(ti/cols)/rows);
}
`;
}

export const particleVertexV2 = particleVertexSource(false);

// --- trails -----------------------------------------------------------------

/**
 * One analytic ribbon per particle: vertex k evaluates the same closed-form
 * position at age - k*spacing, so the ribbon is the particle's own past
 * without any history buffer. `position` carries (side, k, 0).
 */
export function trailVertexSource(sub = false) {
  return /* glsl */ `
attribute vec4 aSeed, aExtra, aExtra2;
${sub ? "attribute vec4 aPSeed, aPExtra, aPExtra2;" : ""}
uniform float uTime,uSegments,uSpacing;
uniform int uHasAlphaSpawn;
uniform vec2 uSize;
varying vec2 vUv; varying float vU,vAlpha; varying vec3 vSeed; varying vec3 vWp;
${glslNoise}
${glslOrtho}
${glslCurve("A")}
${glslCurve("B")}
${glslCurve("D")}
${glslCurve("E")}
${glslCurve("G")}
${glslParticleCore("", "self", "curveE(u)")}
${sub ? glslParticleCore("Parent", "parent", "1.0") : ""}
${sub ? glslSubEmitter : ""}
void kill(){ gl_Position=vec4(2.,2.,2.,1.); vAlpha=0.; vU=0.; vUv=vec2(0.); vWp=vec3(0.); }

void main(){
  vSeed=aExtra2.xyz;
${glslResolveBirth(sub)}
  if(dead){ kill(); return; }
  vU=u;

  float side=position.x;
  float k=position.y;
  float kn=clamp(k/max(uSegments-1.,1.),0.,1.);
  vUv=vec2(side*.5+.5, kn);

  float ageK=max(age-k*uSpacing,0.);
  vec3 pos,vel;
  selfTraj(aSeed,aExtra,aExtra2,ageK,life,uTime,pos,vel);
  pos+=subOrigin+subVel*ageK;
  vel+=subVel;
  vWp=pos;

  vec4 mv=modelViewMatrix*vec4(pos,1.);
  vec3 sv3=(modelViewMatrix*vec4(vel,0.)).xyz;
  vec2 sv=vec2(sv3.x,sv3.y);
  float svl=length(sv);
  vec2 across=svl>1e-4?vec2(sv.y,-sv.x)/svl:vec2(1.,0.);
  float width=mix(uSize.x,uSize.y,aExtra2.x)*curveA(u)*curveG(kn)*.5;
  mv.xy+=across*side*width;
  gl_Position=projectionMatrix*mv;

  vAlpha=curveB(u)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) vAlpha*=curveD(aExtra.w);
}
`;
}

export const trailFragmentV2 = /* glsl */ `
precision highp float;
uniform sampler2D uTrail;
uniform int uHasTrail,uBlendMode;
uniform float uOpacity;
varying vec2 vUv; varying float vU,vAlpha; varying vec3 vSeed; varying vec3 vWp;
${glslRamp}
void main(){
  if(vAlpha<=0.) discard;
  float shape;
  if(uHasTrail==1){ vec4 m=texture2D(uTrail,vUv); shape=m.a*max(m.r,max(m.g,m.b)); }
  else shape=smoothstep(1.,0.,abs(vUv.x*2.-1.));
  vec3 col=rampColor(vU);
  float a=shape*vAlpha*uOpacity;
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
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
uniform float uTime,uLength,uRadius,uVertexAmp,uVertexFreq,uVertexSpeed,uDisplaceShift,uRoll;
uniform int uShell,uHasVertexNoise,uBillboard;
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
  } else if(uBillboard==1){
    // A sprite is a camera-facing square of half-size geometry.radius: the quad
    // is rebuilt on the view's right/up axes around the layer origin, so it
    // never edges out of the shot. transform.rotation[2] survives as a roll.
    vAlong=clamp(uv.y,0.,1.);
    vec3 centre=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
    vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
    vec3 up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
    // The instance's own scale still shapes the quad (a streak stays a streak).
    vec2 half2=vec2(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz));
    float c=cos(uRoll), s=sin(uRoll);
    vec2 q=vec2(position.x*half2.x, position.y*half2.y);
    q=vec2(q.x*c-q.y*s, q.x*s+q.y*c);
    worldPos=centre+right*q.x+up*q.y;
    worldNormal=safeDir(cross(right,up), vec3(0.,0.,1.));
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
uniform int uShell,uHasMask,uHasNoise,uUseErosion,uBlendMode,uProcedural,uHasFresnel,uBolt;
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
  if(uBolt==1){
    // A bolt is a tube: its normals face the camera along the centreline and
    // graze it at the silhouette, which is exactly the falloff a hot core with
    // a soft edge wants. Without it the tube reads as a flat blown-out slab.
    shape=safePow(abs(dot(vN,V)),.65);
  } else if(uShell==0){
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
