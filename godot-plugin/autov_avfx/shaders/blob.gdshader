shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform float uTime;
uniform float uNoiseSpeed;
uniform vec3 uShadow;
uniform vec3 uBody;
uniform vec3 uHigh;
uniform vec3 uRimCol;
uniform vec3 uLight;
uniform float uBands;
uniform float uBandA;
uniform float uBandB;
uniform float uRimPow;
uniform float uRimAmt;
uniform float uFlat;
uniform float uRampKeyMode;
uniform float uLayerU;
uniform float uGroundY;
uniform float uHeightSpan;
uniform float uUseToon;
uniform float uToonRamp;
uniform float uToonShadowScale;
uniform float uToonHighMix;
uniform float uRampBlendMode;
uniform float uRampBlendWeight;
uniform float uLightOn;
uniform float uLightFall;
uniform vec3 uLightPos;
uniform int uBlendMode;
uniform vec4 uRamp[6];
uniform float uRampT[6];
uniform int uRampN;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWp;
varying vec3 vLobe;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
vec3 vN;
vec3 vV;
vec3 vWp;
vec3 vLobe;
vec4 aLobeA;
vec4 aLobeB;
vec4 aLobeC;
vec4 aLobeP;
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
float avfxV_lobeR(vec3 n, inout avfxVContext avfx) {
  vec3 q=n*avfx.aLobeA.z+vec3(avfx.aLobeA.x*7.3,avfx.aLobeA.x*3.1-uTime*uNoiseSpeed,avfx.aLobeA.x*11.7);
  float f=.6*avfxV_snoise(q, avfx)+.3*avfxV_snoise(q*2.1+5., avfx)+.15*avfxV_snoise(q*4.3+11., avfx);
  
  return 1.+avfx.aLobeA.y*(.45*f+.55*abs(f));
}
vec3 avfxV_lobeP(vec3 n, inout avfxVContext avfx) {
  vec3 p=n*avfxV_lobeR(n, avfx);
  float s=clamp(p.y*.5+.5,0.,1.);
  p.xz*=mix(1.,1.-avfx.aLobeB.y,smoothstep(.2,1.,s));
  float a=avfx.aLobeB.x*p.y;
  p.xy=avfxMat2(cos(a),-sin(a),sin(a),cos(a))*p.xy;
  p.xy=avfxMat2(cos(avfx.aLobeB.z),-sin(avfx.aLobeB.z),sin(avfx.aLobeB.z),cos(avfx.aLobeB.z))*p.xy;
  p.y*=avfx.aLobeA.w;
  return p;
}
void avfxV_main(inout avfxVContext avfx) {
  avfx.vLobe=avfx.aLobeC.xyz;
  vec3 n=avfxV_safeDir(avfx.position, vec3(0.,1.,0.), avfx);
  vec3 p=avfxV_lobeP(n, avfx);
  
  vec3 up=abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.);
  vec3 t1=avfxV_safeDir(cross(n,up), vec3(1.,0.,0.), avfx);
  vec3 t2=avfxV_safeDir(cross(n,t1), vec3(0.,0.,1.), avfx);
  float e=.055;
  vec3 nrm=avfxV_safeDir(cross(avfxV_lobeP(avfxV_safeDir(n+t1*e,n, avfx), avfx)-p, avfxV_lobeP(avfxV_safeDir(n+t2*e,n, avfx), avfx)-p), n, avfx);
  if(dot(nrm,n)<0.) nrm=-nrm;
  
  p+=nrm*avfx.aLobeB.w;
  
  p=p*avfx.aLobeP.w+avfx.aLobeP.xyz;
  vec4 wp=avfx.modelMatrix*vec4(p,1.);
  avfx.vWp=wp.xyz;
  avfx.vN=avfxV_safeDir(mat3(avfx.modelMatrix)*nrm, vec3(0.,1.,0.), avfx);
  avfx.vV=avfxV_safeDir(avfx.cameraPosition-wp.xyz, vec3(0.,0.,1.), avfx);
  avfx.gl_Position=avfx.projectionMatrix*avfx.viewMatrix*wp;
}
struct avfxFContext {
vec3 vN;
vec3 vV;
vec3 vWp;
vec3 vLobe;
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
vec3 avfxF_safeDirLocal(vec3 v, inout avfxFContext avfx) { float l=length(v); return l>1e-5 ? v/l : vec3(0.,1.,0.); }
float avfxF_lobeRampKey(float mode, inout avfxFContext avfx) {
  return mode>2.5
    ? clamp((avfx.vWp.y-uGroundY)/max(uHeightSpan,1e-3),0.,1.)
    : (mode>0.5 && mode<1.5 ? clamp(uLayerU,0.,1.) : clamp(avfx.vLobe.x,0.,1.));
}
float avfxF_lobeRampKeyBlended(inout avfxFContext avfx) {
  float key=avfxF_lobeRampKey(uRampKeyMode, avfx);
  if(uRampBlendWeight>0.) key=mix(key,avfxF_lobeRampKey(uRampBlendMode, avfx),uRampBlendWeight);
  return key;
}
void avfxF_main(inout avfxFContext avfx) {
  
  if(uFlat>.5){ avfx.gl_FragColor=vec4(uShadow*avfx.vLobe.y*avfx.vLobe.z,avfx.vLobe.z); return; }
  vec3 c;
  if(uUseToon>.5){
    vec3 N=avfxF_safeDirLocal(avfx.vN, avfx);
    
    
    
    
    vec3 L=avfxF_safeDirLocal(uLight, avfx);
    float fall=1.;
    if(uLightOn>.5){
      vec3 toLight=uLightPos-avfx.vWp;
      float dist=length(toLight);
      L=avfxF_safeDirLocal(toLight, avfx);
      fall=1./(1.+uLightFall*dist*uLightFall*dist);
    }
    float ndl=dot(N,L)*.5+.5;
    
    
    
    
    vec3 body=uBody, shadow=uShadow, high=uHigh;
    if(uToonRamp>.5){
      body=avfxF_rampColor(avfxF_lobeRampKeyBlended(avfx), avfx);
      shadow=mix(body*uToonShadowScale, uShadow, .25);
      high=mix(body, uHigh, uToonHighMix);
    }
    c = uBands>2.5
      ? (ndl<uBandA ? shadow : (ndl<uBandB ? body : high))
      : (ndl<uBandA ? shadow : high);
    c+=uRimCol*pow(max(1.-clamp(dot(N,avfxF_safeDirLocal(avfx.vV, avfx)),0.,1.),1e-4),uRimPow)*uRimAmt;
    c*=mix(1.,fall,step(.5,uLightOn));
  } else {
    
    c=avfxF_rampColor(avfxF_lobeRampKeyBlended(avfx), avfx);
  }
  c*=avfx.vLobe.y;
  if(uBlendMode==1) avfx.gl_FragColor=vec4(c,avfx.vLobe.z);
  else avfx.gl_FragColor=vec4(c*avfx.vLobe.z,avfx.vLobe.z);
}
void vertex() {
  avfxVContext avfx;
  avfx.position=VERTEX; avfx.normal=NORMAL; avfx.uv=UV;
  avfx.modelMatrix=MODEL_MATRIX; avfx.modelViewMatrix=MODELVIEW_MATRIX;
  avfx.viewMatrix=VIEW_MATRIX; avfx.projectionMatrix=PROJECTION_MATRIX;
  avfx.normalMatrix=MODELVIEW_NORMAL_MATRIX; avfx.cameraPosition=CAMERA_POSITION_WORLD;
  avfx.aLobeA=texelFetch(avfxAttributes,ivec2((int(UV2.x)*4+0)%avfxAttributeWidth,(int(UV2.x)*4+0)/avfxAttributeWidth),0);
avfx.aLobeB=texelFetch(avfxAttributes,ivec2((int(UV2.x)*4+1)%avfxAttributeWidth,(int(UV2.x)*4+1)/avfxAttributeWidth),0);
avfx.aLobeC=texelFetch(avfxAttributes,ivec2((int(UV2.x)*4+2)%avfxAttributeWidth,(int(UV2.x)*4+2)/avfxAttributeWidth),0);
avfx.aLobeP=texelFetch(avfxAttributes,ivec2((int(UV2.x)*4+3)%avfxAttributeWidth,(int(UV2.x)*4+3)/avfxAttributeWidth),0);
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vN=avfx.vN;
vV=avfx.vV;
vWp=avfx.vWp;
vLobe=avfx.vLobe;
}
void fragment() {
  avfxFContext avfx;
  avfx.vN=vN;
avfx.vV=vV;
avfx.vWp=vWp;
avfx.vLobe=vLobe;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
