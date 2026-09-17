shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform float uTime;
uniform float uHead;
uniform float uTail;
uniform float uWidth;
uniform float uMorph;
uniform float uSpread;
uniform float uWidthJitter;
uniform float uPhaseJitter;
uniform float uTaperHead;
uniform float uTaperTail;
uniform float uOrientPath;
uniform int uPathType;
uniform vec3 uPathA;
uniform vec3 uPathB;
uniform vec3 uPathC;
uniform vec4 uPathD;
uniform vec2 uPathW;
uniform int uMorphPathType;
uniform vec3 uMorphPathA;
uniform vec3 uMorphPathB;
uniform vec3 uMorphPathC;
uniform vec4 uMorphPathD;
uniform vec2 uMorphPathW;
uniform float uOpacity;
uniform float uCore;
uniform int uBlendMode;
uniform vec4 uRamp[6];
uniform float uRampT[6];
uniform int uRampN;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying float vSide;
varying float vW;
varying float vStrand;
varying float vFade;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
float vSide;
float vW;
float vStrand;
float vFade;
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
vec3 avfxV_pathPoint(float u, inout avfxVContext avfx) {
  if(uPathType==1){
    float m=1.-u;
    return m*m*uPathA+2.*m*u*uPathB+u*u*uPathC;
  }
  float th=6.28318530718*uPathD.z*u+uPathD.w;
  float r=uPathD.x+uPathW.x*sin(uPathW.y*th);
  float y=uPathA.y+uPathD.y*u
        +uPathW.x*.5*sin(uPathW.y*th*2.+1.3);
  return vec3(uPathA.x+cos(th)*r, y, uPathA.z+sin(th)*r);
}
vec3 avfxV_pathTangent(float u, inout avfxVContext avfx) {
  vec3 d=avfxV_pathPoint(u+1e-3, avfx)-avfxV_pathPoint(u-1e-3, avfx);
  float l=length(d);
  return l>1e-6 ? d/l : vec3(0.,0.,1.);
}
vec3 avfxV_pathSide(float u, inout avfxVContext avfx) {
  return normalize(cross(avfxV_pathTangent(u, avfx), vec3(0.,1.,0.))+vec3(1e-5,0.,0.));
}
vec3 avfxV_pathUp(float u, inout avfxVContext avfx) {
  return normalize(cross(avfxV_pathSide(u, avfx), avfxV_pathTangent(u, avfx)));
}
vec3 avfxV_pathPointM(float u, inout avfxVContext avfx) {
  if(uMorphPathType==1){
    float m=1.-u;
    return m*m*uMorphPathA+2.*m*u*uMorphPathB+u*u*uMorphPathC;
  }
  float th=6.28318530718*uMorphPathD.z*u+uMorphPathD.w;
  float r=uMorphPathD.x+uMorphPathW.x*sin(uMorphPathW.y*th);
  float y=uMorphPathA.y+uMorphPathD.y*u
        +uMorphPathW.x*.5*sin(uMorphPathW.y*th*2.+1.3);
  return vec3(uMorphPathA.x+cos(th)*r, y, uMorphPathA.z+sin(th)*r);
}
vec3 avfxV_pathTangentM(float u, inout avfxVContext avfx) {
  vec3 d=avfxV_pathPointM(u+1e-3, avfx)-avfxV_pathPointM(u-1e-3, avfx);
  float l=length(d);
  return l>1e-6 ? d/l : vec3(0.,0.,1.);
}
vec3 avfxV_pathSideM(float u, inout avfxVContext avfx) {
  return normalize(cross(avfxV_pathTangentM(u, avfx), vec3(0.,1.,0.))+vec3(1e-5,0.,0.));
}
vec3 avfxV_pathUpM(float u, inout avfxVContext avfx) {
  return normalize(cross(avfxV_pathSideM(u, avfx), avfxV_pathTangentM(u, avfx)));
}
float avfxV_ribbonHash(float p, inout avfxVContext avfx) { p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
vec3 avfxV_sweep(float u, inout avfxVContext avfx) {
  float ua=uPathType==1?clamp(u,0.,1.):fract(u);
  float ub=uMorphPathType==1?clamp(u,0.,1.):fract(u);
  return mix(avfxV_pathPoint(ua, avfx), avfxV_pathPointM(ub, avfx), uMorph);
}
void avfxV_main(inout avfxVContext avfx) {
  float w=avfx.position.x, side=avfx.position.y, strand=avfx.position.z;
  float hs=avfxV_ribbonHash(strand*11.7+3.1, avfx);
  
  
  float u=uHead-(1.-w)*uTail+(hs-.5)*uPhaseJitter*uTail;
  vec3 p=avfxV_sweep(u, avfx);
  vec3 tangent=normalize(avfxV_sweep(u+1e-3, avfx)-avfxV_sweep(u-1e-3, avfx)+vec3(0.,0.,1e-6));
  vec3 sd=normalize(cross(tangent,vec3(0.,1.,0.))+vec3(1e-5,0.,0.));
  vec3 upn=normalize(cross(sd,tangent));
  p+=sd*((hs-.5)*uSpread)+upn*((avfxV_ribbonHash(strand*3.7+9.1, avfx)-.5)*uSpread);
  vec4 world=avfx.modelMatrix*vec4(p,1.);
  
  float fade=smoothstep(0.,max(uTaperTail,1e-4),w)*smoothstep(1.,1.-max(uTaperHead,1e-4),w);
  
  float strandW=mix(1.-uWidthJitter,1.,hs);
  float half_=uWidth*.5*strandW*fade;
  vec3 worldTangent=normalize(mat3(avfx.modelMatrix)*tangent+vec3(0.,0.,1e-6));
  vec3 view=normalize(avfx.cameraPosition-world.xyz);
  vec3 across=uOrientPath>.5
    ? normalize(mat3(avfx.modelMatrix)*upn)
    : normalize(cross(worldTangent,view));
  avfx.vSide=side; avfx.vW=w; avfx.vStrand=hs; avfx.vFade=fade;
  avfx.gl_Position=avfx.projectionMatrix*avfx.viewMatrix*vec4(world.xyz+across*side*half_,1.);
}
struct avfxFContext {
float vSide;
float vW;
float vStrand;
float vFade;
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
  if(avfx.vFade<=0.) discard;
  
  float q=abs(avfx.vSide);
  float core=exp(-q*q*9.), halo=exp(-q*q*1.6);
  float flicker=.85+.15*sin(avfx.vW*40.+uTime*6.+avfx.vStrand*9.);
  vec3 col=avfxF_rampColor(q, avfx)*(core*1.5*uCore+halo*.30)*flicker;
  float a=avfx.vFade*uOpacity*(core*.9+halo*.35);
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
  
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vSide=avfx.vSide;
vW=avfx.vW;
vStrand=avfx.vStrand;
vFade=avfx.vFade;
}
void fragment() {
  avfxFContext avfx;
  avfx.vSide=vSide;
avfx.vW=vW;
avfx.vStrand=vStrand;
avfx.vFade=vFade;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
