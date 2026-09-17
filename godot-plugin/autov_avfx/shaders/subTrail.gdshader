shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform float uTime;
uniform float uSegments;
uniform float uSpacing;
uniform float uSpan;
uniform float uTwinkleFreq;
uniform float uTwinkleDepth;
uniform int uHasAlphaSpawn;
uniform vec2 uSize;
uniform int uEPathType;
uniform vec3 uEPathA;
uniform vec3 uEPathB;
uniform vec3 uEPathC;
uniform vec4 uEPathD;
uniform vec2 uEPathW;
uniform vec2 uCurveA[8];
uniform int uCurveAN;
uniform float uCurveAEase;
uniform vec2 uCurveB[8];
uniform int uCurveBN;
uniform float uCurveBEase;
uniform vec2 uCurveD[8];
uniform int uCurveDN;
uniform float uCurveDEase;
uniform vec2 uCurveE[8];
uniform int uCurveEN;
uniform float uCurveEEase;
uniform vec2 uCurveG[8];
uniform int uCurveGN;
uniform float uCurveGEase;
uniform vec2 uCurveH[8];
uniform int uCurveHN;
uniform float uCurveHEase;
uniform vec2 uCurveT[8];
uniform int uCurveTN;
uniform float uCurveTEase;
uniform float uPeriod;
uniform float uSpawnWindow;
uniform float uSpawnDuration;
uniform float uShapeLength;
uniform float uShapeRadius;
uniform float uShapeInner;
uniform float uShapeAngle;
uniform float uDrag;
uniform float uCurl;
uniform float uCurlFreq;
uniform float uCurlSpeed;
uniform float uFloorY;
uniform float uFloorSoft;
uniform float uAngle;
uniform float uPlanarDrag;
uniform float uVortexW;
uniform float uVortexFalloff;
uniform int uSpawnMode;
uniform int uShapeType;
uniform int uVelMode;
uniform int uHasFloor;
uniform int uSurfaceOnly;
uniform int uSpeedN;
uniform int uBurstN;
uniform vec3 uAxis;
uniform vec3 uDir;
uniform vec3 uGravity;
uniform vec3 uWind;
uniform vec3 uBias;
uniform vec3 uShapeSize;
uniform vec3 uVortexAxis;
uniform vec2 uLife;
uniform vec2 uSpeed;
uniform vec2 uSpeedKey[8];
uniform float uBurstT[8];
uniform float uBurstC[8];
uniform float uInterior;
uniform float uAngleJitter;
uniform float uAngleBias;
uniform vec3 uFrontC;
uniform vec3 uFrontEx;
uniform vec3 uFrontEy;
uniform vec3 uFrontN;
uniform float uFrontR;
uniform float uFrontPh0;
uniform float uFrontSweep;
uniform float uFrontSpan;
uniform float uFrontStart;
uniform float uParentPeriod;
uniform float uParentSpawnWindow;
uniform float uParentSpawnDuration;
uniform float uParentShapeLength;
uniform float uParentShapeRadius;
uniform float uParentShapeInner;
uniform float uParentShapeAngle;
uniform float uParentDrag;
uniform float uParentCurl;
uniform float uParentCurlFreq;
uniform float uParentCurlSpeed;
uniform float uParentFloorY;
uniform float uParentFloorSoft;
uniform float uParentAngle;
uniform float uParentPlanarDrag;
uniform float uParentVortexW;
uniform float uParentVortexFalloff;
uniform int uParentSpawnMode;
uniform int uParentShapeType;
uniform int uParentVelMode;
uniform int uParentHasFloor;
uniform int uParentSurfaceOnly;
uniform int uParentSpeedN;
uniform int uParentBurstN;
uniform vec3 uParentAxis;
uniform vec3 uParentDir;
uniform vec3 uParentGravity;
uniform vec3 uParentWind;
uniform vec3 uParentBias;
uniform vec3 uParentShapeSize;
uniform vec3 uParentVortexAxis;
uniform vec2 uParentLife;
uniform vec2 uParentSpeed;
uniform vec2 uParentSpeedKey[8];
uniform float uParentBurstT[8];
uniform float uParentBurstC[8];
uniform float uParentInterior;
uniform float uParentAngleJitter;
uniform float uParentAngleBias;
uniform float uParentTimeShift;
uniform float uInherit;
uniform float uPathT0;
uniform float uPathDt;
uniform int uSubMode;
uniform vec2 uSubOffset;
uniform vec3 uParentPath[8];
uniform sampler2D uTrail : filter_linear_mipmap, repeat_disable;
uniform int uHasTrail;
uniform int uBlendMode;
uniform float uOpacity;
uniform float uFlicker;
uniform float uTrailRampMode;
uniform vec4 uRamp[6];
uniform float uRampT[6];
uniform int uRampN;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying vec2 vUv;
varying float vU;
varying float vAlpha;
varying vec3 vSeed;
varying vec3 vWp;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
vec4 aSeed;
vec4 aExtra;
vec4 aExtra2;
float aIndex;
vec4 aPSeed;
vec4 aPExtra;
vec4 aPExtra2;
vec3 aSrcPos;
vec3 aSrcDir;
vec4 aEvent;
vec2 vUv;
float vU;
float vAlpha;
vec3 vSeed;
vec3 vWp;
vec3 position;
vec3 normal;
vec2 uv;
vec4 gl_Position;
mat4 modelMatrix;
mat4 modelViewMatrix;
mat4 projectionMatrix;
mat4 viewMatrix;
mat3 normalMatrix;
vec3 cameraPosition;
};
vec3 avfxV_mod289v3(vec3 x, inout avfxVContext avfx) {return x-floor(x*(1./289.))*289.;}
vec4 avfxV_mod289v4(vec4 x, inout avfxVContext avfx) {return x-floor(x*(1./289.))*289.;}
vec4 avfxV_permute289(vec4 x, inout avfxVContext avfx) {return avfxV_mod289v4(((x*34.)+1.)*x, avfx);}
vec4 avfxV_taylorInvSqrtV(vec4 r, inout avfxVContext avfx) {return 1.79284291400159-0.85373472095314*r;}
float avfxV_snoise(vec3 v, inout avfxVContext avfx) {
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=avfxV_mod289v3(i, avfx);
  vec4 p=avfxV_permute289(avfxV_permute289(avfxV_permute289(i.z+vec4(0.,i1.z,i2.z,1.), avfx)+i.y+vec4(0.,i1.y,i2.y,1.), avfx)+i.x+vec4(0.,i1.x,i2.x,1.), avfx);
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=avfxV_taylorInvSqrtV(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)), avfx);
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float avfxV_fbm3(vec3 p, inout avfxVContext avfx) { return .5*avfxV_snoise(p, avfx)+.25*avfxV_snoise(p*2.02+7., avfx)+.125*avfxV_snoise(p*4.05+3., avfx)+.0625*avfxV_snoise(p*8.1+1., avfx); }
vec3 avfxV_curl3(vec3 p, inout avfxVContext avfx) {
  float e=.1;
  vec3 dx=vec3(e,0.,0.), dy=vec3(0.,e,0.), dz=vec3(0.,0.,e);
  float dady=avfxV_snoise(p+dy, avfx)-avfxV_snoise(p-dy, avfx), dadz=avfxV_snoise(p+dz, avfx)-avfxV_snoise(p-dz, avfx);
  float dbdx=avfxV_snoise(p+dx+31.4, avfx)-avfxV_snoise(p-dx+31.4, avfx), dbdz=avfxV_snoise(p+dz+31.4, avfx)-avfxV_snoise(p-dz+31.4, avfx);
  float dcdx=avfxV_snoise(p+dx-17.2, avfx)-avfxV_snoise(p-dx-17.2, avfx), dcdy=avfxV_snoise(p+dy-17.2, avfx)-avfxV_snoise(p-dy-17.2, avfx);
  return vec3(dcdy-dbdz, dadz-dcdx, dbdx-dady)/(2.*e);
}
vec3 avfxV_safeDir(vec3 v, vec3 fallback, inout avfxVContext avfx) { float l=length(v); return l>1e-5 ? v/l : fallback; }
float avfxV_safePow(float base, float e, inout avfxVContext avfx) { return pow(max(base,1e-5), e); }
vec3 avfxV_orthoOf(vec3 a, inout avfxVContext avfx) { return avfxV_safeDir(abs(a.y)<.9?cross(a,vec3(0,1,0)):cross(a,vec3(1,0,0)), vec3(1,0,0), avfx); }
vec3 avfxV_pathPointE(float u, inout avfxVContext avfx) {
  if(uEPathType==1){
    float m=1.-u;
    return m*m*uEPathA+2.*m*u*uEPathB+u*u*uEPathC;
  }
  float th=6.28318530718*uEPathD.z*u+uEPathD.w;
  float r=uEPathD.x+uEPathW.x*sin(uEPathW.y*th);
  float y=uEPathA.y+uEPathD.y*u
        +uEPathW.x*.5*sin(uEPathW.y*th*2.+1.3);
  return vec3(uEPathA.x+cos(th)*r, y, uEPathA.z+sin(th)*r);
}
vec3 avfxV_pathTangentE(float u, inout avfxVContext avfx) {
  vec3 d=avfxV_pathPointE(u+1e-3, avfx)-avfxV_pathPointE(u-1e-3, avfx);
  float l=length(d);
  return l>1e-6 ? d/l : vec3(0.,0.,1.);
}
vec3 avfxV_pathSideE(float u, inout avfxVContext avfx) {
  return normalize(cross(avfxV_pathTangentE(u, avfx), vec3(0.,1.,0.))+vec3(1e-5,0.,0.));
}
vec3 avfxV_pathUpE(float u, inout avfxVContext avfx) {
  return normalize(cross(avfxV_pathSideE(u, avfx), avfxV_pathTangentE(u, avfx)));
}
float avfxV_curveA(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.); float v=uCurveA[0].y;
  for(int i=1;i<8;i++){
    if(i>=uCurveAN) break;
    float a=uCurveA[i-1].x, b=uCurveA[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurveAEase);
    v=mix(v,uCurveA[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_curveB(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.); float v=uCurveB[0].y;
  for(int i=1;i<8;i++){
    if(i>=uCurveBN) break;
    float a=uCurveB[i-1].x, b=uCurveB[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurveBEase);
    v=mix(v,uCurveB[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_curveD(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.); float v=uCurveD[0].y;
  for(int i=1;i<8;i++){
    if(i>=uCurveDN) break;
    float a=uCurveD[i-1].x, b=uCurveD[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurveDEase);
    v=mix(v,uCurveD[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_curveE(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.); float v=uCurveE[0].y;
  for(int i=1;i<8;i++){
    if(i>=uCurveEN) break;
    float a=uCurveE[i-1].x, b=uCurveE[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurveEEase);
    v=mix(v,uCurveE[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_curveG(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.); float v=uCurveG[0].y;
  for(int i=1;i<8;i++){
    if(i>=uCurveGN) break;
    float a=uCurveG[i-1].x, b=uCurveG[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurveGEase);
    v=mix(v,uCurveG[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_flipFrame(float life, float age, float tiles, int mode, float fps, inout avfxVContext avfx) {
  float frame=0.;
  if(mode==1) frame=clamp(life,0.,1.)*max(tiles-1.,0.);
  else if(mode==2) frame=mod(max(age,0.)*fps,tiles);
  return frame;
}
float avfxV_nextFlipFrame(float frame, float tiles, int mode, inout avfxVContext avfx) {
  float next=min(floor(frame)+1.,tiles-1.);
  if(mode==2) next=mod(floor(frame)+1.,tiles);
  return next;
}
vec2 avfxV_tileOffset(float frame, float cols, float rows, inout avfxVContext avfx) {
  return vec2(mod(floor(frame),cols)/cols,floor(floor(frame)/cols)/rows);
}
float avfxV_curveH(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.); float v=uCurveH[0].y;
  for(int i=1;i<8;i++){
    if(i>=uCurveHN) break;
    float a=uCurveH[i-1].x, b=uCurveH[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurveHEase);
    v=mix(v,uCurveH[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_curveHInverse(float y, inout avfxVContext avfx) {
  float last=uCurveH[0].x;
  for(int i=1;i<8;i++){
    if(i>=uCurveHN) break;
    vec2 a=uCurveH[i-1], b=uCurveH[i];
    last=b.x;
    if(y<=b.y || i==uCurveHN-1){
      float s=clamp((y-a.y)/max(b.y-a.y,1e-5),0.,1.);
      float f=mix(s, .5-sin(asin(clamp(1.-2.*s,-1.,1.))/3.), uCurveHEase);
      return a.x+(b.x-a.x)*f;
    }
  }
  return last;
}
float avfxV_curveT(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.); float v=uCurveT[0].y;
  for(int i=1;i<8;i++){
    if(i>=uCurveTN) break;
    float a=uCurveT[i-1].x, b=uCurveT[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurveTEase);
    v=mix(v,uCurveT[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_curveTInverse(float y, inout avfxVContext avfx) {
  float last=uCurveT[0].x;
  for(int i=1;i<8;i++){
    if(i>=uCurveTN) break;
    vec2 a=uCurveT[i-1], b=uCurveT[i];
    last=b.x;
    if(y<=b.y || i==uCurveTN-1){
      float s=clamp((y-a.y)/max(b.y-a.y,1e-5),0.,1.);
      float f=mix(s, .5-sin(asin(clamp(1.-2.*s,-1.,1.))/3.), uCurveTEase);
      return a.x+(b.x-a.x)*f;
    }
  }
  return last;
}
vec3 avfxV_frontPoint(float sArc, inout avfxVContext avfx) {
  float ph=uFrontPh0+sArc*uFrontSweep;
  return uFrontC+(uFrontEx*cos(ph)+uFrontEy*sin(ph))*uFrontR;
}
vec3 avfxV_frontTangent(float sArc, inout avfxVContext avfx) {
  float ph=uFrontPh0+sArc*uFrontSweep;
  return avfxV_safeDir(-uFrontEx*sin(ph)+uFrontEy*cos(ph), vec3(1.,0.,0.), avfx);
}
float avfxV_selfLife(vec4 s, inout avfxVContext avfx) { return mix(uLife.x,uLife.y,s.y); }
float avfxV_selfBirth(vec4 s, float t, vec4 ev, float idx, inout avfxVContext avfx) {
  float avfxInstance=s.x;
  float birth=avfxInstance*uSpawnWindow;
  if(uSpawnMode==1){
    
    float cycle=floor((t-birth)/max(uPeriod,1e-4));
    float absBirth=birth+cycle*uPeriod;
    if(absBirth<0. || absBirth>uSpawnDuration) return 1e9;
    return absBirth;
  }
  if(uSpawnMode==2){
    
    float t0=uBurstT[0];
    for(int i=0;i<8;i++){ if(i>=uBurstN) break; if(avfxInstance<=uBurstC[i]){ t0=uBurstT[i]; break; } }
    return t0+fract(avfxInstance*7.13+0.37)*uSpawnWindow;
  }
  if(uSpawnMode==4){
    
    
    
    
    return ev.w+fract(avfxInstance*7.13+.37)*uSpawnWindow;
  }
  if(uSpawnMode==5){
    
    
    
    
    return avfxV_curveTInverse(avfxInstance, avfx)*uFrontSpan+uFrontStart;
  }
  if(uSpawnMode==3){
    
    
    
    return avfxV_curveHInverse(idx, avfx)*uSpan;
  }
  return birth;
}
vec3 avfxV_selfOrigin(vec4 s, vec4 e, vec4 e2, vec3 srcPos, vec4 ev, float idx, inout avfxVContext avfx) {
  float ca=e.x*6.2831853, cz=e.y*2.-1., cr=sqrt(max(0.,1.-cz*cz));
  vec3 unit=vec3(cr*cos(ca),cz,cr*sin(ca));
  float fill=uSurfaceOnly==1?1.:avfxV_safePow(e.z,.5, avfx);
  vec3 sph=unit*fill;
  
  sph=mix(sph,abs(sph),clamp(uBias,0.,1.));
  vec3 axis=avfxV_safeDir(uAxis,vec3(0,1,0), avfx);
  vec3 a1=avfxV_orthoOf(axis, avfx), a2=cross(axis,a1);
  if(uShapeType==0) return vec3(0.);
  if(uShapeType==1) return sph*uShapeRadius;
  if(uShapeType==2) return vec3(sph.x,abs(sph.y),sph.z)*uShapeRadius;
  if(uShapeType==3){
    float h=e.w*uShapeLength;
    float rr=uShapeRadius+h*tan(min(uShapeAngle,1.5));
    return axis*h+(a1*cos(ca)+a2*sin(ca))*rr*avfxV_safePow(e.z,.5, avfx);
  }
  if(uShapeType==4) return (a1*cos(ca)+a2*sin(ca))*uShapeRadius;
  if(uShapeType==5){
    float rr=mix(uShapeInner,uShapeRadius,avfxV_safePow(e.z,.5, avfx));
    return (a1*cos(ca)+a2*sin(ca))*rr;
  }
  if(uShapeType==6) return vec3(e.x*2.-1.,e.y*2.-1.,e.z*2.-1.)*uShapeSize*.5;
  if(uShapeType==11){
    
    
    
    vec2 H=vec2(uShapeRadius, uShapeLength*.5);
    vec2 pt; vec2 nrm;
    if(e.w<uInterior){
      pt=vec2((e.x*2.-1.)*H.x*.88,(e.y*2.-1.)*H.y*.90);
      nrm=normalize(pt+vec2(1e-4));
    } else {
      float per=2.*H.x+2.*H.y;
      float sgn=e.z<.5?-1.:1.;
      float dd=e.x*per;
      if(dd<H.x){ pt=vec2(dd,-H.y); nrm=vec2(0.,-1.); }
      else if(dd<H.x+2.*H.y){ pt=vec2(H.x,-H.y+(dd-H.x)); nrm=vec2(1.,0.); }
      else { pt=vec2(H.x-(dd-H.x-2.*H.y),H.y); nrm=vec2(0.,1.); }
      pt.x*=sgn; nrm.x*=sgn;
      pt+=nrm*(e.y-.3)*uShapeInner;
    }
    return a1*pt.x+a2*pt.y+axis*(e.z-.5)*uShapeInner;
  }
  if(uShapeType==13){
    
    
    
    float bias=clamp(uAngleBias,-1.,1.);
    float ang=idx*6.2831853*(1.-.25*abs(bias))
             +bias*1.5707963
             +(e.x-.5)*uAngleJitter;
    return (a1*cos(ang)+a2*sin(ang))*uShapeRadius;
  }
  if(uShapeType==12){
    
    
    
    float rr=mix(uShapeInner,uShapeRadius,sqrt(e.z));
    return (a1*cos(ca)+a2*sin(ca))*rr;
  }
  if(uSpawnMode==5)
    return avfxV_frontPoint(s.x, avfx)+uFrontN*(e.z-.5)*uShapeRadius
          +sph*uShapeRadius*.4;
  if(uShapeType==8){
    
    
    
    vec3 tg=avfxV_pathTangentE(idx, avfx),sd=avfxV_pathSideE(idx, avfx),upn=avfxV_pathUpE(idx, avfx);
    return avfxV_pathPointE(idx, avfx)
      + sd*(e.x-.5)*2.*uShapeRadius
      + upn*(e.y-.5)*1.5*uShapeRadius;
  }
  if(uShapeType==10){
    
    
    
    float pu=fract(s.z*7.31+s.w*3.17);
    vec3 tg=avfxV_pathTangentE(pu, avfx),sd=avfxV_pathSideE(pu, avfx),upn=avfxV_pathUpE(pu, avfx);
    return avfxV_pathPointE(pu, avfx)
      + sd*(e.x-.5)*2.*uShapeRadius
      + upn*(e.y-.5)*2.*uShapeRadius
      + tg*(e.z-.5)*uShapeRadius;
  }
  if(uSpawnMode==4) return ev.xyz+sph*uShapeRadius;
  if(uShapeType==9){
    
    
    
    return srcPos + sph*uShapeRadius;
  }
  return axis*(uShapeLength*e.w)+sph*uShapeRadius;
}
vec3 avfxV_selfDir(vec4 s, vec4 e, vec4 e2, vec3 origin, vec3 srcDir, inout avfxVContext avfx) {
  vec3 axis=avfxV_safeDir(uAxis,vec3(0,1,0), avfx);
  vec3 base=avfxV_safeDir(uDir,vec3(0,1,0), avfx);
  vec3 radial=avfxV_safeDir(origin,axis, avfx);
  
  
  
  if(uShapeType==9 && uVelMode==0) return avfxV_safeDir(srcDir,base, avfx);
  
  
  
  if(uSpawnMode==5 && uVelMode==0) return avfxV_safeDir(-avfxV_frontTangent(s.x, avfx),base, avfx);
  if(uVelMode==0) return avfxV_safeDir(origin,radial, avfx);
  if(uVelMode==1) return base;
  if(uVelMode==2) return avfxV_safeDir(cross(axis,radial),base, avfx);
  vec3 t1=avfxV_orthoOf(base, avfx), t2=cross(base,t1);
  float ph=s.z*6.2831853, cone=s.w*uAngle;
  return avfxV_safeDir(base+(t1*cos(ph)+t2*sin(ph))*cone, base, avfx);
}
float avfxV_selfSpeedAt(float u, inout avfxVContext avfx) {
  if(uSpeedN<2) return 1.;
  u=clamp(u,0.,1.);
  float v=uSpeedKey[0].y;
  for(int i=1;i<8;i++){
    if(i>=uSpeedN) break;
    float a=uSpeedKey[i-1].x, b=uSpeedKey[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    v=mix(v,uSpeedKey[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_selfSpeedI(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.);
  float acc=min(u,uSpeedKey[0].x)*uSpeedKey[0].y;
  for(int i=1;i<8;i++){
    if(i>=uSpeedN) break;
    float a=uSpeedKey[i-1].x, b=uSpeedKey[i].x;
    float va=uSpeedKey[i-1].y, vb=uSpeedKey[i].y;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    acc+=(b-a)*f*(va+(vb-va)*f*.5);
    if(i==uSpeedN-1) acc+=max(u-b,0.)*vb;
  }
  return acc;
}
void avfxV_selfTraj(vec4 s, vec4 e, vec4 e2, vec3 srcPos, vec3 srcDir, vec4 ev, float idx, float age, float life, float t, out vec3 pos, out vec3 vel, inout avfxVContext avfx) {
  vec3 origin=avfxV_selfOrigin(s,e,e2,srcPos,ev,idx, avfx);
  vec3 dir=avfxV_selfDir(s,e,e2,origin,srcDir, avfx);
  float a=max(age,0.);
  float u=clamp(a/max(life,1e-4),0.,1.);
  if(uVelMode==4){
    
    
    
    
    
    float lu=clamp(t/max(uSpan,1e-4),0.,1.);
    float lag=mix(uSpeed.x,uSpeed.y,e2.w);
    float ru=clamp(avfxV_selfSpeedAt(lu, avfx)-lag,0.,1.);
    pos=avfxV_pathPointE(ru, avfx)+origin;
    vel=avfxV_pathTangentE(ru, avfx);
    if(uHasFloor==1){ float dy=pos.y-uFloorY; pos.y=uFloorY+max(dy,dy*uFloorSoft); }
    return;
  }

  if(uVelMode==5){
    
    
    
    
    vec3 ax=avfxV_safeDir(uAxis,vec3(0.,1.,0.), avfx);
    float h=dot(origin,ax);
    vec3 rad=origin-ax*h;
    float r=max(length(rad),1e-4);
    float w=uSpeed.y*avfxV_safePow(r/max(uShapeRadius,1e-3),-.5, avfx);
    float ang=w*a, c=cos(ang), sn=sin(ang);
    vec3 turned=rad*c+cross(ax,rad)*sn;
    float bob=(e2.w-.5)*uSpeed.x*sin(a*(.6+1.2*e2.x)+e.x*6.2831853);
    pos=turned+ax*(h+bob);
    vel=(cross(ax,turned))*w;
    if(uHasFloor==1){ float dy=pos.y-uFloorY; pos.y=uFloorY+max(dy,dy*uFloorSoft); }
    return;
  }
  float v0=mix(uSpeed.x,uSpeed.y,e2.w);
  float d,scale;
  if(uSpeedN>1){
    
    d=life*avfxV_selfSpeedI(u, avfx); scale=avfxV_selfSpeedAt(u, avfx);
  } else {
    d=uDrag<.001?a:(1.-exp(-uDrag*a))/uDrag; scale=exp(-uDrag*a);
  }
  pos=origin+dir*v0*d+.5*uGravity*a*a+uWind*a;
  vel=dir*v0*scale+uGravity*a+uWind;
  if(uPlanarDrag>0.){
    
    
    
    float dp=(1.-exp(-uPlanarDrag*a))/uPlanarDrag;
    float sp=exp(-uPlanarDrag*a);
    vec3 flat_=origin+dir*v0*dp+uWind*a;
    pos.xz=flat_.xz;
    vel.xz=(dir*v0*sp+uWind).xz;
  }
  if(abs(uVortexW)>1e-5){
    
    
    vec3 ax=avfxV_safeDir(uVortexAxis,vec3(0.,1.,0.), avfx);
    float h=dot(pos,ax); vec3 rad=pos-ax*h; float r=length(rad);
    if(r>1e-5){
      float w=uVortexW/(1.+uVortexFalloff*r);
      float ang=w*a, c=cos(ang), sn=sin(ang);
      pos=ax*h+rad*c+cross(ax,rad)*sn;
      vel=vel*c+cross(ax,vel)*sn;
    }
  }
  if(uCurl>0.){
    vec3 c=avfxV_curl3(pos*uCurlFreq+vec3(0.,-t*uCurlSpeed,0.)+e2.xyz*3., avfx);
    pos+=c*uCurl*(avfxV_curveE(u, avfx))*a;
  }
  if(uHasFloor==1){ float dy=pos.y-uFloorY; pos.y=uFloorY+max(dy,dy*uFloorSoft); }
}
float avfxV_parentLife(vec4 s, inout avfxVContext avfx) { return mix(uParentLife.x,uParentLife.y,s.y); }
float avfxV_parentBirth(vec4 s, float t, vec4 ev, float idx, inout avfxVContext avfx) {
  float avfxInstance=s.x;
  float birth=avfxInstance*uParentSpawnWindow;
  if(uParentSpawnMode==1){
    
    float cycle=floor((t-birth)/max(uParentPeriod,1e-4));
    float absBirth=birth+cycle*uParentPeriod;
    if(absBirth<0. || absBirth>uParentSpawnDuration) return 1e9;
    return absBirth;
  }
  if(uParentSpawnMode==2){
    
    float t0=uParentBurstT[0];
    for(int i=0;i<8;i++){ if(i>=uParentBurstN) break; if(avfxInstance<=uParentBurstC[i]){ t0=uParentBurstT[i]; break; } }
    return t0+fract(avfxInstance*7.13+0.37)*uParentSpawnWindow;
  }
  return birth;
}
vec3 avfxV_parentOrigin(vec4 s, vec4 e, vec4 e2, vec3 srcPos, vec4 ev, float idx, inout avfxVContext avfx) {
  float ca=e.x*6.2831853, cz=e.y*2.-1., cr=sqrt(max(0.,1.-cz*cz));
  vec3 unit=vec3(cr*cos(ca),cz,cr*sin(ca));
  float fill=uParentSurfaceOnly==1?1.:avfxV_safePow(e.z,.5, avfx);
  vec3 sph=unit*fill;
  
  sph=mix(sph,abs(sph),clamp(uParentBias,0.,1.));
  vec3 axis=avfxV_safeDir(uParentAxis,vec3(0,1,0), avfx);
  vec3 a1=avfxV_orthoOf(axis, avfx), a2=cross(axis,a1);
  if(uParentShapeType==0) return vec3(0.);
  if(uParentShapeType==1) return sph*uParentShapeRadius;
  if(uParentShapeType==2) return vec3(sph.x,abs(sph.y),sph.z)*uParentShapeRadius;
  if(uParentShapeType==3){
    float h=e.w*uParentShapeLength;
    float rr=uParentShapeRadius+h*tan(min(uParentShapeAngle,1.5));
    return axis*h+(a1*cos(ca)+a2*sin(ca))*rr*avfxV_safePow(e.z,.5, avfx);
  }
  if(uParentShapeType==4) return (a1*cos(ca)+a2*sin(ca))*uParentShapeRadius;
  if(uParentShapeType==5){
    float rr=mix(uParentShapeInner,uParentShapeRadius,avfxV_safePow(e.z,.5, avfx));
    return (a1*cos(ca)+a2*sin(ca))*rr;
  }
  if(uParentShapeType==6) return vec3(e.x*2.-1.,e.y*2.-1.,e.z*2.-1.)*uParentShapeSize*.5;
  if(uParentShapeType==11){
    
    
    
    vec2 H=vec2(uParentShapeRadius, uParentShapeLength*.5);
    vec2 pt; vec2 nrm;
    if(e.w<uParentInterior){
      pt=vec2((e.x*2.-1.)*H.x*.88,(e.y*2.-1.)*H.y*.90);
      nrm=normalize(pt+vec2(1e-4));
    } else {
      float per=2.*H.x+2.*H.y;
      float sgn=e.z<.5?-1.:1.;
      float dd=e.x*per;
      if(dd<H.x){ pt=vec2(dd,-H.y); nrm=vec2(0.,-1.); }
      else if(dd<H.x+2.*H.y){ pt=vec2(H.x,-H.y+(dd-H.x)); nrm=vec2(1.,0.); }
      else { pt=vec2(H.x-(dd-H.x-2.*H.y),H.y); nrm=vec2(0.,1.); }
      pt.x*=sgn; nrm.x*=sgn;
      pt+=nrm*(e.y-.3)*uParentShapeInner;
    }
    return a1*pt.x+a2*pt.y+axis*(e.z-.5)*uParentShapeInner;
  }
  if(uParentShapeType==13){
    
    
    
    float bias=clamp(uParentAngleBias,-1.,1.);
    float ang=idx*6.2831853*(1.-.25*abs(bias))
             +bias*1.5707963
             +(e.x-.5)*uParentAngleJitter;
    return (a1*cos(ang)+a2*sin(ang))*uParentShapeRadius;
  }
  if(uParentShapeType==12){
    
    
    
    float rr=mix(uParentShapeInner,uParentShapeRadius,sqrt(e.z));
    return (a1*cos(ca)+a2*sin(ca))*rr;
  }
  return axis*(uParentShapeLength*e.w)+sph*uParentShapeRadius;
}
vec3 avfxV_parentDir(vec4 s, vec4 e, vec4 e2, vec3 origin, vec3 srcDir, inout avfxVContext avfx) {
  vec3 axis=avfxV_safeDir(uParentAxis,vec3(0,1,0), avfx);
  vec3 base=avfxV_safeDir(uParentDir,vec3(0,1,0), avfx);
  vec3 radial=avfxV_safeDir(origin,axis, avfx);
  if(uParentVelMode==0) return avfxV_safeDir(origin,radial, avfx);
  if(uParentVelMode==1) return base;
  if(uParentVelMode==2) return avfxV_safeDir(cross(axis,radial),base, avfx);
  vec3 t1=avfxV_orthoOf(base, avfx), t2=cross(base,t1);
  float ph=s.z*6.2831853, cone=s.w*uParentAngle;
  return avfxV_safeDir(base+(t1*cos(ph)+t2*sin(ph))*cone, base, avfx);
}
float avfxV_parentSpeedAt(float u, inout avfxVContext avfx) {
  if(uParentSpeedN<2) return 1.;
  u=clamp(u,0.,1.);
  float v=uParentSpeedKey[0].y;
  for(int i=1;i<8;i++){
    if(i>=uParentSpeedN) break;
    float a=uParentSpeedKey[i-1].x, b=uParentSpeedKey[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    v=mix(v,uParentSpeedKey[i].y,step(a,u)*f);
  }
  return v;
}
float avfxV_parentSpeedI(float u, inout avfxVContext avfx) {
  u=clamp(u,0.,1.);
  float acc=min(u,uParentSpeedKey[0].x)*uParentSpeedKey[0].y;
  for(int i=1;i<8;i++){
    if(i>=uParentSpeedN) break;
    float a=uParentSpeedKey[i-1].x, b=uParentSpeedKey[i].x;
    float va=uParentSpeedKey[i-1].y, vb=uParentSpeedKey[i].y;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    acc+=(b-a)*f*(va+(vb-va)*f*.5);
    if(i==uParentSpeedN-1) acc+=max(u-b,0.)*vb;
  }
  return acc;
}
void avfxV_parentTraj(vec4 s, vec4 e, vec4 e2, vec3 srcPos, vec3 srcDir, vec4 ev, float idx, float age, float life, float t, out vec3 pos, out vec3 vel, inout avfxVContext avfx) {
  vec3 origin=avfxV_parentOrigin(s,e,e2,srcPos,ev,idx, avfx);
  vec3 dir=avfxV_parentDir(s,e,e2,origin,srcDir, avfx);
  float a=max(age,0.);
  float u=clamp(a/max(life,1e-4),0.,1.);

  if(uParentVelMode==5){
    
    
    
    
    vec3 ax=avfxV_safeDir(uParentAxis,vec3(0.,1.,0.), avfx);
    float h=dot(origin,ax);
    vec3 rad=origin-ax*h;
    float r=max(length(rad),1e-4);
    float w=uParentSpeed.y*avfxV_safePow(r/max(uParentShapeRadius,1e-3),-.5, avfx);
    float ang=w*a, c=cos(ang), sn=sin(ang);
    vec3 turned=rad*c+cross(ax,rad)*sn;
    float bob=(e2.w-.5)*uParentSpeed.x*sin(a*(.6+1.2*e2.x)+e.x*6.2831853);
    pos=turned+ax*(h+bob);
    vel=(cross(ax,turned))*w;
    if(uParentHasFloor==1){ float dy=pos.y-uParentFloorY; pos.y=uParentFloorY+max(dy,dy*uParentFloorSoft); }
    return;
  }
  float v0=mix(uParentSpeed.x,uParentSpeed.y,e2.w);
  float d,scale;
  if(uParentSpeedN>1){
    
    d=life*avfxV_parentSpeedI(u, avfx); scale=avfxV_parentSpeedAt(u, avfx);
  } else {
    d=uParentDrag<.001?a:(1.-exp(-uParentDrag*a))/uParentDrag; scale=exp(-uParentDrag*a);
  }
  pos=origin+dir*v0*d+.5*uParentGravity*a*a+uParentWind*a;
  vel=dir*v0*scale+uParentGravity*a+uParentWind;
  if(uParentPlanarDrag>0.){
    
    
    
    float dp=(1.-exp(-uParentPlanarDrag*a))/uParentPlanarDrag;
    float sp=exp(-uParentPlanarDrag*a);
    vec3 flat_=origin+dir*v0*dp+uParentWind*a;
    pos.xz=flat_.xz;
    vel.xz=(dir*v0*sp+uParentWind).xz;
  }
  if(abs(uParentVortexW)>1e-5){
    
    
    vec3 ax=avfxV_safeDir(uParentVortexAxis,vec3(0.,1.,0.), avfx);
    float h=dot(pos,ax); vec3 rad=pos-ax*h; float r=length(rad);
    if(r>1e-5){
      float w=uParentVortexW/(1.+uParentVortexFalloff*r);
      float ang=w*a, c=cos(ang), sn=sin(ang);
      pos=ax*h+rad*c+cross(ax,rad)*sn;
      vel=vel*c+cross(ax,vel)*sn;
    }
  }
  if(uParentCurl>0.){
    vec3 c=avfxV_curl3(pos*uParentCurlFreq+vec3(0.,-t*uParentCurlSpeed,0.)+e2.xyz*3., avfx);
    pos+=c*uParentCurl*(1.0)*a;
  }
  if(uParentHasFloor==1){ float dy=pos.y-uParentFloorY; pos.y=uParentFloorY+max(dy,dy*uParentFloorSoft); }
}
vec3 avfxV_parentPathAt(float t, inout avfxVContext avfx) {
  float x=clamp((t-uPathT0)/max(uPathDt,1e-4),0.,float(8-1));
  float i0=floor(x), f=x-i0;
  vec3 a=vec3(0.), b=vec3(0.);
  for(int i=0;i<8;i++){
    float fi=float(i);
    a+=uParentPath[i]*step(abs(fi-i0),.5);
    b+=uParentPath[i]*step(abs(fi-min(i0+1.,float(8-1))),.5);
  }
  return mix(a,b,f);
}
void avfxV_kill(inout avfxVContext avfx) { avfx.gl_Position=vec4(2.,2.,2.,1.); avfx.vAlpha=0.; avfx.vU=0.; avfx.vUv=vec2(0.); avfx.vWp=vec3(0.); }
void avfxV_main(inout avfxVContext avfx) {
  avfx.vSeed=avfx.aExtra2.xyz;

  float life=avfxV_selfLife(avfx.aSeed, avfx);
  float birth; vec3 subOrigin=vec3(0.); vec3 subVel=vec3(0.);
  bool dead=false;

  
  
  float pLife=avfxV_parentLife(avfx.aPSeed, avfx);
  float r=fract(avfx.aSeed.x*13.37+avfx.aSeed.w*7.77+0.113);
  float off = uSubMode==1 ? pLife
            : uSubMode==2 ? mix(uSubOffset.x,uSubOffset.y,r)
            : mix(uSubOffset.x,uSubOffset.y,fract(avfx.aSeed.x*3.0));
  off=clamp(off,0.,pLife);
  float pNow=uTime+uParentTimeShift;
  float pBirth=avfxV_parentBirth(avfx.aPSeed,pNow-off,avfx.aEvent,avfx.aIndex, avfx);
  vec3 ppos,pvel;
  avfxV_parentTraj(avfx.aPSeed,avfx.aPExtra,avfx.aPExtra2,avfx.aSrcPos,avfx.aSrcDir,avfx.aEvent,avfx.aIndex,off,pLife,pBirth+off,ppos,pvel, avfx);
  birth=pBirth+off-uParentTimeShift;
  subOrigin=ppos+avfxV_parentPathAt(pBirth+off, avfx);
  subVel=pvel*uInherit;
  if(pBirth>1e8) dead=true;

  float age=uTime-birth;
  if(age<0. || age>=life) dead=true;
  float u=clamp(age/max(life,1e-4),0.,1.);

  if(dead){ avfxV_kill(avfx); return; }
  avfx.vU=u;

  float side=avfx.position.x;
  float k=avfx.position.y;
  float kn=clamp(k/max(uSegments-1.,1.),0.,1.);
  avfx.vUv=vec2(side*.5+.5, kn);

  float ageK=max(age-k*uSpacing,0.);
  vec3 pos,vel;
  avfxV_selfTraj(avfx.aSeed,avfx.aExtra,avfx.aExtra2,avfx.aSrcPos,avfx.aSrcDir,avfx.aEvent,avfx.aIndex,ageK,life,uTime,pos,vel, avfx);
  pos+=subOrigin+subVel*ageK;
  vel+=subVel;
  avfx.vWp=pos;

  vec4 mv=avfx.modelViewMatrix*vec4(pos,1.);
  vec3 sv3=(avfx.modelViewMatrix*vec4(vel,0.)).xyz;
  vec2 sv=vec2(sv3.x,sv3.y);
  float svl=length(sv);
  vec2 across=svl>1e-4?vec2(sv.y,-sv.x)/svl:vec2(1.,0.);
  float width=mix(uSize.x,uSize.y,avfx.aExtra2.x)*avfxV_curveA(u, avfx)*avfxV_curveG(kn, avfx)*.5;
  mv.xy+=across*side*width;
  avfx.gl_Position=avfx.projectionMatrix*mv;

  avfx.vAlpha=avfxV_curveB(u, avfx)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) avfx.vAlpha*=avfxV_curveD(avfx.aExtra.w, avfx);
  if(uTwinkleDepth>0.)
    avfx.vAlpha*=mix(1., avfxV_safePow(abs(sin(uTime*uTwinkleFreq+avfx.aExtra2.y*19.7)),1.5, avfx), uTwinkleDepth);
}
struct avfxFContext {
vec2 vUv;
float vU;
float vAlpha;
vec3 vSeed;
vec3 vWp;
vec4 gl_FragColor;
vec4 gl_FragCoord;
bool gl_FrontFacing;
mat4 viewMatrix;
mat4 inverseProjection;
vec2 screenUv;
};
vec3 avfxF_rampColor(float u, inout avfxFContext avfx) {
  u=clamp(u,0.,1.);
  vec3 c=uRamp[0].rgb*uRamp[0].a; float prev=uRampT[0];
  for(int i=1;i<6;i++){
    if(i>=uRampN) break;
    float t=uRampT[i]; vec3 ci=uRamp[i].rgb*uRamp[i].a;
    c=mix(c,ci,smoothstep(prev,max(t,prev+1e-4),u)); prev=t;
  }
  return c;
}
void avfxF_main(inout avfxFContext avfx) {
  if(avfx.vAlpha<=0.) discard;
  float shape;
  if(uHasTrail==1){ vec4 m=texture(uTrail,avfx.vUv); shape=m.a*max(m.r,max(m.g,m.b)); }
  else shape=smoothstep(1.,0.,abs(avfx.vUv.x*2.-1.));
  
  
  
  
  vec3 col=avfxF_rampColor(uTrailRampMode>.5 ? clamp(avfx.vUv.y,0.,1.) : avfx.vU, avfx);
  float a=shape*avfx.vAlpha*uOpacity*uFlicker;
  if(a<.002) discard;
  if(uBlendMode==1) avfx.gl_FragColor=vec4(col,a);
  else avfx.gl_FragColor=vec4(col*a,a);
}
void vertex() {
  avfxVContext avfx;
  avfx.position=VERTEX; avfx.normal=NORMAL; avfx.uv=UV;
  avfx.modelMatrix=MODEL_MATRIX; avfx.modelViewMatrix=MODELVIEW_MATRIX;
  avfx.viewMatrix=VIEW_MATRIX; avfx.projectionMatrix=PROJECTION_MATRIX;
  avfx.normalMatrix=MODELVIEW_NORMAL_MATRIX; avfx.cameraPosition=CAMERA_POSITION_WORLD;
  avfx.aSeed=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+0)%avfxAttributeWidth,(int(UV2.x)*10+0)/avfxAttributeWidth),0);
avfx.aExtra=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+1)%avfxAttributeWidth,(int(UV2.x)*10+1)/avfxAttributeWidth),0);
avfx.aExtra2=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+2)%avfxAttributeWidth,(int(UV2.x)*10+2)/avfxAttributeWidth),0);
avfx.aIndex=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+3)%avfxAttributeWidth,(int(UV2.x)*10+3)/avfxAttributeWidth),0).x;
avfx.aPSeed=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+4)%avfxAttributeWidth,(int(UV2.x)*10+4)/avfxAttributeWidth),0);
avfx.aPExtra=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+5)%avfxAttributeWidth,(int(UV2.x)*10+5)/avfxAttributeWidth),0);
avfx.aPExtra2=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+6)%avfxAttributeWidth,(int(UV2.x)*10+6)/avfxAttributeWidth),0);
avfx.aSrcPos=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+7)%avfxAttributeWidth,(int(UV2.x)*10+7)/avfxAttributeWidth),0).xyz;
avfx.aSrcDir=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+8)%avfxAttributeWidth,(int(UV2.x)*10+8)/avfxAttributeWidth),0).xyz;
avfx.aEvent=texelFetch(avfxAttributes,ivec2((int(UV2.x)*10+9)%avfxAttributeWidth,(int(UV2.x)*10+9)/avfxAttributeWidth),0);
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vUv=avfx.vUv;
vU=avfx.vU;
vAlpha=avfx.vAlpha;
vSeed=avfx.vSeed;
vWp=avfx.vWp;
}
void fragment() {
  avfxFContext avfx;
  avfx.vUv=vUv;
avfx.vU=vU;
avfx.vAlpha=vAlpha;
avfx.vSeed=vSeed;
avfx.vWp=vWp;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
