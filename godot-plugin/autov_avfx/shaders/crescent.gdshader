shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, blend_premul_alpha, depth_draw_never;
uniform vec3 uEx;
uniform vec3 uEy;
uniform vec3 uN;
uniform float uR;
uniform float uPh0;
uniform float uSweep;
uniform float uWmax;
uniform float uHead;
uniform float uTail;
uniform float uScale;
uniform float uRadOff;
uniform float uWiden;
uniform float uTime;
uniform float uSeed;
uniform float uPeakFrom;
uniform float uTipPower;
uniform float uRootFade;
uniform float uScreenSpace;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uStreakCol;
uniform vec4 uI;
uniform float uAlpha;
uniform float uTear;
uniform float uErode;
uniform float uTipHot;
uniform float uStreakOn;
uniform float uStreakFreq;
uniform float uStreakPan;
uniform float uStreakI;
uniform float uStreakSeg;
uniform float uVorScale;
uniform float uSeamWidth;
uniform float uFrontWidth;
uniform vec4 uBandT;
uniform int uBlendMode;
uniform int avfx_blend_kind=1;
uniform sampler2D avfxAttributes : filter_nearest, repeat_disable;
uniform int avfxAttributeWidth = 1024;
varying float vS;
varying float vQ;
varying float vWin;
varying float vTipD;
mat2 avfxMat2(float a,float b,float c,float d) { return mat2(vec2(a,b),vec2(c,d)); }
struct avfxVContext {
float aS;
float aQ;
float vS;
float vQ;
float vWin;
float vTipD;
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
float avfxV_vorHash11(float p, inout avfxVContext avfx) { p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float avfxV_vorHash21(vec2 p, inout avfxVContext avfx) { return avfxV_vorHash11(dot(p, vec2(127.1,311.7)), avfx); }
float avfxV_vorNoise(vec2 p, inout avfxVContext avfx) {
  vec2 i=floor(p), f=fract(p);
  float a=avfxV_vorHash21(i, avfx), b=avfxV_vorHash21(i+vec2(1.,0.), avfx);
  float c=avfxV_vorHash21(i+vec2(0.,1.), avfx), d=avfxV_vorHash21(i+vec2(1.,1.), avfx);
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float avfxV_vorFbm(vec2 p, inout avfxVContext avfx) { return .55*avfxV_vorNoise(p, avfx)+.28*avfxV_vorNoise(p*2.07+11.3, avfx)+.17*avfxV_vorNoise(p*4.11+5.7, avfx); }
vec2 avfxV_voronoi2(vec2 p, inout avfxVContext avfx) {
  vec2 ip=floor(p), fp=fract(p);
  float d1=8., d2=8., id=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 o=vec2(avfxV_vorHash21(ip+g, avfx), avfxV_vorHash21(ip+g+vec2(37.7,11.3), avfx));
    vec2 r=g+o-fp;
    float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=avfxV_vorHash21(ip+g+vec2(7.1,3.9), avfx); }
    else if(d<d2) d2=d;
  }
  return vec2(id, sqrt(d2)-sqrt(d1));
}
float avfxV_crescentWidth(float s, inout avfxVContext avfx) {
  float dt=uHead-s;                                    
  float rise=pow(max(smoothstep(0.,uPeakFrom*.9,dt),1e-4),uTipPower);
  float fall=1.-smoothstep(uPeakFrom,uPeakFrom*2.6,dt);
  float root=pow(max(smoothstep(0.,uRootFade,s-uTail),1e-4),.8);
  return uWmax*rise*(.14+.86*fall)*root;
}
void avfxV_main(inout avfxVContext avfx) {
  float ph=uPh0+avfx.aS*uSweep;
  vec3 rad=uEx*cos(ph)+uEy*sin(ph);
  float w=avfxV_crescentWidth(avfx.aS, avfx)*uScale;
  
  
  float flut=avfxV_vorFbm(vec2(avfx.aS*7.-uTime*1.1,uSeed), avfx)-.5;
  w*=1.+uWiden*(.55+1.5*flut)+.14*flut;
  vec3 ctr=(avfx.modelMatrix*vec4(rad*uR,1.)).xyz;
  vec3 tang=normalize(mat3(avfx.modelMatrix)*normalize(-uEx*sin(ph)+uEy*cos(ph)));
  vec3 nrm=normalize(mat3(avfx.modelMatrix)*uN);
  vec3 across;
  if(uScreenSpace>.5){
    
    
    vec3 view=normalize(avfx.cameraPosition-ctr);
    across=normalize(cross(tang,view));
    vec3 wr=normalize(mat3(avfx.modelMatrix)*rad);
    across*=sign(dot(across,wr));                      
  } else {
    across=normalize(mat3(avfx.modelMatrix)*rad);
  }
  float off=(.5-avfx.aQ)*w+uRadOff;
  vec3 p=ctr+across*off;
  
  avfx.vWin=smoothstep(uTail,uTail+.035,avfx.aS)*(1.-smoothstep(uHead-.012,uHead,avfx.aS));
  avfx.vS=avfx.aS; avfx.vQ=avfx.aQ; avfx.vTipD=clamp((uHead-avfx.aS)/max(uPeakFrom*.75,1e-3),0.,1.);
  avfx.gl_Position=avfx.projectionMatrix*avfx.viewMatrix*vec4(p,1.);
}
struct avfxFContext {
float vS;
float vQ;
float vWin;
float vTipD;
vec4 gl_FragColor;
vec4 gl_FragCoord;
bool gl_FrontFacing;
mat4 viewMatrix;
mat4 inverseProjection;
vec2 screenUv;
};
float avfxF_vorHash11(float p, inout avfxFContext avfx) { p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float avfxF_vorHash21(vec2 p, inout avfxFContext avfx) { return avfxF_vorHash11(dot(p, vec2(127.1,311.7)), avfx); }
float avfxF_vorNoise(vec2 p, inout avfxFContext avfx) {
  vec2 i=floor(p), f=fract(p);
  float a=avfxF_vorHash21(i, avfx), b=avfxF_vorHash21(i+vec2(1.,0.), avfx);
  float c=avfxF_vorHash21(i+vec2(0.,1.), avfx), d=avfxF_vorHash21(i+vec2(1.,1.), avfx);
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float avfxF_vorFbm(vec2 p, inout avfxFContext avfx) { return .55*avfxF_vorNoise(p, avfx)+.28*avfxF_vorNoise(p*2.07+11.3, avfx)+.17*avfxF_vorNoise(p*4.11+5.7, avfx); }
vec2 avfxF_voronoi2(vec2 p, inout avfxFContext avfx) {
  vec2 ip=floor(p), fp=fract(p);
  float d1=8., d2=8., id=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 o=vec2(avfxF_vorHash21(ip+g, avfx), avfxF_vorHash21(ip+g+vec2(37.7,11.3), avfx));
    vec2 r=g+o-fp;
    float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=avfxF_vorHash21(ip+g+vec2(7.1,3.9), avfx); }
    else if(d<d2) d2=d;
  }
  return vec2(id, sqrt(d2)-sqrt(d1));
}
vec3 avfxF_bandColor(float q, inout avfxFContext avfx) {
  vec3 c=uC0*uI.x;
  c=mix(c,uC1*uI.y,smoothstep(uBandT.x,uBandT.y,q));
  c=mix(c,uC2*uI.z,smoothstep(uBandT.y,uBandT.z,q));
  c=mix(c,uC3*uI.w,smoothstep(uBandT.z,uBandT.w,q));
  return c;
}
void avfxF_main(inout avfxFContext avfx) {
  if(avfx.vWin<=.001) discard;
  
  
  
  vec2 cell=avfxF_voronoi2(vec2(avfx.vS*uVorScale+uTime*uStreakPan, avfx.vQ*uVorScale*.6+uSeed*3.1), avfx);
  float streak=1.;
  if(uStreakOn>.5){
    float lines=mix(.60,1.45,avfxF_vorFbm(vec2(avfx.vS*uStreakFreq*3.3+uTime*uStreakPan*1.6, avfx.vQ*7.+uSeed), avfx));
    float seam=1.-smoothstep(0.,max(uSeamWidth,1e-3),cell.y);
    streak=lines*(.72+.60*cell.x)+.35*seam*uStreakSeg;
    streak=mix(1.,streak,clamp(uStreakI,0.,1.));
  }
  
  
  float front=clamp((avfx.vS-uTail)/max(.10,uFrontWidth),0.,1.);
  float th=uErode+uTear*(1.-front);
  float n=.42*cell.x+.58*avfxF_vorFbm(vec2(avfx.vS*uVorScale+uSeed*5., avfx.vQ*2.1-uTime*.6), avfx);
  float a=smoothstep(th,th+.16,n);
  float edge=smoothstep(th-.02,th+.09,n)*(1.-smoothstep(th+.09,th+.26,n));
  float tip=pow(max(1.-avfx.vTipD,1e-4),2.4);
  vec3 col=avfxF_bandColor(avfx.vQ, avfx)*streak;
  col+=uC0*tip*uTipHot;
  col+=uStreakCol*edge*uStreakI;
  float al=a*avfx.vWin*uAlpha*(.86+.14*(1.-avfx.vQ))*(.78+.35*streak);
  al=clamp(al,0.,1.);
  if(al<.003) discard;
  if(uBlendMode==1) avfx.gl_FragColor=vec4(col,al);
  else avfx.gl_FragColor=vec4(col*al,al);
}
void vertex() {
  avfxVContext avfx;
  avfx.position=VERTEX; avfx.normal=NORMAL; avfx.uv=UV;
  avfx.modelMatrix=MODEL_MATRIX; avfx.modelViewMatrix=MODELVIEW_MATRIX;
  avfx.viewMatrix=VIEW_MATRIX; avfx.projectionMatrix=PROJECTION_MATRIX;
  avfx.normalMatrix=MODELVIEW_NORMAL_MATRIX; avfx.cameraPosition=CAMERA_POSITION_WORLD;
  avfx.aS=texelFetch(avfxAttributes,ivec2((int(UV2.x)*2+0)%avfxAttributeWidth,(int(UV2.x)*2+0)/avfxAttributeWidth),0).x;
avfx.aQ=texelFetch(avfxAttributes,ivec2((int(UV2.x)*2+1)%avfxAttributeWidth,(int(UV2.x)*2+1)/avfxAttributeWidth),0).x;
  avfxV_main(avfx);
  POSITION=avfx.gl_Position;
  vS=avfx.vS;
vQ=avfx.vQ;
vWin=avfx.vWin;
vTipD=avfx.vTipD;
}
void fragment() {
  avfxFContext avfx;
  avfx.vS=vS;
avfx.vQ=vQ;
avfx.vWin=vWin;
avfx.vTipD=vTipD;
  avfx.gl_FragCoord=FRAGCOORD;
  avfx.gl_FrontFacing=FRONT_FACING;
  avfx.inverseProjection=INV_PROJECTION_MATRIX;
  avfx.screenUv=SCREEN_UV;
  avfx.viewMatrix=VIEW_MATRIX;
  avfxF_main(avfx);
  vec4 col=avfx.gl_FragColor;
  ALBEDO=col.rgb*(avfx_blend_kind<2 ? col.a : 1.0); ALPHA=avfx_blend_kind==0 ? 0.0 : col.a;
}
