shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform vec3 uAnchor;
uniform vec3 uTangent;
uniform vec3 uNormal;
uniform vec3 uDrift;
uniform vec2 uLength;
uniform vec2 uWidth;
uniform vec2 uStagger;
uniform vec2 uLife;
uniform float uTime;
uniform float uSpan;
uniform float uCurl;
uniform float uFlipHz;
uniform vec3 uHot;
uniform vec3 uBody;
uniform float uOpacity;
uniform int uBlendMode;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying float vS;
varying float vA;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
float aSeed;
float aSide;
float vS;
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
float avfxV_lickHash(float p, inout avfxVContext avfx) { p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
void avfxV_main(inout avfxVContext avfx) {
  float u=avfx.position.x, v=avfx.position.y;
  float h1=avfxV_lickHash(avfx.aSeed*2.3+.4, avfx), h2=avfxV_lickHash(avfx.aSeed*4.9+6.6, avfx);
  
  float k=floor(uTime*max(uFlipHz,1e-3))+avfx.aSeed;
  float L=mix(uLength.x,uLength.y,avfxV_lickHash(k*1.31, avfx));
  float W=mix(uWidth.x,uWidth.y,avfxV_lickHash(k*3.77+2.1, avfx));
  float birth=mix(uStagger.x,uStagger.y,h1)*uSpan;
  float life=mix(uLife.x,uLife.y,h2);
  float age=uTime-birth;
  float a01=clamp(age/max(life,1e-4),0.,1.);
  float alive=step(0.,age)*step(a01,.999);
  avfx.vA=alive*sin(3.14159265*pow(max(a01,1e-4),.7));
  avfx.vS=u;
  
  
  vec3 R=vec3(avfx.viewMatrix[0][0],avfx.viewMatrix[1][0],avfx.viewMatrix[2][0]);
  vec3 Up=vec3(avfx.viewMatrix[0][1],avfx.viewMatrix[1][1],avfx.viewMatrix[2][1]);
  vec3 base=uAnchor+uNormal*(h1-.5)*.10+uDrift*age;
  vec2 dir=normalize(vec2(dot(-uTangent,R),dot(-uTangent,Up))+vec2(0.,.55)+vec2(1e-4));
  vec2 pr=vec2(-dir.y,dir.x);
  float w=W*.5*pow(max(u+.06,1e-4),.30)*pow(max(1.-u,1e-4),.85);
  float curl=uCurl*sin(u*3.+h1*6.2831853)*u*avfx.aSide;
  vec2 q=dir*(u*L*(.45+.85*a01))+pr*(avfx.aSide*.045+curl+v*w);
  vec3 wp=base+(R*q.x+Up*q.y)*alive;
  avfx.gl_Position=avfx.projectionMatrix*avfx.viewMatrix*vec4(wp,1.);
}
struct avfxFContext {
float vS;
float vA;
vec4 gl_FragColor;
vec4 gl_FragCoord;
bool gl_FrontFacing;
mat4 viewMatrix;
mat4 inverseProjection;
vec2 screenUv;
};
void avfxF_main(inout avfxFContext avfx) {
  float a=avfx.vA*uOpacity;
  if(a<=.004) discard;
  
  vec3 col = avfx.vS<.42 ? uHot : uBody;
  if(uBlendMode==1) avfx.gl_FragColor=vec4(col,a);
  else avfx.gl_FragColor=vec4(col*a,a);
}
void vertex() {
  avfxVContext avfx;
  avfx.position=VERTEX; avfx.normal=NORMAL; avfx.uv=UV;
  avfx.modelMatrix=MODEL_MATRIX; avfx.modelViewMatrix=MODELVIEW_MATRIX;
  avfx.viewMatrix=VIEW_MATRIX; avfx.projectionMatrix=PROJECTION_MATRIX;
  avfx.normalMatrix=MODELVIEW_NORMAL_MATRIX; avfx.cameraPosition=CAMERA_POSITION_WORLD;
  avfx.aSeed=texelFetch(avfxAttributes,ivec2((int(UV2.x)*2+0)%avfxAttributeWidth,(int(UV2.x)*2+0)/avfxAttributeWidth),0).x;
avfx.aSide=texelFetch(avfxAttributes,ivec2((int(UV2.x)*2+1)%avfxAttributeWidth,(int(UV2.x)*2+1)/avfxAttributeWidth),0).x;
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vS=avfx.vS;
vA=avfx.vA;
}
void fragment() {
  avfxFContext avfx;
  avfx.vS=vS;
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
