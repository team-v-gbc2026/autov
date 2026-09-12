export const noise = `
float hash(vec3 p){ p=fract(p*.3183099+vec3(.1,.2,.3)); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ return .57*noise3(p)+.28*noise3(p*2.03)+.15*noise3(p*4.07); }
`;
export const starMask = `
float pointedShape(vec2 p,float arms,float outerRadius,float innerRadius){
  float angle=atan(p.y,p.x), halfAngle=3.14159265/arms;
  float q=abs(mod(angle-1.570796+halfAngle,halfAngle*2.)-halfAngle);
  vec2 outer=vec2(outerRadius,0.), inner=innerRadius*vec2(cos(halfAngle),sin(halfAngle));
  vec2 ray=vec2(cos(q),sin(q)), edge=inner-outer;
  float boundary=(outer.x*inner.y)/(ray.x*edge.y-ray.y*edge.x);
  return 1.-smoothstep(boundary-.008,boundary+.008,length(p));
}
float pointedStar(vec2 p){return pointedShape(p,5.,.78,.31);}
float pointedSparkle(vec2 p){return pointedShape(p,4.,.9,.09);}
`;
export const surfaceVertex = `
varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
uniform float uTime,uTurbulence,uWidth,uRadius; uniform int uStreamer,uCluster;
attribute vec3 aClusterAxis; attribute vec2 aClusterOffset;
void main(){
  vUv=uv; vec3 pos=position,nrm=normal;
  if(uCluster==1){pos=aClusterAxis;pos.xz+=aClusterOffset*(uWidth/max(.01,uRadius));}
  if(uStreamer==1){
    float t=clamp((position.y+1.)*.5,0.,1.);
    float envelope=t*t, derivative=t;
    float phase=position.y*4.-uTime*3.5;
    pos.x+=.65*uTurbulence*envelope*sin(phase);
    pos.z+=.20*uTurbulence*envelope*cos(phase*.8);
    float dx=.65*uTurbulence*(derivative*sin(phase)+envelope*4.*cos(phase));
    float dz=.20*uTurbulence*(derivative*cos(phase*.8)-envelope*3.2*sin(phase*.8));
    nrm.y-=dx*normal.x+dz*normal.z;
  }
  vec4 mv=modelViewMatrix*vec4(pos,1.); vNormal=normalize(normalMatrix*nrm); vView=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;
}
`;
export const surfaceFragment = `
uniform vec3 uColor,uSecondary; uniform float uTime,uOpacity,uIntensity,uWidth,uRadius,uLength,uTurbulence,uErosion,uArc,uSpin; uniform int uKind,uSurface,uMesh,uFlat,uHasTexture; uniform sampler2D uTexture;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
${noise}
${starMask}
void main(){
  vec2 p=vUv*2.-1.; float r=length(p),a=atan(p.y,p.x)+uTime*uSpin;
  float n=fbm(vec3(p*5.,uTime*.65)); float mask=0.; float detail=1.;
  if(uKind==0){
    float d=abs(r-.78+sin(a*17.+uTime*3.)*.006*uTurbulence+(n-.5)*.035*uTurbulence);
    float w=max(.002,uWidth/max(uRadius,.01)*.65);
    mask=(exp(-pow(d/w,2.))* .8+exp(-d/(w*4.))*.13)*(1.-smoothstep(.93,1.,r));
    detail=.65+.35*pow(sin(a*24.)*.5+.5,4.);
    // Erosion removes coherent angular segments instead of only fading an intact ring.
    float segmentField=.15+.7*noise3(vec3(cos(a)*4.,sin(a)*4.,0.));
    mask*=smoothstep(uErosion-.05,uErosion+.05,segmentField);
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
  // Flat carriers preserve their kind mask; explicit solid planes remain filled.
  if(uMesh==1 && (uFlat==0 || (uSurface==6 && uKind!=0))) mask=1.;
  if(uSurface==1){
    float flame=fbm(vec3(p.x*4.,p.y*3.-uTime*2.,uTime*.6));
    float taper=1.-smoothstep(-.9,1.,p.y);
    mask*=smoothstep(.25+uErosion*.5,.6,flame+taper*.28);
    detail=flame;
  } else if(uSurface==2 || uSurface==8){
    // Long smooth white bands over a continuous colored body, not a zigzag cutout.
    float bend=sin(p.y*2.8-uTime*2.2)*.12*uTurbulence;
    float waves=sin((p.x+bend)*9.5+p.y*.7);
    float streak=smoothstep(.72,.92,waves)*(.65+.35*sin(p.y*2.-uTime*2.));
    vec3 normalDirection=normalize(vNormal)*(gl_FrontFacing?1.:-1.);
    float broadHighlight=smoothstep(.25,.9,dot(normalDirection,normalize(vec3(-.35,.65,1.))));
    mask*=uSurface==8?streak:.88+.12*streak;
    mask*=1.-smoothstep(.02,.98,uErosion);
    detail=.12+.48*broadHighlight+.5*streak;
  } else if(uSurface==3){
    vec2 q=vUv*vec2(24.,12.); vec2 spacing=vec2(1.73205,3.);
    vec2 h1=mod(q,spacing)-spacing*.5, h2=mod(q-spacing*.5,spacing)-spacing*.5;
    vec2 h=dot(h1,h1)<dot(h2,h2)?h1:h2;
    float edge=abs(max(abs(h.x)*.866025+abs(h.y)*.5,abs(h.y))-.95);
    float grid=1.-smoothstep(.035,.10,edge);
    mask=max(mask*.35,grid*.65); detail=grid;
  } else if(uSurface==4){
    float cloud=fbm(vec3(p*4.,uTime*.5));
    float boundary=.73+(cloud-.4)*.25;
    float silhouette=1.-smoothstep(boundary-.06,boundary+.025,r);
    if(uKind==4)mask=silhouette*smoothstep(.12+uErosion*.65,.45+uErosion*.5,cloud)*.85;
    else mask*=smoothstep(uErosion*.8,uErosion*.8+.15,cloud+.25);
    detail=floor(clamp(cloud+.2-p.y*.12,0.,1.)*4.)/4.;
  } else if(uSurface==5 || uSurface==12){
    float spinAngle=uTime*uSpin;
    vec2 symbol=mat2(cos(spinAngle),-sin(spinAngle),sin(spinAngle),cos(spinAngle))*p;
    mask=uSurface==12?pointedSparkle(symbol):pointedStar(symbol);
  }
  if(uSurface==7){
    // Distance in world meters keeps top and side rim thickness equal.
    float edgeDistance=min((1.-abs(p.x))*uRadius,(1.-abs(p.y))*uLength*.5);
    float rimWidth=max(.001,uWidth);
    float border=1.-smoothstep(rimWidth*.65,rimWidth*1.15,edgeDistance);
    float mist=fbm(vec3(p*3.,uTime*.35));
    mask=border*.8+(.08+.22*mist)*(1.-border);
    detail=border;
  }
  if(uSurface==9){
    // Continuous core with a narrow moving edge; no longitudinal cloud holes.
    float edge=.48+.035*uTurbulence*sin(p.y*18.-uTime*10.);
    float side=1.-smoothstep(edge-.025,edge+.025,abs(p.x));
    float ends=1.-smoothstep(.94,1.,abs(p.y));
    mask=side*ends*(1.-uErosion);
    detail=1.-smoothstep(.17,.23,abs(p.x));
  }
  if(uSurface==10){
    // A compound symbol keeps its two eyes attached during rotation and motion.
    float rim=1.-smoothstep(.035,.055,abs(r-.7));
    float turn=uTime*uSpin;
    vec2 facePoint=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p;
    vec2 eyePoint=vec2(abs(facePoint.x)-.23,facePoint.y-.12);
    float eyes=1.-smoothstep(.9,1.,length(eyePoint/vec2(.13,.18)));
    float pupils=1.-smoothstep(.85,1.,length(eyePoint/vec2(.05,.085)));
    float fill=(1.-smoothstep(.67,.7,r))*.12;
    mask=max(rim,max(eyes,fill))*(1.-pupils)*(1.-uErosion);
    detail=1.-eyes;
  }
  if(uSurface==11){
    float face=abs(dot(normalize(vNormal),normalize(vView)));
    float field=noise3(vec3(vUv*vec2(12.,6.),1.));
    float veins=1.-smoothstep(.012,.03,abs(field-.5));
    detail=clamp(.08+.4*pow(1.-face,2.)+.78*veins,0.,1.);
    mask=1.-smoothstep(.02,.98,uErosion);
  }
  if(uHasTexture==1){
    vec2 uv=vUv;
    if(uSurface==1)uv.y+=sin(uv.x*14.-uTime*7.)*.035*(.5+uTurbulence)*smoothstep(.25,.8,uv.x);
    if(uMesh==0 && uKind!=1){ float c=cos(uTime*uSpin), s=sin(uTime*uSpin); uv=mat2(c,-s,s,c)*(uv-.5)+.5; }
    vec4 texel=texture2D(uTexture,uv);
    float luminance=dot(texel.rgb,vec3(.2126,.7152,.0722));
    float edge=step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.);
    float texMask=texel.a*luminance*edge;
    // Decals use the generated pattern itself; other surfaces modulate their silhouette.
    if(uSurface==4){
      // The authored smoke texture already supplies its silhouette and broad shading.
      // Multiplying it by procedural cloud holes destroys that form.
      mask=(uKind==2?mask:1.)*texel.a*edge*smoothstep(uErosion,uErosion+.08,luminance);detail=luminance;
    }else {mask=(uKind==5||uSurface==1 ? texMask : mask*texMask)*smoothstep(uErosion,uErosion+.08,texMask);if(uSurface==1)detail=luminance;}
  }
  mask*=uOpacity; if(mask<.003)discard;
  float colorMix=clamp(mask*.8+detail*.3,0.,1.);
  if(uSurface==4) colorMix=.25+detail*.7;
  if(uSurface==2) colorMix=clamp(detail,0.,1.);
  if(uSurface==8) colorMix=1.;
  if(uSurface==7 || uSurface==9 || uSurface==10 || uSurface==11) colorMix=detail;
  if(uMesh==1 && uSurface==6) colorMix=.15+.85*pow(abs(dot(normalize(vNormal),normalize(vView))),4.);
  vec3 c=mix(uSecondary,uColor,colorMix)*uIntensity;
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
uniform vec3 uColor,uSecondary; uniform float uIntensity; uniform int uSurface; varying vec2 vUv; varying float vAlpha; varying float vHeat;
${starMask}
void main(){ vec2 p=vUv*2.-1.; float silhouette=uSurface==12?pointedSparkle(p):uSurface==5?pointedStar(p):exp(-dot(p,p)*3.)*(1.-smoothstep(.7,1.,length(p))); float a=silhouette*vAlpha; if(a<.004)discard; gl_FragColor=vec4(mix(uSecondary,uColor,vHeat)*uIntensity,a); }
`;
