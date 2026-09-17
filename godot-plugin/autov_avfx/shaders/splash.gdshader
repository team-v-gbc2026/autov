shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform vec2 uSliverScale;
uniform vec3 uSliverOffset;
uniform float uSliverRoll;
uniform vec3 uCol;
uniform vec3 uDark;
uniform float uOpacity;
uniform int uBlendMode;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying vec2 vUv;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
vec2 vUv;
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
  avfx.vUv=avfx.uv;
  vec3 centre=(avfx.modelMatrix*vec4(0.,0.,0.,1.)).xyz;
  vec3 right=vec3(avfx.viewMatrix[0][0],avfx.viewMatrix[1][0],avfx.viewMatrix[2][0]);
  vec3 up=vec3(avfx.viewMatrix[0][1],avfx.viewMatrix[1][1],avfx.viewMatrix[2][1]);
  vec3 fwd=cross(right,up);
  vec2 q=vec2(avfx.position.x*uSliverScale.x, avfx.position.y*uSliverScale.y);
  float c=cos(uSliverRoll), s=sin(uSliverRoll);
  q=vec2(q.x*c-q.y*s, q.x*s+q.y*c);
  vec2 o=vec2(uSliverOffset.x, uSliverOffset.y);
  vec3 world=centre+right*(q.x+o.x)+up*(q.y+o.y)+fwd*uSliverOffset.z;
  avfx.gl_Position=avfx.projectionMatrix*avfx.viewMatrix*vec4(world,1.);
}
struct avfxFContext {
vec2 vUv;
vec4 gl_FragColor;
vec4 gl_FragCoord;
bool gl_FrontFacing;
mat4 viewMatrix;
mat4 inverseProjection;
vec2 screenUv;
};
void avfxF_main(inout avfxFContext avfx) {
  
  
  
  
  
  vec3 c=mix(uDark,uCol,smoothstep(.0,.55,avfx.vUv.y));
  if(uBlendMode==1) avfx.gl_FragColor=vec4(c,uOpacity);
  else avfx.gl_FragColor=vec4(c*uOpacity,uOpacity);
}
void vertex() {
  avfxVContext avfx;
  avfx.position=VERTEX; avfx.normal=NORMAL; avfx.uv=UV;
  avfx.modelMatrix=MODEL_MATRIX; avfx.modelViewMatrix=MODELVIEW_MATRIX;
  avfx.viewMatrix=VIEW_MATRIX; avfx.projectionMatrix=PROJECTION_MATRIX;
  avfx.normalMatrix=MODELVIEW_NORMAL_MATRIX; avfx.cameraPosition=CAMERA_POSITION_WORLD;
  
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vUv=avfx.vUv;
}
void fragment() {
  avfxFContext avfx;
  avfx.vUv=vUv;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
