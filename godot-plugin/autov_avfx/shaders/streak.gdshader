shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform float uGrow;
uniform float uCurvature;
uniform float uUpBias;
uniform float uBundles;
uniform float uBundleSpread;
uniform float uStagger;
uniform vec2 uLength;
uniform vec2 uWidth;
uniform vec3 uHueA;
uniform vec3 uHueB;
uniform vec3 uHueC;
uniform float uOpacity;
uniform float uFlicker;
uniform int uBlendMode;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying vec2 vUv;
varying float vK;
varying vec3 vC;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
float aSeed;
vec2 vUv;
float vK;
vec3 vC;
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
float avfxV_stHash(float p, inout avfxVContext avfx) { p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
void avfxV_main(inout avfxVContext avfx) {
  float s=avfx.aSeed;
  avfx.vUv=vec2(avfx.position.x,avfx.position.y*.5+.5);
  float n=max(uBundles,1.);
  float bi=floor(avfxV_stHash(s*.771, avfx)*n);
  float bth=(bi+.65*avfxV_stHash(bi*4.73+.9, avfx))/n*6.2831853;
  float bsp=uBundleSpread*(.30+.70*avfxV_stHash(bi*9.11+2.3, avfx));
  float th=bth+(avfxV_stHash(s*1.13, avfx)-.5)*bsp;
  vec2 d=vec2(cos(th),sin(th));
  d.y=d.y*(1.-abs(uUpBias)*.22)+uUpBias;   
  d=normalize(d+vec2(1e-5,0.));
  vec2 pp=vec2(-d.y,d.x);
  float hue=avfxV_stHash(s*17.1, avfx);
  float L=mix(uLength.x,uLength.y,pow(max(avfxV_stHash(s*3.31, avfx),1e-5),1.5));
  float W=mix(uWidth.x,uWidth.y,avfxV_stHash(s*5.17, avfx));
  float cv=sign(avfxV_stHash(s*7.91, avfx)-.5)*uCurvature*(.3+.7*avfxV_stHash(s*37.3, avfx));
  
  float stag=avfxV_stHash(s*11.3, avfx)*uStagger;
  float g=clamp((uGrow-stag)/max(1.-stag,1e-3),0.,1.);
  g=1.-pow(max(1.-g,1e-5),3.);
  float x=avfx.position.x*L*g;
  vec2 root=vec2((avfxV_stHash(s*23.1, avfx)-.5)*L*.05,(avfxV_stHash(s*29.7, avfx)-.5)*L*.16);
  vec2 off=root+d*x+pp*(cv*x*x*.42/max(L,1e-3))+pp*avfx.position.y*W;
  vec4 mv=avfx.modelViewMatrix*vec4(0.,0.,0.,1.);
  mv.xy+=off;
  avfx.vK=.55+.45*avfxV_stHash(s*13.7, avfx);
  avfx.vC=hue>.84 ? uHueB : (hue>.58 ? uHueC : uHueA);
  avfx.gl_Position=avfx.projectionMatrix*mv;
}
struct avfxFContext {
vec2 vUv;
float vK;
vec3 vC;
vec4 gl_FragColor;
vec4 gl_FragCoord;
bool gl_FrontFacing;
mat4 viewMatrix;
mat4 inverseProjection;
vec2 screenUv;
};
void avfxF_main(inout avfxFContext avfx) {
  float x=avfx.vUv.x;
  
  float wid=(1.-smoothstep(.10,1.,x))+.12;
  float y=abs(avfx.vUv.y-.5)*2./max(wid,1e-3);
  float a=exp(-y*y*3.2);
  a*=smoothstep(0.,.012,x)*(1.-smoothstep(.22,1.,x));
  
  
  
  a*=avfx.vK*uOpacity*uFlicker*2.;
  if(a<.002) discard;
  if(uBlendMode==1) avfx.gl_FragColor=vec4(avfx.vC,a);
  else avfx.gl_FragColor=vec4(avfx.vC*a,a);
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
vK=avfx.vK;
vC=avfx.vC;
}
void fragment() {
  avfxFContext avfx;
  avfx.vUv=vUv;
avfx.vK=vK;
avfx.vC=vC;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
