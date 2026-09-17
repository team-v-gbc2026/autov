shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform float uTime;
uniform float uHeight;
uniform float uWidthK;
uniform float uSpan;
uniform float uWidth;
uniform float uMinWidth;
uniform float uJitterAmp;
uniform float uJitterFreq;
uniform float uJitterFold;
uniform float uSkip;
uniform vec2 uRadius;
uniform vec2 uPitch;
uniform vec2 uPeriod;
uniform vec2 uOnTime;
uniform vec3 uCore;
uniform vec3 uHalo;
uniform float uOpacity;
uniform float uFlicker;
uniform int uBlendMode;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying vec2 vUv;
varying float vA;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
float aSeed;
vec2 vUv;
float vA;
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
float avfxV_arcHash(float p, inout avfxVContext avfx) { p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float avfxV_arcNoise(float a, float b, inout avfxVContext avfx) {
  float n=avfxV_fbm3(vec3(a,b,1.7), avfx);
  return mix(n, abs(n)*2.-1., clamp(uJitterFold,0.,1.));
}
vec3 avfxV_arcPoint(float u, float s, float k, inout avfxVContext avfx) {
  float r  = mix(uRadius.x,uRadius.y,avfxV_arcHash(s*3.11+k*1.7, avfx))*uWidthK;
  float pv = mix(uPitch.x,uPitch.y,avfxV_arcHash(s*7.73+k*2.3, avfx));
  float y0 = avfxV_arcHash(s*5.31+k*3.1, avfx)*uSpan*.74;
  float ln = uSpan*(.18+.37*avfxV_arcHash(s*11.1+k*.7, avfx));
  float ph = avfxV_arcHash(s*13.7+k*4.9, avfx)*6.2831853;
  float y  = (y0+u*ln)*uHeight;
  float a  = ph+u*pv*6.2831853;
  float j1 = avfxV_arcNoise(u*uJitterFreq, s*3.1+k*.31, avfx);
  float j2 = avfxV_arcNoise(u*uJitterFreq*2.4+7., s*5.7+k*.73, avfx);
  float j3 = avfxV_fbm3(vec3(u*uJitterFreq*4.2+3., s*7.9+k*1.13, .9), avfx)*.5;
  r *= 1.+uJitterAmp*(.70*j1+.22*j3);
  a += uJitterAmp*(1.45*j2+.40*j3);
  return vec3(cos(a)*r, y, sin(a)*r);
}
void avfxV_main(inout avfxVContext avfx) {
  float s=avfx.aSeed, u=avfx.position.x, side=avfx.position.y;
  
  
  float per=mix(uPeriod.x,uPeriod.y,avfxV_arcHash(s*1.71, avfx));
  float onT=mix(uOnTime.x,uOnTime.y,avfxV_arcHash(s*2.93, avfx));
  float off=avfxV_arcHash(s*4.37, avfx)*per;
  float k=floor((uTime-off)/max(per,1e-4));
  float loc=(uTime-off)-k*max(per,1e-4);
  float live=step(loc,onT)*step(uSkip,avfxV_arcHash(k*1.373+s*9.11, avfx));
  float w=sin(3.14159265*clamp(loc/max(onT,1e-4),0.,1.));
  avfx.vA=live*w*(.55+.45*avfxV_arcHash(k*2.11+s*5.5, avfx));
  avfx.vUv=vec2(u,side*.5+.5);
  vec3 a3=avfxV_arcPoint(u,s,k, avfx);
  vec3 b3=avfxV_arcPoint(min(u+.035,1.)+(u>.965?-.070:0.),s,k, avfx);
  vec4 mv=avfx.modelViewMatrix*vec4(a3,1.);
  vec4 mb=avfx.modelViewMatrix*vec4(b3,1.);
  vec2 d=mb.xy-mv.xy;
  vec2 pp=length(d)>1e-5 ? normalize(vec2(-d.y,d.x)) : vec2(1.,0.);
  
  
  float wid=max(uWidth*.5*(.55+.45*sin(3.14159265*u)), -mv.z*uMinWidth);
  mv.xy+=pp*side*wid;
  avfx.gl_Position=avfx.projectionMatrix*mv;
}
struct avfxFContext {
vec2 vUv;
float vA;
vec4 gl_FragColor;
vec4 gl_FragCoord;
bool gl_FrontFacing;
mat4 viewMatrix;
mat4 inverseProjection;
vec2 screenUv;
};
void avfxF_main(inout avfxFContext avfx) {
  if(avfx.vA<=0.) discard;
  float y=abs(avfx.vUv.y-.5)*2.;
  float core=1.-smoothstep(.10,.55,y);    
  float halo=1.-smoothstep(.30,1.00,y);   
  float ends=smoothstep(0.,.06,avfx.vUv.x)*(1.-smoothstep(.94,1.,avfx.vUv.x));
  vec3 c=uCore*core*1.85+uHalo*halo*.75;
  float a=avfx.vA*ends*uOpacity*uFlicker;
  if(a<.002) discard;
  if(uBlendMode==1) avfx.gl_FragColor=vec4(c,a);
  else avfx.gl_FragColor=vec4(c*a,a);
}
void vertex() {
  avfxVContext avfx;
  avfx.position=VERTEX; avfx.normal=NORMAL; avfx.uv=UV;
  avfx.modelMatrix=MODEL_MATRIX; avfx.modelViewMatrix=MODELVIEW_MATRIX;
  avfx.viewMatrix=VIEW_MATRIX; avfx.projectionMatrix=PROJECTION_MATRIX;
  avfx.normalMatrix=MODELVIEW_NORMAL_MATRIX; avfx.cameraPosition=CAMERA_POSITION_WORLD;
  avfx.aSeed=texelFetch(avfxAttributes,ivec2((int(UV2.x)*1+0)%avfxAttributeWidth,(int(UV2.x)*1+0)/avfxAttributeWidth),0).x;
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vUv=avfx.vUv;
vA=avfx.vA;
}
void fragment() {
  avfxFContext avfx;
  avfx.vUv=vUv;
avfx.vA=vA;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
