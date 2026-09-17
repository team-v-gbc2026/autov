shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform float uTime;
uniform float uStretch;
uniform float uAtlasTiles;
uniform float uMotionBlur;
uniform float uFlipFps;
uniform float uSpan;
uniform float uTwinkleFreq;
uniform float uTwinkleDepth;
uniform int uRenderMode;
uniform int uHasAlphaSpawn;
uniform int uAtlasCols;
uniform int uAtlasRows;
uniform int uFlipMode;
uniform int uAnchorHead;
uniform vec2 uSize;
uniform vec2 uRot;
uniform vec2 uRotInit;
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
uniform sampler2D uMask : filter_linear_mipmap, repeat_disable;
uniform sampler2D uNoise : filter_linear_mipmap, repeat_enable;
uniform int uHasMask;
uniform int uHasNoise;
uniform int uUseErosion;
uniform int uBlendMode;
uniform int uProcedural;
uniform float uDistort;
uniform float uErodeSoft;
uniform float uEdgeW;
uniform float uEdgeI;
uniform float uOpacity;
uniform float uMaskRot;
uniform float uRampKeyMode;
uniform float uGroundY;
uniform float uHeightSpan;
uniform float uFlicker;
uniform float uRampBlendMode;
uniform float uRampBlendWeight;
uniform vec2 uNoiseScale;
uniform vec2 uNoisePan;
uniform vec2 uMaskScale;
uniform vec2 uMaskPan;
uniform vec2 uDistortPan;
uniform vec3 uEdgeCol;
uniform vec4 uRamp[6];
uniform float uRampT[6];
uniform int uRampN;
uniform vec2 uCurveC[8];
uniform int uCurveCN;
uniform float uCurveCEase;
uniform sampler2D tDepth : hint_depth_texture, filter_nearest, repeat_disable;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uSoft;
uniform vec4 uProcParams;
uniform vec4 uStripeA[3];
uniform vec4 uStripeB[3];
uniform int uStripeN;
uniform vec3 uSymFill;
uniform vec3 uSymOutline;
uniform vec3 uSymHigh;
uniform vec3 uSymInk;
uniform vec3 uSymHot;
uniform float uSymHotI;
uniform float uSymHotA;
uniform float uScreenPitch;
uniform float uScreenOn;
uniform float uScreenWorld;
uniform vec3 uScreenCol;
uniform int uSmokeLit;
uniform int uSmokeCard;
uniform float uSmokeAmbient;
uniform vec3 uSmokeRight;
uniform vec3 uSmokeUp;
uniform vec3 uSmokeForward;
uniform vec4 uSmokeLights[8];
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying vec2 vUv;
varying float vU;
varying float vAlpha;
varying float vRot;
varying vec3 vSeed;
varying vec2 vTile;
varying vec2 vNextTile;
varying float vFrameMix;
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
float vRot;
vec3 vSeed;
vec2 vTile;
vec2 vNextTile;
float vFrameMix;
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
void avfxV_kill(inout avfxVContext avfx) { avfx.gl_Position=vec4(2.,2.,2.,1.); avfx.vAlpha=0.; avfx.vU=0.; avfx.vRot=0.; avfx.vTile=vec2(0.); avfx.vWp=vec3(0.); }
void avfxV_main(inout avfxVContext avfx) {
  avfx.vUv=avfx.uv; avfx.vSeed=avfx.aExtra2.xyz;

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

  vec3 pos,vel;
  avfxV_selfTraj(avfx.aSeed,avfx.aExtra,avfx.aExtra2,avfx.aSrcPos,avfx.aSrcDir,avfx.aEvent,avfx.aIndex,age,life,uTime,pos,vel, avfx);
  pos+=subOrigin+subVel*age;
  vel+=subVel;
  avfx.vWp=pos;

  
  float size=mix(uSize.x,uSize.y,avfx.aExtra2.x)*avfxV_curveA(u, avfx);
  float rot=mix(uRotInit.x,uRotInit.y,avfx.aExtra2.y)+mix(uRot.x,uRot.y,avfx.aExtra2.z)*age;
  
  
  
  vec3 heading = uRenderMode==4 && uShapeType==8 ? avfxV_pathTangentE(avfx.aIndex, avfx) : vel;
  vec4 mv;
  if(uRenderMode==2 || uRenderMode==3){
    
    float c=cos(rot), s=sin(rot);
    vec2 q=avfxMat2(c,-s,s,c)*avfx.position.xy*size;
    vec3 world=uRenderMode==2?vec3(q.x,0.,q.y):vec3(q.x,q.y,0.);
    mv=avfx.modelViewMatrix*vec4(pos+world,1.);
    rot=0.;
  } else {
    mv=avfx.modelViewMatrix*vec4(pos,1.);
    vec3 sv3=(avfx.modelViewMatrix*vec4(heading,0.)).xyz;
    vec2 sv=vec2(sv3.x,sv3.y);
    float svl=length(sv);
    vec2 along=vec2(0.,1.), across=vec2(1.,0.);
    float stretch=1.;
    if((uRenderMode==1 || uRenderMode==4) && svl>1e-4){
      along=sv/svl;
      
      
      across=vec2(along.y,-along.x);
      
      
      
      rot=0.;
      stretch=uRenderMode==4
        ? 1.+uStretch
        : 1.+uStretch*(1.+2.*uMotionBlur)*svl;
    }
    
    
    
    float anchorShift = uAnchorHead==1 ? -.5*size*stretch : 0.;
    vec2 off=across*avfx.position.x*size+along*(avfx.position.y*size*stretch+anchorShift);
    if(uMotionBlur>0. && svl>1e-4){
      
      vec2 vdir=sv/svl;
      off+=vdir*dot(off,vdir)*uMotionBlur*min(svl,8.)*.25;
    }
    mv.xy+=off;
  }
  avfx.vRot=rot;
  avfx.gl_Position=avfx.projectionMatrix*mv;

  avfx.vAlpha=avfxV_curveB(u, avfx)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) avfx.vAlpha*=avfxV_curveD(avfx.aExtra.w, avfx);
  
  
  if(uTwinkleDepth>0.)
    avfx.vAlpha*=mix(1., avfxV_safePow(abs(sin(uTime*uTwinkleFreq+avfx.aExtra2.y*19.7)),1.5, avfx), uTwinkleDepth);

  float cols=float(max(uAtlasCols,1)), rows=float(max(uAtlasRows,1));
  float tiles=max(uAtlasTiles,1.);
  
  float ti=floor(avfx.aExtra.z*tiles*.9999);
  float frame=ti;
  if(uFlipMode>0) frame=avfxV_flipFrame(u,age,tiles,uFlipMode,uFlipFps, avfx);
  avfx.vTile=avfxV_tileOffset(frame,cols,rows, avfx);
  avfx.vNextTile=avfx.vTile;
  avfx.vFrameMix=0.;
  if(uFlipMode>0){
    avfx.vNextTile=avfxV_tileOffset(avfxV_nextFlipFrame(frame,tiles,uFlipMode, avfx),cols,rows, avfx);
    avfx.vFrameMix=fract(frame);
  }
}
struct avfxFContext {
vec2 vUv;
float vU;
float vAlpha;
float vRot;
vec3 vSeed;
vec2 vTile;
vec2 vNextTile;
float vFrameMix;
vec3 vWp;
vec4 gl_FragColor;
vec4 gl_FragCoord;
bool gl_FrontFacing;
mat4 viewMatrix;
mat4 inverseProjection;
vec2 screenUv;
};
vec3 avfxF_mod289v3(vec3 x, inout avfxFContext avfx) {return x-floor(x*(1./289.))*289.;}
vec4 avfxF_mod289v4(vec4 x, inout avfxFContext avfx) {return x-floor(x*(1./289.))*289.;}
vec4 avfxF_permute289(vec4 x, inout avfxFContext avfx) {return avfxF_mod289v4(((x*34.)+1.)*x, avfx);}
vec4 avfxF_taylorInvSqrtV(vec4 r, inout avfxFContext avfx) {return 1.79284291400159-0.85373472095314*r;}
float avfxF_snoise(vec3 v, inout avfxFContext avfx) {
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=avfxF_mod289v3(i, avfx);
  vec4 p=avfxF_permute289(avfxF_permute289(avfxF_permute289(i.z+vec4(0.,i1.z,i2.z,1.), avfx)+i.y+vec4(0.,i1.y,i2.y,1.), avfx)+i.x+vec4(0.,i1.x,i2.x,1.), avfx);
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=avfxF_taylorInvSqrtV(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)), avfx);
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float avfxF_fbm3(vec3 p, inout avfxFContext avfx) { return .5*avfxF_snoise(p, avfx)+.25*avfxF_snoise(p*2.02+7., avfx)+.125*avfxF_snoise(p*4.05+3., avfx)+.0625*avfxF_snoise(p*8.1+1., avfx); }
vec3 avfxF_curl3(vec3 p, inout avfxFContext avfx) {
  float e=.1;
  vec3 dx=vec3(e,0.,0.), dy=vec3(0.,e,0.), dz=vec3(0.,0.,e);
  float dady=avfxF_snoise(p+dy, avfx)-avfxF_snoise(p-dy, avfx), dadz=avfxF_snoise(p+dz, avfx)-avfxF_snoise(p-dz, avfx);
  float dbdx=avfxF_snoise(p+dx+31.4, avfx)-avfxF_snoise(p-dx+31.4, avfx), dbdz=avfxF_snoise(p+dz+31.4, avfx)-avfxF_snoise(p-dz+31.4, avfx);
  float dcdx=avfxF_snoise(p+dx-17.2, avfx)-avfxF_snoise(p-dx-17.2, avfx), dcdy=avfxF_snoise(p+dy-17.2, avfx)-avfxF_snoise(p-dy-17.2, avfx);
  return vec3(dcdy-dbdz, dadz-dcdx, dbdx-dady)/(2.*e);
}
vec3 avfxF_safeDir(vec3 v, vec3 fallback, inout avfxFContext avfx) { float l=length(v); return l>1e-5 ? v/l : fallback; }
float avfxF_safePow(float base, float e, inout avfxFContext avfx) { return pow(max(base,1e-5), e); }
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
float avfxF_curveC(float u, inout avfxFContext avfx) {
  u=clamp(u,0.,1.); float v=uCurveC[0].y;
  for(int i=1;i<8;i++){
    if(i>=uCurveCN) break;
    float a=uCurveC[i-1].x, b=uCurveC[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurveCEase);
    v=mix(v,uCurveC[i].y,step(a,u)*f);
  }
  return v;
}
float avfxF_linDepth(float z, inout avfxFContext avfx) { float zn=z*2.-1.; return (2.*uNear*uFar)/max(uFar+uNear-zn*(uFar-uNear),1e-5); }
float avfxF_softDepth(inout avfxFContext avfx) {
      if(uSoft<=0.0) return 1.0;
      float sd=texture(tDepth,avfx.screenUv).r;
      vec3 sn=vec3(avfx.screenUv*2.0-1.0,sd);
      vec3 fn=vec3(avfx.screenUv*2.0-1.0,avfx.gl_FragCoord.z);
      #if CURRENT_RENDERER == RENDERER_COMPATIBILITY
      sn.z=sd*2.0-1.0;
      fn.z=avfx.gl_FragCoord.z*2.0-1.0;
      #endif
      vec4 sp=avfx.inverseProjection*vec4(sn,1.0);
      vec4 fp=avfx.inverseProjection*vec4(fn,1.0);
      return clamp((-sp.z/sp.w+fp.z/fp.w)/uSoft,0.0,1.0);
    }
