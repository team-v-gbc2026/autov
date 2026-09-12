export const noise = `
float hash(vec3 p){ p=fract(p*.3183099+vec3(.1,.2,.3)); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ return .57*noise3(p)+.28*noise3(p*2.03)+.15*noise3(p*4.07); }
`;
export const surfaceVertex = `
varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vNormal=normalize(normalMatrix*normal); vView=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }
`;
export const surfaceFragment = `
uniform vec3 uColor,uSecondary; uniform float uTime,uOpacity,uIntensity,uWidth,uRadius,uTurbulence,uErosion,uArc,uSpin; uniform int uKind;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
${noise}
void main(){
  vec2 p=vUv*2.-1.; float r=length(p),a=atan(p.y,p.x)+uTime*uSpin;
  float n=fbm(vec3(p*5.,uTime*.65)); float mask=0.; float detail=1.;
  if(uKind==0){
    float d=abs(r-.78+sin(a*17.+uTime*3.)*.006*uTurbulence+(n-.5)*.035*uTurbulence);
    float w=max(.002,uWidth/max(uRadius,.01)*.65);
    mask=exp(-pow(d/w,2.))* .8+exp(-d/(w*4.))*.13;
    detail=.65+.35*pow(sin(a*24.)*.5+.5,4.);
  } else if(uKind==1){
    float fresnel=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),2.4);
    float cloud=fbm(vec3(vUv*vec2(20.,10.),uTime*.8));
    mask=fresnel*(.3+cloud*.7)*smoothstep(uErosion,uErosion+.17,cloud);
    detail=.5+.5*noise3(vec3(vUv*40.,uTime));
  } else if(uKind==2){
    float angle=mod(a+6.283185,6.283185); float sweep=smoothstep(0.,.035,angle)*(1.-smoothstep(uArc-.12,uArc,angle));
    float taper=pow(max(0.,sin(angle/uArc*3.14159)),.55);
    float center=.69+.055*sin(angle*1.6);
    float w=max(.002,uWidth/max(uRadius,.01)*.8*taper);
    mask=(exp(-pow((r-center)/w,2.))+.22*exp(-abs(r-center)/(w*2.5)))*sweep;
    mask*=smoothstep(uErosion,uErosion+.18,n*.6+taper*.4);
    detail=.65+.35*noise3(vec3(angle*18.,r*55.,uTime*2.));
  } else if(uKind==3){
    float core=exp(-abs(p.x)*8.)+.25*exp(-abs(p.x)*2.);
    mask=core*pow(max(0.,1.-abs(p.y)),.6)*(.5+.5*fbm(vec3(p*vec2(3.,12.),uTime*3.)));
  } else if(uKind==4){
    float cloud=fbm(vec3(p*3.5,uTime*.4));
    float soft=exp(-r*r*5.5)*(1.-smoothstep(.7,1.,r));
    float star=pow(max(0.,1.-abs(p.x)),35.)+pow(max(0.,1.-abs(p.y)),35.);
    mask=soft*(.7+cloud*uTurbulence)+(star*.16*(1.-r))*step(uTurbulence,.6);
    mask*=smoothstep(uErosion,uErosion+.15,cloud+.25);
  } else {
    float ring1=exp(-abs(r-.88)*220.); float ring2=exp(-abs(r-.77)*180.); float ring3=exp(-abs(r-.43)*150.);
    float marks=pow(max(0.,cos(a*24.)),28.)*smoothstep(.51,.54,r)*(1.-smoothstep(.68,.7,r));
    float spokes=pow(max(0.,cos(a*6.)),150.)*smoothstep(.43,.45,r)*(1.-smoothstep(.76,.78,r));
    float ornament=exp(-abs(r-(.29+.06*cos(a*6.)))*190.);
    mask=ring1+ring2*.55+ring3*.65+marks*.8+spokes*.6+ornament;
  }
  mask*=uOpacity; if(mask<.003)discard;
  vec3 c=mix(uSecondary,uColor,clamp(mask*.8+detail*.3,0.,1.))*uIntensity;
  gl_FragColor=vec4(c,clamp(mask,0.,1.));
}
`;
export const particleVertex = `
attribute vec4 aSeed; attribute vec4 aExtra;
uniform float uTime,uLife,uEmission,uSpeed,uRadius,uSpread,uGravity,uDrag,uWidth,uLength,uOpacity;
varying vec2 vUv; varying float vAlpha; varying float vHeat;
void main(){
  vUv=uv; float age=uTime-aSeed.x*uEmission; float life=uLife*(.65+aSeed.y*.35);
  float t=clamp(age,0.,life),u=t/life;
  float a=aSeed.z*6.283185, y=(aSeed.w*2.-1.)*uSpread, r=sqrt(1.-y*y);
  float v=uSpeed*(.4+aExtra.x*.6);
  float d=uDrag<.001?t:(1.-exp(-uDrag*t))/uDrag;
  vec3 dir=vec3(cos(a)*r,y,sin(a)*r);
  vec3 pos=vec3(dir.x*(uRadius*aExtra.y+v*d),y*v*d+.5*uGravity*t*t,dir.z*(uRadius*aExtra.y+v*d));
  vec3 vel=dir*v*exp(-uDrag*t)+vec3(0.,uGravity*t,0.);
  vec4 mv=modelViewMatrix*vec4(pos,1.);
  vec2 screenVel=(modelViewMatrix*vec4(vel,0.)).xy;
  vec2 along=normalize(screenVel+vec2(.00001,0.)); vec2 across=vec2(-along.y,along.x);
  float size=uWidth*(.6+aExtra.z*.8)*(1.-u*.55);
  mv.xy+=across*position.x*size+along*position.y*(size+uLength*(1.-u));
  gl_Position=projectionMatrix*mv;
  vAlpha=step(0.,age)*(1.-step(life,age))*pow(1.-u,1.4)*min(age/.025,1.)*uOpacity;
  vHeat=1.-u;
}
`;
export const particleFragment = `
uniform vec3 uColor,uSecondary; uniform float uIntensity; varying vec2 vUv; varying float vAlpha; varying float vHeat;
void main(){ vec2 p=vUv*2.-1.; float a=exp(-dot(p,p)*3.)*(1.-smoothstep(.7,1.,length(p)))*vAlpha; if(a<.004)discard; gl_FragColor=vec4(mix(uSecondary,uColor,vHeat)*uIntensity,a); }
`;
