shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform float uTime;
uniform float uSpan;
uniform float uGrowDur;
uniform float uOvershoot;
uniform float uInflate;
uniform float uHasCollapse;
uniform float uCollapseStart;
uniform float uCollapseDur;
uniform vec3 uTip;
uniform vec3 uFace;
uniform vec3 uEdge;
uniform vec3 uCam;
uniform float uFresPow;
uniform float uGlintFreq;
uniform float uGlintSpeed;
uniform float uOpacity;
uniform float uFlat;
uniform int uBlendMode;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying vec3 vN;
varying vec3 vW;
varying float vAlong;
varying float vSeed;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
vec3 aDir;
vec3 aOrg;
float aLen;
float aWid;
float aT0;
float aSeed;
float aAlong;
vec3 vN;
vec3 vW;
float vAlong;
float vSeed;
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
void avfxV_main(inout avfxVContext avfx) {
  float born=avfx.aT0*uSpan;
  
  float u=clamp((uTime-born)/max(uGrowDur,1e-4),0.,1.);
  float s=u>=1. ? 1. : u*u*((uOvershoot+1.)*u-uOvershoot);
  s=max(s,0.);
  if(uHasCollapse>.5){
    float from=uCollapseStart*uSpan+avfx.aSeed*uCollapseDur*1.125;
    s*=1.-smoothstep(from,from+max(uCollapseDur,1e-4),uTime);
  }
  
  s*=1.+.035*sin(uTime*2.1+avfx.aSeed*6.2831853);

  vec3 up=avfxV_safeDir(avfx.aDir, vec3(0.,1.,0.), avfx);
  vec3 ref=abs(up.y)>.95 ? vec3(1.,0.,0.) : vec3(0.,1.,0.);
  vec3 rt=avfxV_safeDir(cross(ref,up), vec3(1.,0.,0.), avfx);
  vec3 fw=cross(up,rt);
  
  float tw=avfx.aSeed*6.2831853, ct=cos(tw), st=sin(tw);
  vec2 pxz=vec2(avfx.position.x*ct-avfx.position.z*st, avfx.position.x*st+avfx.position.z*ct);
  vec2 nxz=vec2(avfx.normal.x*ct-avfx.normal.z*st, avfx.normal.x*st+avfx.normal.z*ct);

  float L=avfx.aLen*s, W=avfx.aWid*(.35+.65*s);
  vec3 lp=vec3(pxz.x*W, avfx.position.y*L, pxz.y*W);
  
  
  lp+=avfxV_safeDir(vec3(pxz.x, avfx.position.y*.25, pxz.y), vec3(0.,1.,0.), avfx)*uInflate*(.6+.4*s);
  vec3 wp=avfx.aOrg+rt*lp.x+up*lp.y+fw*lp.z;
  vec3 ln=avfxV_safeDir(vec3(nxz.x*L, avfx.normal.y*W, nxz.y*L), vec3(0.,1.,0.), avfx);
  avfx.vN=avfxV_safeDir(rt*ln.x+up*ln.y+fw*ln.z, up, avfx);
  vec4 world=avfx.modelMatrix*vec4(wp,1.);
  avfx.vW=world.xyz;
  avfx.vAlong=avfx.aAlong; avfx.vSeed=avfx.aSeed;
  avfx.gl_Position=avfx.projectionMatrix*avfx.viewMatrix*world;
}
struct avfxFContext {
vec3 vN;
vec3 vW;
float vAlong;
float vSeed;
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
void avfxF_main(inout avfxFContext avfx) {
  
  
  if(uFlat>.5){
    vec3 c=mix(uEdge*.16,uEdge*.55,smoothstep(.05,.85,avfx.vAlong));
    avfx.gl_FragColor=vec4(c*uOpacity,uOpacity);
    return;
  }
  vec3 n=avfxF_safeDir(avfx.vN, vec3(0.,1.,0.), avfx);
  vec3 v=avfxF_safeDir(uCam-avfx.vW, vec3(0.,0.,1.), avfx);
  float ndv=abs(dot(n,v));
  float fres=avfxF_safePow(1.-ndv,uFresPow, avfx);
  
  float lam=.42+.58*clamp(dot(n,normalize(vec3(.25,.9,.4)))*.5+.5,0.,1.);
  vec3 col=uFace*(.30+.50*lam);
  
  
  float tip=smoothstep(.18,.92,avfx.vAlong);
  col=mix(col,uTip*1.30,tip*.94);
  col*=mix(1.,.55,tip);
  col=mix(col,uEdge,fres*.30*(1.-tip*.55));
  
  float gb=sin((avfx.vAlong*uGlintFreq-uTime*uGlintSpeed+avfx.vSeed*6.2831853)*3.14159265);
  col+=uEdge*avfxF_safePow(max(gb,0.),22., avfx)*(.35+.65*fres)*.9;
  
  
  float ice=.5+.5*avfxF_fbm3(vec3(avfx.vAlong*9.+avfx.vSeed*17., avfx.vSeed*31.+avfx.vW.y*4., 1.7), avfx);
  col*=(.88+.26*ice)*(.72+.56*fract(avfx.vSeed*13.7+2.1));
  col+=uTip*avfxF_safePow(1.-ndv,3., avfx)*.60;
  float a=clamp(.80+fres*.20,0.,1.)*uOpacity;
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
  avfx.aDir=texelFetch(avfxAttributes,ivec2((int(UV2.x)*7+0)%avfxAttributeWidth,(int(UV2.x)*7+0)/avfxAttributeWidth),0).xyz;
avfx.aOrg=texelFetch(avfxAttributes,ivec2((int(UV2.x)*7+1)%avfxAttributeWidth,(int(UV2.x)*7+1)/avfxAttributeWidth),0).xyz;
avfx.aLen=texelFetch(avfxAttributes,ivec2((int(UV2.x)*7+2)%avfxAttributeWidth,(int(UV2.x)*7+2)/avfxAttributeWidth),0).x;
avfx.aWid=texelFetch(avfxAttributes,ivec2((int(UV2.x)*7+3)%avfxAttributeWidth,(int(UV2.x)*7+3)/avfxAttributeWidth),0).x;
avfx.aT0=texelFetch(avfxAttributes,ivec2((int(UV2.x)*7+4)%avfxAttributeWidth,(int(UV2.x)*7+4)/avfxAttributeWidth),0).x;
avfx.aSeed=texelFetch(avfxAttributes,ivec2((int(UV2.x)*7+5)%avfxAttributeWidth,(int(UV2.x)*7+5)/avfxAttributeWidth),0).x;
avfx.aAlong=texelFetch(avfxAttributes,ivec2((int(UV2.x)*7+6)%avfxAttributeWidth,(int(UV2.x)*7+6)/avfxAttributeWidth),0).x;
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vN=avfx.vN;
vW=avfx.vW;
vAlong=avfx.vAlong;
vSeed=avfx.vSeed;
}
void fragment() {
  avfxFContext avfx;
  avfx.vN=vN;
avfx.vW=vW;
avfx.vAlong=vAlong;
avfx.vSeed=vSeed;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