float avfxF_procHash21(vec2 p, inout avfxFContext avfx) { vec3 q=fract(vec3(p.xyx)*0.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float avfxF_procNoise(vec2 p, inout avfxFContext avfx) {
  vec2 i=floor(p), f=fract(p);
  float a=avfxF_procHash21(i, avfx), b=avfxF_procHash21(i+vec2(1.,0.), avfx);
  float c=avfxF_procHash21(i+vec2(0.,1.), avfx), d=avfxF_procHash21(i+vec2(1.,1.), avfx);
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float avfxF_pointedShape(vec2 p,float arms,float outerRadius,float innerRadius, inout avfxFContext avfx) {
  float angle=atan(p.y,p.x), halfAngle=3.14159265/arms;
  float q=abs(mod(angle-1.570796+halfAngle,halfAngle*2.)-halfAngle);
  vec2 outer=vec2(outerRadius,0.), inner=innerRadius*vec2(cos(halfAngle),sin(halfAngle));
  vec2 ray=vec2(cos(q),sin(q)), edge=inner-outer;
  float boundary=(outer.x*inner.y)/(ray.x*edge.y-ray.y*edge.x);
  return 1.-smoothstep(boundary-.008,boundary+.008,length(p));
}
float avfxF_hexCells(vec2 uv, vec2 cell, inout avfxFContext avfx) {
  vec2 q=uv*vec2(24.,12.)*max(cell,vec2(.02));
  vec2 spacing=vec2(1.73205,3.);
  vec2 h1=mod(q,spacing)-spacing*.5, h2=mod(q-spacing*.5,spacing)-spacing*.5;
  vec2 h=dot(h1,h1)<dot(h2,h2)?h1:h2;
  
  float edge=abs(max(abs(h.x),abs(h.x)*.5+abs(h.y)*.866025)-.866025);
  return 1.-smoothstep(.035,.10,edge);
}
float avfxF_proceduralShape(vec2 p, vec2 uv, float n, float t, float fres, vec2 cell, vec3 dims, int mode, inout avfxFContext avfx) {
  if(mode==3) return 1.;
  float disc=smoothstep(.5,.1,length(p));
  if(mode==1) return clamp(disc*(.45+n*1.1),0.,1.);
  if(mode==2) return clamp(disc*(.6+n*.8),0.,1.);
  vec2 q=p*2.;
  if(mode==4) return clamp(.10+.90*avfxF_hexCells(uv,cell, avfx),0.,1.);
  if(mode==5){
    
    float field=.5+.5*avfxF_snoise(vec3(uv*vec2(12.,6.)*max(cell,vec2(.02)),1.), avfx);
    float veins=1.-smoothstep(.012,.03,abs(field-.5));
    return clamp(.12+.55*fres*fres+.80*veins,0.,1.);
  }
  if(mode==6 || mode==7){
    float bend=sin(q.y*2.8-t*2.2)*.12;
    float waves=sin((q.x+bend)*9.5+q.y*.7);
    float streak=smoothstep(.72,.92,waves)*(.65+.35*sin(q.y*2.-t*2.));
    return clamp(mode==7?streak:.88+.12*streak,0.,1.);
  }
  if(mode==8) return avfxF_pointedShape(q,5.,.78,.31, avfx);
  if(mode==9) return avfxF_pointedShape(q,4.,.9,.09, avfx);
  if(mode==10){
    
    float edgeDistance=min((1.-abs(q.x))*max(dims.x,1e-3),(1.-abs(q.y))*max(dims.y,1e-3)*.5);
    float border=1.-smoothstep(max(dims.z,.001)*.65,max(dims.z,.001)*1.15,edgeDistance);
    return clamp(border*.8+(.08+.22*n)*(1.-border),0.,1.);
  }
  if(mode==12){
    
    
    float c=cos(.38), sn=sin(.38); vec2 g=vec2(q.x*c-q.y*sn, q.x*sn+q.y*c);
    float r=length(g);
    float core=avfxF_safePow(max(0.,1.-r),6., avfx);
    float ax=avfxF_safePow(max(0.,1.-abs(g.x)),2., avfx)*avfxF_safePow(max(0.,1.-abs(g.y)*7.),2.5, avfx);
    float ay=avfxF_safePow(max(0.,1.-abs(g.y)),2., avfx)*avfxF_safePow(max(0.,1.-abs(g.x)*7.),2.5, avfx);
    return clamp(core*1.2+ax+ay,0.,2.);
  }
  if(mode==13) return avfxF_safePow(max(0.,1.-length(q)),2.6, avfx);
  if(mode==14){
    
    
    
    
    float R=max(uProcParams.x,.02), hw=max(uProcParams.y,.002), amp=uProcParams.z;
    float d=length(q), ang=atan(q.y,q.x);
    float m=0.;
    for(int i=0;i<3;i++){
      float fi=float(i);
      float spin=uProcParams.w*t*(1.+fi*.35)+fi*2.09;
      float wob=amp*(sin(ang*(4.+fi)+spin)*.6+sin(ang*(7.+fi*2.)-spin*.7)*.4);
      float r=R*(1.+fi*.035-.035)+wob;
      
      
      float g=(d-r)/hw;
      m+=exp(-g*g)*(1.-fi*.22);
    }
    
    
    
    
    float sector=floor((ang+3.14159265)/6.2831853*9.+uProcParams.w*t*.5);
    float ga=(d-R*1.16)/(hw*1.4);
    float arc=step(.62,avfxF_procHash21(vec2(sector,3.7), avfx))
            *exp(-ga*ga)
            *avfxF_safePow(abs(sin(ang*9.+uProcParams.w*t*.5)),6., avfx)
            *smoothstep(0.,.004,amp);
    return clamp(m+arc*.9,0.,2.);
  }
  if(mode==15){
    
    
    
    float R=max(uProcParams.x,.02), soft=max(uProcParams.w,.02);
    float d=length(q), ang=atan(q.y,q.x);
    float pulse=.72+.28*sin(uProcParams.y*t);
    float fill=smoothstep(R+soft,R*(1.-soft),d)*pulse;
    fill*=mix(1.,.55+.45*avfxF_procNoise(vec2(ang*2.4,d*5.-t*.7), avfx),clamp(uProcParams.z,0.,1.));
    return clamp(fill,0.,1.);
  }
  if(mode==16){
    
    
    float r=length(q), ang=atan(q.y,q.x);
    float ta=ang/6.2831853+.5;
    float rings=0.;
    float nr=max(uProcParams.x,1.);
    for(int i=0;i<6;i++){
      if(float(i)>=nr) break;
      
      float rr=.985-float(i)*.215;
      rings+=(1.-smoothstep(0.,.0075,abs(r-rr)))*1.15;
      rings+=(1.-smoothstep(0.,.0045,abs(r-rr+.03)))*.55;
    }
    
    float cells=max(uProcParams.y,1.);
    float ci=floor(ta*cells), cf=fract(ta*cells);
    float glyph=0.;
    for(int k=0;k<3;k++){
      float hk=avfxF_procHash21(vec2(ci*3.7+float(k)*11.3,1.), avfx);
      float rr=.805+.135*avfxF_procHash21(vec2(ci*5.1+float(k)*7.9,2.), avfx);
      float ln=.16+.28*avfxF_procHash21(vec2(ci*2.3+float(k)*19.1,3.), avfx);
      float th=.0055+.0055*avfxF_procHash21(vec2(ci*9.7+float(k)*3.1,4.), avfx);
      glyph+=step(.30,hk)*(1.-smoothstep(0.,th,abs(r-rr)))*smoothstep(ln,ln*.55,abs(cf-.5));
    }
    float spokes=max(uProcParams.z,1.);
    float spoke=step(.5,1.-abs(fract(ta*spokes)-.5)*9.)
              *smoothstep(0.,.02,r-.795)*smoothstep(.955,.94,r);
    glyph+=max(spoke,0.)*.7;
    
    float ci2=floor(ta*cells*.62), cf2=fract(ta*cells*.62);
    float r2=.660+.070*avfxF_procHash21(vec2(ci2*8.3,5.), avfx);
    glyph+=step(.42,avfxF_procHash21(vec2(ci2*2.7+5.5,6.), avfx))*(1.-smoothstep(0.,.006,abs(r-r2)))
          *smoothstep(.30,.16,abs(cf2-.5))*.8;
    
    float m1=avfxF_procNoise(vec2(ta*7.+t*.11, r*3.2-t*.18), avfx);
    float m2=avfxF_procNoise(vec2(ta*4.-t*.07, r*5.4+t*.09), avfx);
    float mist=avfxF_safePow(clamp(m1*.72+m2*.60-.26,0.,1.),1.5, avfx)*smoothstep(.80,.10,r)
             +.34*smoothstep(.84,.10,r);
    float gold=(1.-smoothstep(0.,.016,abs(r-1.030)))*clamp(uProcParams.w,0.,1.);
    return clamp(rings*1.25+glyph*1.0+mist*.72+gold,0.,1.6);
  }
  if(mode==17){
    
    
    
    
    
    float tight=max(uProcParams.x,1.);
    float aniso=max(uProcParams.y,.05);
    float spikes=max(uProcParams.z,1.);
    float fall=max(uProcParams.w,.05);
    vec2 qa=vec2(q.x*aniso,q.y);
    float r=length(qa), rr=length(q);
    float core=exp(-r*r*tight);
    float mid =exp(-r*r*tight*.17)*.44;
    float wide=exp(-r*r*tight*.06)*.12;
    float hstr=exp(-qa.y*qa.y*230.)*exp(-abs(qa.x)*2.4)*.44;
    float vstr=exp(-qa.x*qa.x*330.)*exp(-abs(qa.y)*1.7)*.38;
    float ang=atan(q.y,q.x);
    float spk=avfxF_safePow(max(0.,cos(ang*spikes+.4)),16., avfx)*exp(-rr*fall)*.16;
    float flick=.90+.14*avfxF_procNoise(vec2(ang*2.3,t*3.1), avfx);
    float a=(core*1.35+mid+wide+hstr+vstr+spk)*flick;
    return clamp(a*(1.-smoothstep(0.62,1.,rr)),0.,4.);
  }
  if(mode==18){
    
    
    float n=max(uProcParams.x,1.);
    float jit=clamp(uProcParams.y,0.,1.);
    float sharp=clamp(uProcParams.w,0.,1.);
    float r=length(q), ang=atan(q.y,q.x)+uProcParams.z*t;
    float ta=(ang/6.2831853+.5)*n;
    float idx=floor(ta);
    float len=mix(1.-jit,1.,avfxF_procHash21(vec2(idx,3.1), avfx));
    float f=abs(fract(ta)-.5)*2.;
    float ray=avfxF_safePow(max(0.,1.-f),mix(2.,24.,sharp), avfx);
    float fade=1.-smoothstep(0.,max(len,.02),r);
    return clamp(ray*fade*fade*(1.-smoothstep(0.899,1.,r)),0.,2.);
  }
  if(mode==20){
    
    
    
    
    
    float u=uv.y, v=(uv.x-.5)*2.;
    float w=mix(.30,1.,smoothstep(0.,.62,u))*(1.-smoothstep(.86,1.,u));
    float dd=abs(v)/max(w,1e-3);
    float body=avfxF_safePow(max(0.,1.-dd),2.2, avfx);
    float core=avfxF_safePow(max(0.,1.-dd*max(uProcParams.z,1.)),5., avfx)*smoothstep(.20,.80,u);
    float halo=avfxF_safePow(max(0.,1.-length(vec2((u-.80)*2.1, v*1.05))),max(uProcParams.w,.5), avfx);
    float dash=step(.62,fract(u*max(uProcParams.x,0.)-t*uProcParams.y))
             *avfxF_safePow(max(0.,1.-dd*1.4),3., avfx)*smoothstep(0.,.35,u)*(1.-smoothstep(.55,.85,u));
    return clamp(body*.8+core+halo*1.1+dash*.7,0.,2.);
  }
  if(mode==11){
    
    float edge=.48+.035*sin(q.y*18.-t*10.);
    float side=1.-smoothstep(edge-.025,edge+.025,abs(q.x));
    float ends=1.-smoothstep(.94,1.,abs(q.y));
    return clamp(side*ends,0.,1.);
  }
  return disc;
}
float avfxF_proceduralKey(vec2 p, float t, int mode, inout avfxFContext avfx) {
  vec2 q=p*2.;
  if(mode==17){
    float tight=max(uProcParams.x,1.), aniso=max(uProcParams.y,.05);
    vec2 qa=vec2(q.x*aniso,q.y);
    float r=length(qa);
    float core=exp(-r*r*tight);
    float hstr=exp(-qa.y*qa.y*230.)*exp(-abs(qa.x)*2.4)*.44;
    float vstr=exp(-qa.x*qa.x*330.)*exp(-abs(qa.y)*1.7)*.38;
    return clamp(1.-clamp(core*2.2+(hstr+vstr)*1.1,0.,1.),0.,1.);
  }
  if(mode==18) return clamp(length(q),0.,1.);
  return -1.;
}
float avfxF_stripeHash(float p, inout avfxFContext avfx) { p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float avfxF_stripeTerm(float along, float ring, float t, inout avfxFContext avfx) {
  if(uStripeN<1) return 1.;
  float acc=0., weight=0.;
  float band=floor(ring*15.);
  for(int i=0;i<3;i++){
    if(i>=uStripeN) break;
    vec4 s=uStripeA[i];
    float e=mix(.14,.008,clamp(s.w,0.,1.));
    
    
    float o=s.z*avfxF_stripeHash(band*3.17+1.7+float(i)*7.3, avfx);
    float f=fract(along*s.x - t*s.y + o);
    acc+=smoothstep(.70-e,.70+e,f);
    weight=max(weight,uStripeB[i].x);
  }
  return mix(1., .08+acc*.9, clamp(weight,0.,1.));
}
float avfxF_symC(vec2 p,float r, inout avfxFContext avfx) { return length(p)-r; }
float avfxF_symE(vec2 p,vec2 r, inout avfxFContext avfx) { return (length(p/r)-1.)*min(r.x,r.y); }
float avfxF_symSeg(vec2 p,vec2 a,vec2 b, inout avfxFContext avfx) { vec2 pa=p-a,ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
float avfxF_symStar(vec2 p, float r, float rf, float points, inout avfxFContext avfx) {
  float m=max(points,3.);
  float an=3.141592653589793/m, en=3.141592653589793/mix(3.,m,clamp(rf,0.,1.));
  vec2 acs=vec2(cos(an),sin(an)), ecs=vec2(cos(en),sin(en));
  float bn=mod(atan(p.x,p.y),2.*an)-an;
  p=length(p)*vec2(cos(bn),abs(sin(bn)));
  p-=r*acs;
  p+=ecs*clamp(-dot(p,ecs),0.,r*acs.y/ecs.y);
  return length(p)*sign(p.x);
}
float avfxF_symHeart(vec2 p, inout avfxFContext avfx) {
  p.x=abs(p.x);
  if(p.y+p.x>1.) return sqrt(dot(p-vec2(.25,.75),p-vec2(.25,.75)))-sqrt(2.)/4.;
  vec2 a=p-vec2(0.,1.), b=p-.5*max(p.x+p.y,0.);
  return sqrt(min(dot(a,a),dot(b,b)))*sign(p.x-p.y);
}
void avfxF_symbolShape(vec2 p, float sd, int mode,
                 out float body, out float ring, out float ink,
                 out float high, out float hot, inout avfxFContext avfx) {
  float aa=fwidth(p.x)*1.4+.004;
  float ow=max(uProcParams.x,.0);
  float d=1e3, dInk=1e3, dHot=1e3, dHigh=1e3;
  if(mode==21){
    d=avfxF_symStar(p,.70,clamp(uProcParams.y,.1,.9),max(uProcParams.x,3.), avfx);
    
    
    dHot=avfxF_symStar(p,.70*clamp(uProcParams.w,.05,1.),clamp(uProcParams.y,.1,.9),max(uProcParams.x,3.), avfx);
    ow=max(uProcParams.z,.0);
  } else if(mode==22){
    
    
    float ear=clamp(uProcParams.z,.05,.6);
    d=avfxF_symC(p,.58, avfx);
    d=min(d,avfxF_symC(p-vec2(-.44,.46),ear, avfx));
    d=min(d,avfxF_symC(p-vec2( .44,.46),ear, avfx));
    float expr=floor(fract(sd*7.31)*max(uProcParams.x,1.));
    vec2 el=p-vec2(-.235,.115), er=p-vec2(.235,.115);
    float eye;
    if(expr>.5 && expr<1.5){
      eye=min(abs(avfxF_symC(el,.135, avfx))-.042, abs(avfxF_symC(er,.135, avfx))-.042);
      eye=max(eye,-(p.y-.085));
    } else {
      eye=min(avfxF_symE(el,vec2(.088,.115), avfx), avfxF_symE(er,vec2(.088,.115), avfx));
    }
    float mouth = expr>1.5
      ? avfxF_symE(p-vec2(0.,-.185),vec2(.115,.095), avfx)
      : max(abs(avfxF_symC(p-vec2(0.,.12),.30, avfx))-.038, -(-p.y-.055));
    dInk=min(eye,mouth);
    float inner=min(avfxF_symC(p-vec2(-.44,.47),ear*.49, avfx), avfxF_symC(p-vec2(.44,.47),ear*.49, avfx));
    dHigh=min(inner, avfxF_symE(p-vec2(0.,-.115),vec2(.235,.175)*clamp(uProcParams.w,.1,2.), avfx));
    ow=max(uProcParams.y,.0);
  } else if(mode==23){
    d=avfxF_symHeart((p+vec2(0.,.78))/1.55, avfx)*1.55;
  } else if(mode==24){
    
    float bite=clamp(uProcParams.y,0.,1.);
    d=max(avfxF_symC(p-vec2(-.06,.02),.56, avfx), -avfxF_symC(p-vec2(.26+bite*.2,.24),.50, avfx));
  } else if(mode==25){
    
    float lobes=max(uProcParams.x,1.);
    float rr=clamp(uProcParams.y,.05,.6);
    for(int i=0;i<4;i++){
      if(float(i)>=lobes) break;
      float f=float(i)+sd*13.;
      vec2 o=vec2(avfxF_procHash21(vec2(f,1.), avfx)-.5, avfxF_procHash21(vec2(f+3.1,2.), avfx)-.5)*.72;
      d=min(d, length(p-o)-(rr+.16*avfxF_procHash21(vec2(f+7.3,3.), avfx)));
    }
    
    dHigh=d+.16-.30*(p.y*.5+.5);
    ow=.0;
  } else {
    
    float w=max(uProcParams.x,.02)*(1.-clamp(uProcParams.y,0.,.9)*abs(p.y));
    float seg=avfxF_symSeg(p,vec2(-.30,.86),vec2(.16,.16), avfx);
    seg=min(seg,avfxF_symSeg(p,vec2(.16,.16),vec2(-.16,-.02), avfx));
    seg=min(seg,avfxF_symSeg(p,vec2(-.16,-.02),vec2(.30,-.86), avfx));
    d=seg-w;
    ow=.0;
  }
  body=smoothstep(aa,-aa,d);
  ring=ow>0. ? max(smoothstep(aa,-aa,d-ow)-body,0.) : 0.;
  ink=smoothstep(aa,-aa,dInk)*body;
  high=smoothstep(aa,-aa,dHigh)*body;
  hot=smoothstep(aa,-aa,dHot)*body;
}
float avfxF_screentoneAt(vec2 uvp, vec3 wp, inout avfxFContext avfx) {
  if(uScreenOn<.5) return 0.;
  vec2 q = uScreenWorld>.5 ? wp.xy : uvp;
  vec2 g=fract(q/max(uScreenPitch,1e-3))-.5;
  return smoothstep(.36,.24,length(g));
}
float avfxF_particleRampKey(float mode, inout avfxFContext avfx) {
  if(mode>4.5) return clamp(avfx.vUv.y,0.,1.);
  if(mode>3.5) return clamp(length((avfx.vUv-.5)*2.),0.,1.);
  if(mode>2.5) return clamp((avfx.vWp.y-uGroundY)/max(uHeightSpan,1e-3),0.,1.);
  return clamp(avfx.vU,0.,1.);
}
vec3 avfxF_smokeNormal(vec2 uv, inout avfxFContext avfx) {
  vec2 xy=uv*2.-1.;
  float z=sqrt(max(0.,1.-dot(xy,xy)));
  return normalize(uSmokeRight*xy.x+uSmokeUp*xy.y+uSmokeForward*max(z,.01));
}
vec3 avfxF_smokeLighting(vec3 normal, vec3 world, inout avfxFContext avfx) {
  vec3 light=vec3(uSmokeAmbient);
  for(int i=0;i<4;i++){
    vec3 delta=uSmokeLights[i].xyz-world;
    float d=length(delta);
    vec3 direction=delta/max(d,.001);
    float wrap=clamp((dot(normal,direction)+.5)/1.5,0.,1.);
    float rangeFade=1.-smoothstep(uSmokeLights[i].w*.75,uSmokeLights[i].w,d);
    float attenuation=rangeFade/max(pow(max(d,.25),uSmokeLights[i+4].w),1.);
    light+=uSmokeLights[i+4].rgb*wrap*attenuation;
  }
  return light;
}
void avfxF_main(inout avfxFContext avfx) {
  if(avfx.vAlpha<=0.) discard;
  if(uProcedural>=21){
    
    
    
    vec2 sp=(avfx.vUv-.5)*2.;
    float body,ring,ink,high,hot;
    avfxF_symbolShape(sp,avfx.vSeed.x,uProcedural,body,ring,ink,high,hot, avfx);
    float a=(body+ring)*avfx.vAlpha*uOpacity*uFlicker*avfxF_softDepth(avfx);
    if(body+ring<.004 || a<.003) discard;
    float tone=avfxF_screentoneAt(avfx.vUv,avfx.vWp, avfx)*body;
    vec3 col=mix(uSymFill,uScreenCol,tone*.55);
    col=mix(col,uSymHigh,high*.85);
    col=mix(col,uSymHot,hot*uSymHotA);
    col=mix(col,uSymOutline,ring);
    col=mix(col,uSymInk,ink);
    col*=1.+hot*uSymHotA*uSymHotI;
    if(uBlendMode==1) avfx.gl_FragColor=vec4(col,clamp(a,0.,1.));
    else avfx.gl_FragColor=vec4(col*a,clamp(a,0.,1.));
    return;
  }
  
  
  float rot=avfx.vRot+uMaskRot;
  vec2 p=avfx.vUv-.5; float c=cos(rot), s=sin(rot); p=avfxMat2(c,-s,s,c)*p; vec2 uvp=p+.5;
  float n=.5;
  
  
  bool needsNoise=uUseErosion==1 || abs(uDistort)>0. ||
    (uHasMask==0 && (uProcedural==1 || uProcedural==2));
  if(needsNoise && uHasNoise==1){
    vec2 nuv=uvp*uNoiseScale+uNoisePan*uTime+avfx.vSeed.xy*7.;
    float n1=texture(uNoise,nuv).r;
    float n2=texture(uNoise,nuv*1.7+vec2(.3,.1)-uNoisePan*uTime*.6).r;
    n=n1*.65+n2*.35;
  } else if(needsNoise) {
    n=.5+.5*avfxF_fbm3(vec3(uvp*uNoiseScale*2.+uNoisePan*uTime, avfx.vSeed.x*17.), avfx);
  }
  
  
  float nd=n;
  vec2 dp=uDistortPan*uTime;
  if(abs(uDistort)>0. && dot(dp,dp)>0.){
    if(uHasNoise==1) nd=texture(uNoise, uvp*uNoiseScale+uNoisePan*uTime+dp+avfx.vSeed.xy*7.).r;
    else nd=.5+.5*avfxF_fbm3(vec3(uvp*uNoiseScale*2.+uNoisePan*uTime+dp, avfx.vSeed.x*17.), avfx);
  }
  vec2 duv=uvp+(nd-.5)*uDistort*(.4+avfx.vU);
  float inside=step(0.,duv.x)*step(duv.x,1.)*step(0.,duv.y)*step(duv.y,1.);
  vec2 muv=duv*uMaskScale+uMaskPan;
  vec2 auv=vec2(muv.x/float(max(uAtlasCols,1)), muv.y/float(max(uAtlasRows,1)))+avfx.vTile;
  float shape;
  if(uHasMask==1){
    vec4 m=texture(uMask,auv);
    shape=m.a*max(m.r,max(m.g,m.b));
    if(avfx.vFrameMix>0.){
      vec4 next=texture(uMask,auv-avfx.vTile+avfx.vNextTile);
      shape=mix(shape,next.a*max(next.r,max(next.g,next.b)),avfx.vFrameMix);
    }
  }
  else shape=avfxF_proceduralShape(p,uvp,n,uTime,0.,uMaskScale,vec3(1.,1.,.1),uProcedural, avfx);
  shape*=inside;
  float er=shape, edge=0.;
  if(uUseErosion==1){
    float th=avfxF_curveC(avfx.vU, avfx);
    float field=shape*(.35+n*.9);
    er=smoothstep(th,th+uErodeSoft,field);
    edge=smoothstep(th-uEdgeW,th+uErodeSoft*.5,field)-er;
  }
  
  
  
  
  
  float key = avfxF_particleRampKey(uRampKeyMode, avfx);
  if(uRampBlendWeight>0.)
    key = mix(key, avfxF_particleRampKey(uRampBlendMode, avfx), uRampBlendWeight);
  vec3 col=avfxF_rampColor(key, avfx);
  if(uSmokeLit==1) col*=avfxF_smokeLighting(avfxF_smokeNormal(avfx.vUv, avfx),avfx.vWp, avfx);
  col+=uEdgeCol*uEdgeI*edge*shape;
  
  
  float a=er*avfx.vAlpha*uOpacity*uFlicker*avfxF_softDepth(avfx);
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
vRot=avfx.vRot;
vSeed=avfx.vSeed;
vTile=avfx.vTile;
vNextTile=avfx.vNextTile;
vFrameMix=avfx.vFrameMix;
vWp=avfx.vWp;
}
void fragment() {
  avfxFContext avfx;
  avfx.vUv=vUv;
avfx.vU=vU;
avfx.vAlpha=vAlpha;
avfx.vRot=vRot;
avfx.vSeed=vSeed;
avfx.vTile=vTile;
avfx.vNextTile=vNextTile;
avfx.vFrameMix=vFrameMix;
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
