shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform vec3 uShadow;
uniform vec3 uBody;
uniform vec3 uHigh;
uniform vec3 uRim;
uniform vec3 uLight;
uniform vec3 uCam;
uniform vec2 uBands;
uniform float uRimPow;
uniform float uRimAmt;
uniform float uOpacity;
uniform float uTear;
uniform float uTearScale;
uniform float uBandCount;
uniform int uBlendMode;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vSeed;
varying float vAge;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
float aSheetSeed;
float aSheetAge;
vec3 vN;
vec3 vW;
vec2 vUv;
float vSeed;
float vAge;
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
void avfxV_main(inout avfxVContext avfx) {
  avfx.vSeed=avfx.aSheetSeed;
  avfx.vAge=avfx.aSheetAge;
  avfx.vUv=avfx.uv;
  vec4 wp=avfx.modelMatrix*vec4(avfx.position,1.);
  avfx.vN=normalize(mat3(avfx.modelMatrix)*avfx.normal);
  avfx.vW=wp.xyz;
  avfx.gl_Position=avfx.projectionMatrix*avfx.viewMatrix*wp;
}
struct avfxFContext {
vec3 vN;
vec3 vW;
vec2 vUv;
float vSeed;
float vAge;
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
  
  
  
  
  if(uTear>0.){
    float tear=uTear*(.7+.6*avfx.vAge);
    float fld=.5+.5*avfxF_snoise(vec3(avfx.vUv.x*uTearScale, avfx.vUv.y*uTearScale*.65, avfx.vSeed), avfx);
    float edge=min(min(avfx.vUv.x,1.-avfx.vUv.x)*2.2, min(avfx.vUv.y,1.-avfx.vUv.y)*1.5);
    if(edge+fld*.55 < tear) discard;
  }
  vec3 N=normalize(avfx.vN);
  if(!avfx.gl_FrontFacing) N=-N;
  float ndl=dot(N,normalize(uLight))*.5+.5;
  vec3 c = uBandCount>2.5
    ? (ndl<uBands.x ? uShadow : (ndl<uBands.y ? uBody : uHigh))
    : (ndl<uBands.x ? uShadow : uHigh);
  vec3 V=normalize(uCam-avfx.vW);
  float rim=pow(max(1.-clamp(dot(N,V),0.,1.),1e-4),uRimPow);
  c+=uRim*rim*uRimAmt;
  if(uBlendMode==1) avfx.gl_FragColor=vec4(c,uOpacity);
  else avfx.gl_FragColor=vec4(c*uOpacity,uOpacity);
}
void vertex() {
  avfxVContext avfx;
  avfx.position=VERTEX; avfx.normal=NORMAL; avfx.uv=UV;
  avfx.modelMatrix=MODEL_MATRIX; avfx.modelViewMatrix=MODELVIEW_MATRIX;
  avfx.viewMatrix=VIEW_MATRIX; avfx.projectionMatrix=PROJECTION_MATRIX;
  avfx.normalMatrix=MODELVIEW_NORMAL_MATRIX; avfx.cameraPosition=CAMERA_POSITION_WORLD;
  avfx.aSheetSeed=texelFetch(avfxAttributes,ivec2((int(UV2.x)*2+0)%avfxAttributeWidth,(int(UV2.x)*2+0)/avfxAttributeWidth),0).x;
avfx.aSheetAge=texelFetch(avfxAttributes,ivec2((int(UV2.x)*2+1)%avfxAttributeWidth,(int(UV2.x)*2+1)/avfxAttributeWidth),0).x;
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vN=avfx.vN;
vW=avfx.vW;
vUv=avfx.vUv;
vSeed=avfx.vSeed;
vAge=avfx.vAge;
}
void fragment() {
  avfxFContext avfx;
  avfx.vN=vN;
avfx.vW=vW;
avfx.vUv=vUv;
avfx.vSeed=vSeed;
avfx.vAge=vAge;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
