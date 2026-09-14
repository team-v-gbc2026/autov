// Migration reference used only by scripts/webgpu/port-shaders.mts.
// The production renderer imports static TSL from shaders-v2-nodes.js.
import { RADIAL_CUTOFF } from "./uniforms-v2";
import { glslPath } from "./paths-v2";
import { SPOKE_REACH } from "./wire-burst-v2";
import { LATTICE_SCAN, LATTICE_TEXTURE_WIDTH } from "./lattice-v2";

// ---------------------------------------------------------------------------
// GLSL for the autov.lab/2 renderer.
//
// Everything here is a pure function of (uniforms, attributes, time): no
// feedback buffers, no per-frame accumulation. A particle that is not alive at
// the sampled time is pushed to clip space (2,2,2,1) so it never rasterizes,
// and every pow()/normalize() guards its input so a degenerate document can
// not produce NaN (which would show up as a black or white frame).
// ---------------------------------------------------------------------------

/**
 * Where the two radial billboard patterns ("lensFlare", "radialRays") cut
 * themselves off, as a fraction of the card's half-size. The gate is what keeps
 * the card's own rectangle from ever showing, and the framing pass reads the
 * same constant so it claims the LIT extent rather than the whole card.
 */

/** Curves carry at most 8 keys, ramps at most 6 stops (schema-v2 bounds). */
export const CURVE_KEYS = 8;
export const RAMP_STOPS = 6;

export const glslNoise = /* glsl */ `
vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute289(vec4 x){return mod289v4(((x*34.)+1.)*x);}
vec4 taylorInvSqrtV(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289v3(i);
  vec4 p=permute289(permute289(permute289(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrtV(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm3(vec3 p){ return .5*snoise(p)+.25*snoise(p*2.02+7.)+.125*snoise(p*4.05+3.)+.0625*snoise(p*8.1+1.); }
vec3 curl3(vec3 p){
  float e=.1;
  vec3 dx=vec3(e,0.,0.), dy=vec3(0.,e,0.), dz=vec3(0.,0.,e);
  float dady=snoise(p+dy)-snoise(p-dy), dadz=snoise(p+dz)-snoise(p-dz);
  float dbdx=snoise(p+dx+31.4)-snoise(p-dx+31.4), dbdz=snoise(p+dz+31.4)-snoise(p-dz+31.4);
  float dcdx=snoise(p+dx-17.2)-snoise(p-dx-17.2), dcdy=snoise(p+dy-17.2)-snoise(p-dy-17.2);
  return vec3(dcdy-dbdz, dadz-dcdx, dbdx-dady)/(2.*e);
}
/** normalize() with a defined result for the zero vector. */
vec3 safeDir(vec3 v, vec3 fallback){ float l=length(v); return l>1e-5 ? v/l : fallback; }
/** pow() that can never see a negative base. */
float safePow(float base, float e){ return pow(max(base,1e-5), e); }
`;

export const glslRamp = /* glsl */ `
uniform vec4 uRamp[${RAMP_STOPS}]; uniform float uRampT[${RAMP_STOPS}]; uniform int uRampN;
vec3 rampColor(float u){
  u=clamp(u,0.,1.);
  vec3 c=uRamp[0].rgb*uRamp[0].a; float prev=uRampT[0];
  for(int i=1;i<${RAMP_STOPS};i++){
    if(i>=uRampN) break;
    float t=uRampT[i]; vec3 ci=uRamp[i].rgb*uRamp[i].a;
    c=mix(c,ci,smoothstep(prev,max(t,prev+1e-4),u)); prev=t;
  }
  return c;
}
`;

/** One uniform array + lookup per curve slot, mirroring the spike's layout. */
export function glslCurve(name: string) {
  return /* glsl */ `
uniform vec2 uCurve${name}[${CURVE_KEYS}]; uniform int uCurve${name}N; uniform float uCurve${name}Ease;
float curve${name}(float u){
  u=clamp(u,0.,1.); float v=uCurve${name}[0].y;
  for(int i=1;i<${CURVE_KEYS};i++){
    if(i>=uCurve${name}N) break;
    float a=uCurve${name}[i-1].x, b=uCurve${name}[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    f=mix(f, f*f*(3.-2.*f), uCurve${name}Ease);
    v=mix(v,uCurve${name}[i].y,step(a,u)*f);
  }
  return v;
}`;
}

export const glslSoft = /* glsl */ `
uniform sampler2D tDepth; uniform vec2 uResolution; uniform float uNear,uFar,uSoft;
float linDepth(float z){ float zn=z*2.-1.; return (2.*uNear*uFar)/max(uFar+uNear-zn*(uFar-uNear),1e-5); }
float softDepth(){
  if(uSoft<=0.) return 1.;
  vec2 sc=gl_FragCoord.xy/max(uResolution,vec2(1.));
  float sd=linDepth(texture2D(tDepth,sc).x); float fd=linDepth(gl_FragCoord.z);
  return clamp((sd-fd)/uSoft,0.,1.);
}
`;

/**
 * Procedural patterns used when a layer references no mask texture. Ported from
 * the v1 surface shader so every name in PROCEDURALS_V2 draws something; `none`
 * keeps the plain soft disc the v2 renderer has always used.
 *
 * `p` is the centred quad coordinate (-.5 .. .5), `uv` the raw 0..1 surface
 * coordinate, `n` a noise sample, `t` layer time, `fres` the fresnel term,
 * `cell` material.mask.uvScale (pattern density) and `dims` the live
 * (radius, length, thickness) of the geometry.
 */
export const glslProcedural = /* glsl */ `
uniform vec4 uProcParams;
/** Value noise on a hashed integer lattice; the swirl/fill patterns' grain. */
float procHash21(vec2 p){ vec3 q=fract(vec3(p.xyx)*0.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float procNoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=procHash21(i), b=procHash21(i+vec2(1.,0.));
  float c=procHash21(i+vec2(0.,1.)), d=procHash21(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float pointedShape(vec2 p,float arms,float outerRadius,float innerRadius){
  float angle=atan(p.y,p.x), halfAngle=3.14159265/arms;
  float q=abs(mod(angle-1.570796+halfAngle,halfAngle*2.)-halfAngle);
  vec2 outer=vec2(outerRadius,0.), inner=innerRadius*vec2(cos(halfAngle),sin(halfAngle));
  vec2 ray=vec2(cos(q),sin(q)), edge=inner-outer;
  float boundary=(outer.x*inner.y)/(ray.x*edge.y-ray.y*edge.x);
  return 1.-smoothstep(boundary-.008,boundary+.008,length(p));
}
/** Hex lattice with bright cell walls; density scales with material.mask.uvScale. */
float hexCells(vec2 uv, vec2 cell){
  vec2 q=uv*vec2(24.,12.)*max(cell,vec2(.02));
  vec2 spacing=vec2(1.73205,3.);
  vec2 h1=mod(q,spacing)-spacing*.5, h2=mod(q-spacing*.5,spacing)-spacing*.5;
  vec2 h=dot(h1,h1)<dot(h2,h2)?h1:h2;
  // Cell planes of the triangular lattice: neighbours at (sqrt(3),0) and (sqrt(3)/2,1.5).
  float edge=abs(max(abs(h.x),abs(h.x)*.5+abs(h.y)*.866025)-.866025);
  return 1.-smoothstep(.035,.10,edge);
}
// uProcedural: 0 none (soft disc), 1 flame, 2 smoke, 3 solid, 4 hexagon,
// 5 ice, 6 water, 7 water-streaks, 8 star, 9 sparkle, 10 portal, 11 energy-ribbon,
// 12 star4, 13 softRadial, 14 swirlRing, 15 ringFill, 16 sigil, 17 lensFlare,
// 18 radialRays, 19 swirlDisc (a SURFACE pattern with its own branch in
// surfaceFragmentV2, see glslSwirl), 20 teardropStreak.
// Modes 0-3, 12-18 and 20 are BILLBOARD SILHOUETTES: they describe a sprite's whole
// outline, so a closed body (the analytic shell) ignores them. 4-11 are surface
// patterns and apply everywhere; surfaceFragmentV2 gates on exactly that.
//
// 17 and 18 also supply their own RAMP KEY (proceduralKey below), radially, so
// the hot core and the outer halo are two stops of one ramp rather than two
// layers. Every other mode leaves the key alone.
float proceduralShape(vec2 p, vec2 uv, float n, float t, float fres, vec2 cell, vec3 dims, int mode){
  if(mode==3) return 1.;
  float disc=smoothstep(.5,.1,length(p));
  if(mode==1) return clamp(disc*(.45+n*1.1),0.,1.);
  if(mode==2) return clamp(disc*(.6+n*.8),0.,1.);
  vec2 q=p*2.;
  if(mode==4) return clamp(.10+.90*hexCells(uv,cell),0.,1.);
  if(mode==5){
    // Frozen body: a fresnel-lit interior crossed by thin veins.
    float field=.5+.5*snoise(vec3(uv*vec2(12.,6.)*max(cell,vec2(.02)),1.));
    float veins=1.-smoothstep(.012,.03,abs(field-.5));
    return clamp(.12+.55*fres*fres+.80*veins,0.,1.);
  }
  if(mode==6 || mode==7){
    float bend=sin(q.y*2.8-t*2.2)*.12;
    float waves=sin((q.x+bend)*9.5+q.y*.7);
    float streak=smoothstep(.72,.92,waves)*(.65+.35*sin(q.y*2.-t*2.));
    return clamp(mode==7?streak:.88+.12*streak,0.,1.);
  }
  if(mode==8) return pointedShape(q,5.,.78,.31);
  if(mode==9) return pointedShape(q,4.,.9,.09);
  if(mode==10){
    // A framed portal: a rim of geometry.thickness metres inside the card, misty fill.
    float edgeDistance=min((1.-abs(q.x))*max(dims.x,1e-3),(1.-abs(q.y))*max(dims.y,1e-3)*.5);
    float border=1.-smoothstep(max(dims.z,.001)*.65,max(dims.z,.001)*1.15,edgeDistance);
    return clamp(border*.8+(.08+.22*n)*(1.-border),0.,1.);
  }
  if(mode==12){
    // Four thin spikes plus a hot core and a halo, rolled slightly off-axis:
    // the anticipation glint. Same shape the spike drew by hand.
    float c=cos(.38), sn=sin(.38); vec2 g=vec2(q.x*c-q.y*sn, q.x*sn+q.y*c);
    float r=length(g);
    float core=safePow(max(0.,1.-r),6.);
    float ax=safePow(max(0.,1.-abs(g.x)),2.)*safePow(max(0.,1.-abs(g.y)*7.),2.5);
    float ay=safePow(max(0.,1.-abs(g.y)),2.)*safePow(max(0.,1.-abs(g.x)*7.),2.5);
    return clamp(core*1.2+ax+ay,0.,2.);
  }
  if(mode==13) return safePow(max(0.,1.-length(q)),2.6);
  if(mode==14){
    // swirlRing: three thin strands on the same rim, each at its own offset and
    // rotating at its own multiple of uProcParams.w, plus a few short arcs
    // detached just outside the rim. uProcParams = (rim radius 0..1 of the
    // card, strand half-width, wobble amplitude, rotation rate rad/s).
    float R=max(uProcParams.x,.02), hw=max(uProcParams.y,.002), amp=uProcParams.z;
    float d=length(q), ang=atan(q.y,q.x);
    float m=0.;
    for(int i=0;i<3;i++){
      float fi=float(i);
      float spin=uProcParams.w*t*(1.+fi*.35)+fi*2.09;
      float wob=amp*(sin(ang*(4.+fi)+spin)*.6+sin(ang*(7.+fi*2.)-spin*.7)*.4);
      float r=R*(1.+fi*.035-.035)+wob;
      // Squared, not safePow: safePow clamps its base to a positive epsilon,
      // which would make the whole disc inside the rim read as the rim.
      float g=(d-r)/hw;
      m+=exp(-g*g)*(1.-fi*.22);
    }
    // Detached arcs: a coarse angular comb just outside the rim, gated so only
    // a few sectors are lit at a time. They ride on the WOBBLE: a rim with no
    // wobble is a plain Gaussian ring (a shield's floor pool), and only a
    // living, breathing rim throws arcs off itself.
    float sector=floor((ang+3.14159265)/6.2831853*9.+uProcParams.w*t*.5);
    float ga=(d-R*1.16)/(hw*1.4);
    float arc=step(.62,procHash21(vec2(sector,3.7)))
            *exp(-ga*ga)
            *safePow(abs(sin(ang*9.+uProcParams.w*t*.5)),6.)
            *smoothstep(0.,.004,amp);
    return clamp(m+arc*.9,0.,2.);
  }
  if(mode==15){
    // ringFill: a soft radial fill with a slow pulse and a value-noise grain.
    // uProcParams = (fill radius 0..1, pulse rate rad/s, noise amount 0..1,
    // edge softness 0..1).
    float R=max(uProcParams.x,.02), soft=max(uProcParams.w,.02);
    float d=length(q), ang=atan(q.y,q.x);
    float pulse=.72+.28*sin(uProcParams.y*t);
    float fill=smoothstep(R+soft,R*(1.-soft),d)*pulse;
    fill*=mix(1.,.55+.45*procNoise(vec2(ang*2.4,d*5.-t*.7)),clamp(uProcParams.z,0.,1.));
    return clamp(fill,0.,1.);
  }
  if(mode==16){
    // sigil: a cast circle drawn entirely in polar coordinates.
    // uProcParams = (ring count 1-6, rune cells, radial spokes, gold rim 0..1).
    float r=length(q), ang=atan(q.y,q.x);
    float ta=ang/6.2831853+.5;
    float rings=0.;
    float nr=max(uProcParams.x,1.);
    for(int i=0;i<6;i++){
      if(float(i)>=nr) break;
      // Rings march inward in pairs: a bright one and a hairline beside it.
      float rr=.985-float(i)*.215;
      rings+=(1.-smoothstep(0.,.0075,abs(r-rr)))*1.15;
      rings+=(1.-smoothstep(0.,.0045,abs(r-rr+.03)))*.55;
    }
    // Rune band: each cell draws up to three ticks at hashed radii and lengths.
    float cells=max(uProcParams.y,1.);
    float ci=floor(ta*cells), cf=fract(ta*cells);
    float glyph=0.;
    for(int k=0;k<3;k++){
      float hk=procHash21(vec2(ci*3.7+float(k)*11.3,1.));
      float rr=.805+.135*procHash21(vec2(ci*5.1+float(k)*7.9,2.));
      float ln=.16+.28*procHash21(vec2(ci*2.3+float(k)*19.1,3.));
      float th=.0055+.0055*procHash21(vec2(ci*9.7+float(k)*3.1,4.));
      glyph+=step(.30,hk)*(1.-smoothstep(0.,th,abs(r-rr)))*smoothstep(ln,ln*.55,abs(cf-.5));
    }
    float spokes=max(uProcParams.z,1.);
    float spoke=step(.5,1.-abs(fract(ta*spokes)-.5)*9.)
              *smoothstep(0.,.02,r-.795)*smoothstep(.955,.94,r);
    glyph+=max(spoke,0.)*.7;
    // A second, finer tick row just inside the band keeps the middle busy.
    float ci2=floor(ta*cells*.62), cf2=fract(ta*cells*.62);
    float r2=.660+.070*procHash21(vec2(ci2*8.3,5.));
    glyph+=step(.42,procHash21(vec2(ci2*2.7+5.5,6.)))*(1.-smoothstep(0.,.006,abs(r-r2)))
          *smoothstep(.30,.16,abs(cf2-.5))*.8;
    // Two panning noise layers inside the circle: the mist the sigil sits in.
    float m1=procNoise(vec2(ta*7.+t*.11, r*3.2-t*.18));
    float m2=procNoise(vec2(ta*4.-t*.07, r*5.4+t*.09));
    float mist=safePow(clamp(m1*.72+m2*.60-.26,0.,1.),1.5)*smoothstep(.80,.10,r)
             +.34*smoothstep(.84,.10,r);
    float gold=(1.-smoothstep(0.,.016,abs(r-1.030)))*clamp(uProcParams.w,0.,1.);
    return clamp(rings*1.25+glyph*1.0+mist*.72+gold,0.,1.6);
  }
  if(mode==17){
    // lensFlare: a core, two ghosts, the horizontal and vertical lens streaks
    // and four soft spikes, all on one card. uProcParams = (core tightness,
    // anisotropy >1 narrows it horizontally into a blade, spike count, halo
    // falloff). The radial cutoff at the end is what keeps the card's own
    // rectangle from ever showing.
    float tight=max(uProcParams.x,1.);
    float aniso=max(uProcParams.y,.05);
    float spikes=max(uProcParams.z,1.);
    float fall=max(uProcParams.w,.05);
    vec2 qa=vec2(q.x*aniso,q.y);
    float r=length(qa), rr=length(q);
    float core=exp(-r*r*tight);
    float mid =exp(-r*r*tight*.17)*.44;
    float wide=exp(-r*r*tight*.06)*.12;
    float hstr=exp(-qa.y*qa.y*230.)*exp(-abs(qa.x)*2.4)*.44;
    float vstr=exp(-qa.x*qa.x*330.)*exp(-abs(qa.y)*1.7)*.38;
    float ang=atan(q.y,q.x);
    float spk=safePow(max(0.,cos(ang*spikes+.4)),16.)*exp(-rr*fall)*.16;
    float flick=.90+.14*procNoise(vec2(ang*2.3,t*3.1));
    float a=(core*1.35+mid+wide+hstr+vstr+spk)*flick;
    return clamp(a*(1.-smoothstep(${RADIAL_CUTOFF},1.,rr)),0.,4.);
  }
  if(mode==18){
    // radialRays: a fan of hashed rays turning at uProcParams.z rad/s.
    // uProcParams = (ray count, length jitter 0..1, rotation rate, sharpness).
    float n=max(uProcParams.x,1.);
    float jit=clamp(uProcParams.y,0.,1.);
    float sharp=clamp(uProcParams.w,0.,1.);
    float r=length(q), ang=atan(q.y,q.x)+uProcParams.z*t;
    float ta=(ang/6.2831853+.5)*n;
    float idx=floor(ta);
    float len=mix(1.-jit,1.,procHash21(vec2(idx,3.1)));
    float f=abs(fract(ta)-.5)*2.;
    float ray=safePow(max(0.,1.-f),mix(2.,24.,sharp));
    float fade=1.-smoothstep(0.,max(len,.02),r);
    return clamp(ray*fade*fade*(1.-smoothstep(${(RADIAL_CUTOFF * 1.45).toFixed(3)},1.,r)),0.,2.);
  }
  if(mode==20){
    // teardropStreak: the speed-line cap of a velocity-stretched sprite. The
    // quad's LONG axis is uv.y (that is the axis render.stretch elongates), so
    // u runs 0 at the tail to 1 at the leading point; with render.anchor "head"
    // the bright tip sits exactly on the instance and the streak trails behind.
    // uProcParams = (dash frequency, dash scroll, core tightness, halo reach).
    float u=uv.y, v=(uv.x-.5)*2.;
    float w=mix(.30,1.,smoothstep(0.,.62,u))*(1.-smoothstep(.86,1.,u));
    float dd=abs(v)/max(w,1e-3);
    float body=safePow(max(0.,1.-dd),2.2);
    float core=safePow(max(0.,1.-dd*max(uProcParams.z,1.)),5.)*smoothstep(.20,.80,u);
    float halo=safePow(max(0.,1.-length(vec2((u-.80)*2.1, v*1.05))),max(uProcParams.w,.5));
    float dash=step(.62,fract(u*max(uProcParams.x,0.)-t*uProcParams.y))
             *safePow(max(0.,1.-dd*1.4),3.)*smoothstep(0.,.35,u)*(1.-smoothstep(.55,.85,u));
    return clamp(body*.8+core+halo*1.1+dash*.7,0.,2.);
  }
  if(mode==11){
    // Continuous core with a narrow moving edge; no longitudinal holes.
    float edge=.48+.035*sin(q.y*18.-t*10.);
    float side=1.-smoothstep(edge-.025,edge+.025,abs(q.x));
    float ends=1.-smoothstep(.94,1.,abs(q.y));
    return clamp(side*ends,0.,1.);
  }
  return disc;
}
/**
 * The ramp key the two radial patterns supply for themselves: 0 at the hot
 * centre, 1 at the outer halo. Returns -1 for every other mode, which the
 * fragment reads as "leave the key alone".
 */
float proceduralKey(vec2 p, float t, int mode){
  vec2 q=p*2.;
  if(mode==17){
    float tight=max(uProcParams.x,1.), aniso=max(uProcParams.y,.05);
    vec2 qa=vec2(q.x*aniso,q.y);
    float r=length(qa);
    float core=exp(-r*r*tight);
    float hstr=exp(-qa.y*qa.y*230.)*exp(-abs(qa.x)*2.4)*.44;
    float vstr=exp(-qa.x*qa.x*330.)*exp(-abs(qa.y)*1.7)*.38;
    return clamp(1.-clamp(core*2.2+(hstr+vstr)*1.1,0.,1.),0.,1.);
  }
  if(mode==18) return clamp(length(q),0.,1.);
  return -1.;
}
/**
 * material.stripes: up to three sets of hard panning bands keyed on the ALONG
 * coordinate in world metres. The phase field is how far each circumferential RING is
 * offset from its neighbours: 0 runs the bands straight round the body (a
 * machine segment ladder) and 1 breaks them into independent filaments. The
 * largest contrast in the list is the mix weight, so a core at .2 keeps a solid
 * body and a sheath at 1 is nothing but bands.
 */
uniform vec4 uStripeA[3]; uniform vec4 uStripeB[3]; uniform int uStripeN;
float stripeHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float stripeTerm(float along, float ring, float t){
  if(uStripeN<1) return 1.;
  float acc=0., weight=0.;
  float band=floor(ring*15.);
  for(int i=0;i<3;i++){
    if(i>=uStripeN) break;
    vec4 s=uStripeA[i];
    float e=mix(.14,.008,clamp(s.w,0.,1.));
    // s.z is the RING PHASE: 0 runs the bands straight round the body (a
    // segment ladder), 1 gives every ring its own offset (filaments).
    float o=s.z*stripeHash(band*3.17+1.7+float(i)*7.3);
    float f=fract(along*s.x - t*s.y + o);
    acc+=smoothstep(.70-e,.70+e,f);
    weight=max(weight,uStripeB[i].x);
  }
  return mix(1., .08+acc*.9, clamp(weight,0.,1.));
}
`;

/**
 * Drawn symbols: the glyphs a cartoon impact is made of. Unlike every other
 * pattern these are not a single coverage number — a symbol is a FILL inside an
 * ink OUTLINE, with its own highlight and its own ink marks — so they return
 * four coverages and material.symbol supplies the colours. The ramp is not
 * consulted at all: a pink bear's head is two flat hexes and a line, and mixing
 * a gradient through it is exactly what stops it reading as drawn.
 *
 * Modes 21 starSolid, 22 face, 23 heart, 24 crescent, 25 cloudLobe, 26 bolt.
 * `p` is the centred quad coordinate scaled to -1..1, `sd` a per-instance hash
 * (the face's expression rides it) and the result is
 * (body, outline, ink, hot core).
 */
export const glslSymbol = /* glsl */ `
uniform vec3 uSymFill,uSymOutline,uSymHigh,uSymInk,uSymHot;
uniform float uSymHotI,uSymHotA,uScreenPitch,uScreenOn,uScreenWorld;
uniform vec3 uScreenCol;
float symC(vec2 p,float r){ return length(p)-r; }
float symE(vec2 p,vec2 r){ return (length(p/r)-1.)*min(r.x,r.y); }
float symSeg(vec2 p,vec2 a,vec2 b){ vec2 pa=p-a,ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
/* iq's star SDF: an n-pointed star whose inner radius is rf of the outer. */
float symStar(vec2 p, float r, float rf, float points){
  float m=max(points,3.);
  float an=3.141592653589793/m, en=3.141592653589793/mix(3.,m,clamp(rf,0.,1.));
  vec2 acs=vec2(cos(an),sin(an)), ecs=vec2(cos(en),sin(en));
  float bn=mod(atan(p.x,p.y),2.*an)-an;
  p=length(p)*vec2(cos(bn),abs(sin(bn)));
  p-=r*acs;
  p+=ecs*clamp(-dot(p,ecs),0.,r*acs.y/ecs.y);
  return length(p)*sign(p.x);
}
/* iq's heart SDF, cusp at the origin and lobes at y = 1. */
float symHeart(vec2 p){
  p.x=abs(p.x);
  if(p.y+p.x>1.) return sqrt(dot(p-vec2(.25,.75),p-vec2(.25,.75)))-sqrt(2.)/4.;
  vec2 a=p-vec2(0.,1.), b=p-.5*max(p.x+p.y,0.);
  return sqrt(min(dot(a,a),dot(b,b)))*sign(p.x-p.y);
}
/* Coverage of the four parts of a symbol: the fill, the ink outline around it,
   the ink marks inside it, the lighter accent and the hot inner copy. */
void symbolShape(vec2 p, float sd, int mode,
                 out float body, out float ring, out float ink,
                 out float high, out float hot){
  float aa=fwidth(p.x)*1.4+.004;
  float ow=max(uProcParams.x,.0);
  float d=1e3, dInk=1e3, dHot=1e3, dHigh=1e3;
  if(mode==21){
    d=symStar(p,.70,clamp(uProcParams.y,.1,.9),max(uProcParams.x,3.));
    // The hot inner copy is the SAME star at a fraction of the radius: one
    // shape, so the flash can cut without the outline moving.
    dHot=symStar(p,.70*clamp(uProcParams.w,.05,1.),clamp(uProcParams.y,.1,.9),max(uProcParams.x,3.));
    ow=max(uProcParams.z,.0);
  } else if(mode==22){
    // A head and two ears, an expression hashed out of the instance seed, and
    // a lighter muzzle and ear inners so the disc reads as a ball.
    float ear=clamp(uProcParams.z,.05,.6);
    d=symC(p,.58);
    d=min(d,symC(p-vec2(-.44,.46),ear));
    d=min(d,symC(p-vec2( .44,.46),ear));
    float expr=floor(fract(sd*7.31)*max(uProcParams.x,1.));
    vec2 el=p-vec2(-.235,.115), er=p-vec2(.235,.115);
    float eye;
    if(expr>.5 && expr<1.5){
      eye=min(abs(symC(el,.135))-.042, abs(symC(er,.135))-.042);
      eye=max(eye,-(p.y-.085));
    } else {
      eye=min(symE(el,vec2(.088,.115)), symE(er,vec2(.088,.115)));
    }
    float mouth = expr>1.5
      ? symE(p-vec2(0.,-.185),vec2(.115,.095))
      : max(abs(symC(p-vec2(0.,.12),.30))-.038, -(-p.y-.055));
    dInk=min(eye,mouth);
    float inner=min(symC(p-vec2(-.44,.47),ear*.49), symC(p-vec2(.44,.47),ear*.49));
    dHigh=min(inner, symE(p-vec2(0.,-.115),vec2(.235,.175)*clamp(uProcParams.w,.1,2.)));
    ow=max(uProcParams.y,.0);
  } else if(mode==23){
    d=symHeart((p+vec2(0.,.78))/1.55)*1.55;
  } else if(mode==24){
    // A comma crescent: a disc with an offset bite taken out of it.
    float bite=clamp(uProcParams.y,0.,1.);
    d=max(symC(p-vec2(-.06,.02),.56), -symC(p-vec2(.26+bite*.2,.24),.50));
  } else if(mode==25){
    // A union of hashed discs: a flat cel puff, one shape and no gradient.
    float lobes=max(uProcParams.x,1.);
    float rr=clamp(uProcParams.y,.05,.6);
    for(int i=0;i<4;i++){
      if(float(i)>=lobes) break;
      float f=float(i)+sd*13.;
      vec2 o=vec2(procHash21(vec2(f,1.))-.5, procHash21(vec2(f+3.1,2.))-.5)*.72;
      d=min(d, length(p-o)-(rr+.16*procHash21(vec2(f+7.3,3.))));
    }
    // A lighter cap on the upper edge, which is what makes a puff a billow.
    dHigh=d+.16-.30*(p.y*.5+.5);
    ow=.0;
  } else {
    // A three-segment polyline: the little Z bolt a comic flicks past the rim.
    float w=max(uProcParams.x,.02)*(1.-clamp(uProcParams.y,0.,.9)*abs(p.y));
    float seg=symSeg(p,vec2(-.30,.86),vec2(.16,.16));
    seg=min(seg,symSeg(p,vec2(.16,.16),vec2(-.16,-.02)));
    seg=min(seg,symSeg(p,vec2(-.16,-.02),vec2(.30,-.86)));
    d=seg-w;
    ow=.0;
  }
  body=smoothstep(aa,-aa,d);
  ring=ow>0. ? max(smoothstep(aa,-aa,d-ow)-body,0.) : 0.;
  ink=smoothstep(aa,-aa,dInk)*body;
  high=smoothstep(aa,-aa,dHigh)*body;
  hot=smoothstep(aa,-aa,dHot)*body;
}
/** The halftone lattice, in world metres or in the card's own UV. */
float screentoneAt(vec2 uvp, vec3 wp){
  if(uScreenOn<.5) return 0.;
  vec2 q = uScreenWorld>.5 ? wp.xy : uvp;
  vec2 g=fract(q/max(uScreenPitch,1e-3))-.5;
  return smoothstep(.36,.24,length(g));
}
`;

// ---------------------------------------------------------------------------
// Frame rims, flow surfaces and swirl discs
// ---------------------------------------------------------------------------

/**
 * The rounded-rectangle frame: a signed distance and a normalised PERIMETER
 * coordinate (0 at bottom-centre, 1 at top-centre, mirrored in x). Everything
 * a frame does — the reveal front, the travelling beads, the stripes — runs on
 * that one coordinate, which is why a doorway draws itself up both sides at
 * once from a single field.
 */
export const glslFrame = /* glsl */ `
uniform int uFrame,uSdfN,uBeadOn;
uniform float uCorner,uSdfCore,uSdfSpine,uSdfInnerOff,uSdfInnerW;
uniform vec2 uSdfHalo[3];
uniform vec3 uBeads;   // (count, speed, width)
float sdRoundRect(vec2 p, vec2 h, float r){
  vec2 d=abs(p)-h+r;
  return length(max(d,0.))+min(max(d.x,d.y),0.)-r;
}
/* Perimeter parameter: 0 at bottom-centre, 1 at top-centre, mirrored in x. */
float framePerimeter(vec2 p, vec2 h){
  vec2 a=vec2(abs(p.x),p.y);
  vec2 c=clamp(a, vec2(0.,-h.y), h);
  float db=c.y+h.y, dt=h.y-c.y, dr=h.x-c.x;
  float m=min(dr,min(db,dt));
  float sArc = (m==db) ? c.x : ((m==dr) ? (h.x+c.y+h.y) : (h.x+2.*h.y+h.x-c.x));
  return sArc/max(2.*h.x+2.*h.y,1e-4);
}
/* Travelling brightness beads along the perimeter, hash-stepped so they are
   never evenly spaced. Returns 0 when material.beads is null. */
float beadTerm(float u, float t){
  if(uBeadOn==0) return 0.;
  float acc=0.;
  for(int i=0;i<8;i++){
    if(float(i)>=uBeads.x) break;
    float k=float(i);
    float bp=fract(t*uBeads.y + k*0.37 + fract(sin(k*3.1)*43758.5453)*0.4);
    float g=(u-bp)/max(uBeads.z,1e-3);
    acc+=exp(-g*g);
  }
  return acc;
}
`;

/**
 * material.flow: up to four panning value-noise fields mixed into one mask.
 * The slowest layer takes a view-direction offset (`parallax`), which is the
 * whole reason a flat card reads as having an interior behind it.
 */
export const glslFlow = /* glsl */ `
uniform int uFlowOn,uFlowN;
// 0..3 are (scale, pan.x, pan.y, rotate); 4..7 carry the mix weight in .x.
// One array rather than two: WebGPU allows twelve uniform buffers per stage.
uniform vec4 uFlowLayer[8];
uniform vec3 uFlowCut;        // (threshold, softness, parallax)
float flowNoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float a=procHash21(i), b=procHash21(i+vec2(1.,0.));
  float c=procHash21(i+vec2(0.,1.)), d=procHash21(i+vec2(1.,1.));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
/* The mixed field in 0..1. q is the surface coordinate in METRES, so a card
   that is resized does not squash its own patches. */
float flowField(vec2 q, float t, vec2 parallax){
  float acc=0., weight=0.;
  for(int i=0;i<4;i++){
    if(i>=uFlowN) break;
    vec4 L=uFlowLayer[i];
    float c=cos(L.w), sn=sin(L.w);
    vec2 r=vec2(q.x*c-q.y*sn, q.x*sn+q.y*c);
    // Only the FIRST (slowest) layer takes the view offset: parallax on the
    // fine octaves reads as the whole card sliding, not as depth.
    vec2 off = i==0 ? parallax*uFlowCut.z : vec2(0.);
    acc+=flowNoise((r+off)*L.x + L.yz*t)*uFlowLayer[4+i].x;
    weight+=uFlowLayer[4+i].x;
  }
  return acc/max(weight,1e-4);
}
`;

/**
 * material.swirl: the polar swirl of a disc. The angle is sheared by
 * twist/(d + eps) so a noise field becomes spiral bands, an explicitly wound
 * log spiral makes the ARMS read, and a second, tighter, independently wound
 * spiral shades them from inside. `uSwirlS` is the swirl envelope, sampled from
 * material.swirl.strength on the CPU so every draw a layer owns agrees on it.
 */
export const glslSwirl = /* glsl */ `
uniform int uSwirlOn;
uniform vec4 uSwirlBands;    // (arms, wind, width, warp)
uniform vec4 uSwirlDetail;   // (arms, wind, warp, contrast)
uniform vec3 uSwirlLobe;     // (scale1, scale2, amount)
uniform float uSwirlS;
float swirlFbm2(vec2 p){ return (flowNoise(p)+.5*flowNoise(p*2.07+19.3))/1.5; }
float swirlFbm3(vec2 p){
  float acc=0., a=.5;
  for(int i=0;i<3;i++){ acc+=a*flowNoise(p); p=mat2(.8,.6,-.6,.8)*p*2.03+vec2(11.3,7.1); a*=.5; }
  return acc/.875;
}
/* (mask, shade) for the disc at centred coordinate q (|q| <= 1 is the card). */
vec2 swirlDisc(vec2 q, float t){
  float d=length(q);
  float twist=uProcParams.x, spin=uProcParams.y, inflow=uProcParams.z;
  float arms=uSwirlOn==1 && uSwirlBands.x>0. ? uSwirlBands.x : max(uProcParams.w,1.);
  float rot=uSwirlS*twist/(d+.08)+t*spin*6.28318530718;
  float c=cos(rot), sn=sin(rot);
  vec2 p=vec2(q.x*c-q.y*sn, q.x*sn+q.y*c)*(1.+t*inflow*uSwirlS)*3.;
  vec2 w=vec2(swirlFbm2(p*1.15), swirlFbm2(p*1.15+31.7))-.5;
  float n=swirlFbm2(p+w*1.15);
  float ang=atan(q.y,q.x);
  float wind=uSwirlOn==1?uSwirlBands.y:1.85;
  float warp=uSwirlOn==1?uSwirlBands.w:1.4;
  float band=.5+.5*sin(arms*(ang+uSwirlS*twist*wind*log(d+.09))+t*spin*6.28318530718*arms+(n-.5)*warp);
  float lobe=0.;
  if(uSwirlOn==1)
    lobe=((swirlFbm3(p*uSwirlLobe.x+57.)-.5)+.3*(swirlFbm2(p*uSwirlLobe.y+91.)-.5))*uSwirlLobe.z;
  float width=uSwirlOn==1?uSwirlBands.z:.5;
  float m=band*(.4+.76*width)+n*.46+lobe;
  // The independent detail spiral: tighter, its own winding, and it only ever
  // shades — a second mask here would read as a copy of the first.
  float dArms=uSwirlOn==1?uSwirlDetail.x:7.;
  float dWind=uSwirlOn==1?uSwirlDetail.y:2.75;
  float dWarp=uSwirlOn==1?uSwirlDetail.z:6.2;
  float dCon=uSwirlOn==1?uSwirlDetail.w:.62;
  float fine=swirlFbm3(p*2.35+113.);
  float det=.5+.5*sin(dArms*(ang+uSwirlS*twist*dWind*log(d+.09))+t*spin*6.28318530718*dArms+(fine-.5)*dWarp);
  float shade=smoothstep(.10,.92,det*dCon+fine*.54);
  return vec2(clamp(m,0.,2.), shade);
}
`;


// ---------------------------------------------------------------------------
// Particles
//
// The whole trajectory — spawn position, initial direction, speed curve,
// forces, vortex, curl, floor — lives in one GLSL chunk that is emitted twice
// when a layer has a sub-emitter: once under the layer's own uniforms (prefix
// "", functions `self*`) and once under the parent layer's uniforms (prefix
// "Parent", functions `parent*`). Both the billboard vertex shader and the
// trail ribbon vertex shader call the same functions, so a trail vertex at
// age - k*spacing is exactly the position the billboard had at that age.
// ---------------------------------------------------------------------------

/**
 * Trajectory chunk. `P` prefixes the uniform names, `p` the function names and
 * `curlEnv` is the curl envelope expression (the parent copy has none, so its
 * caller passes a constant).
 */
/**
 * Inverse of a monotone non-decreasing piecewise-linear curve: given a value
 * `y`, the 0..1 domain position that produces it. The smooth ease is inverted
 * analytically (f = .5 - sin(asin(1-2s)/3) undoes s = f*f*(3-2f)), so a
 * path-anchored instance's birth time is closed form instead of a stored table.
 */
export function glslCurveInverse(name: string) {
  return /* glsl */ `
float curve${name}Inverse(float y){
  float last=uCurve${name}[0].x;
  for(int i=1;i<${CURVE_KEYS};i++){
    if(i>=uCurve${name}N) break;
    vec2 a=uCurve${name}[i-1], b=uCurve${name}[i];
    last=b.x;
    if(y<=b.y || i==uCurve${name}N-1){
      float s=clamp((y-a.y)/max(b.y-a.y,1e-5),0.,1.);
      float f=mix(s, .5-sin(asin(clamp(1.-2.*s,-1.,1.))/3.), uCurve${name}Ease);
      return a.x+(b.x-a.x)*f;
    }
  }
  return last;
}`;
}

/**
 * `source` compiles the `layerInstances` branches, which read the aSrcPos /
 * aSrcDir attributes. They are emitted only when the layer actually borrows
 * another layer's sites, so an ordinary emitter never has to carry two extra
 * vec3 buffers per instance.
 */
export function glslParticleCore(
  P: string,
  p: string,
  curlEnv: string,
  source = false,
  events = false,
) {
  // Path sampling exists only in the layer's OWN copy: a sub-emitter is
  // launched from its parent's trajectory, never from a path of its own.
  const path = P === "";
  return /* glsl */ `
uniform float u${P}Period,u${P}SpawnWindow,u${P}SpawnDuration,u${P}ShapeLength,u${P}ShapeRadius,u${P}ShapeInner,u${P}ShapeAngle;
uniform float u${P}Drag,u${P}Curl,u${P}CurlFreq,u${P}CurlSpeed,u${P}FloorY,u${P}FloorSoft,u${P}Angle;
uniform float u${P}PlanarDrag;
uniform float u${P}VortexW,u${P}VortexFalloff;
uniform int u${P}SpawnMode,u${P}ShapeType,u${P}VelMode,u${P}HasFloor,u${P}SurfaceOnly,u${P}SpeedN,u${P}BurstN;
uniform vec3 u${P}Axis,u${P}Dir,u${P}Gravity,u${P}Wind,u${P}Bias,u${P}ShapeSize,u${P}VortexAxis;
uniform vec2 u${P}Life,u${P}Speed;
uniform vec2 u${P}SpeedKey[${CURVE_KEYS}];
uniform float u${P}BurstT[${CURVE_KEYS}]; uniform float u${P}BurstC[${CURVE_KEYS}];
uniform float u${P}Interior;
uniform float u${P}AngleJitter,u${P}AngleBias;
${path ? `uniform vec3 uFrontC,uFrontEx,uFrontEy,uFrontN;
uniform float uFrontR,uFrontPh0,uFrontSweep,uFrontSpan,uFrontStart;
/* The arc point of the source crescent at parameter s, in THIS layer's space. */
vec3 frontPoint(float sArc){
  float ph=uFrontPh0+sArc*uFrontSweep;
  return uFrontC+(uFrontEx*cos(ph)+uFrontEy*sin(ph))*uFrontR;
}
vec3 frontTangent(float sArc){
  float ph=uFrontPh0+sArc*uFrontSweep;
  return safeDir(-uFrontEx*sin(ph)+uFrontEy*cos(ph), vec3(1.,0.,0.));
}` : ""}

float ${p}Life(vec4 s){ return mix(u${P}Life.x,u${P}Life.y,s.y); }

/** Birth time in layer-local seconds, or 1e9 when the instance never spawns. */
float ${p}Birth(vec4 s, float t, vec4 ev, float idx){
  float instance=s.x;
  float birth=instance*u${P}SpawnWindow;
  if(u${P}SpawnMode==1){
    // continuous: the emitter loops with period = count / rate.
    float cycle=floor((t-birth)/max(u${P}Period,1e-4));
    float absBirth=birth+cycle*u${P}Period;
    if(absBirth<0. || absBirth>u${P}SpawnDuration) return 1e9;
    return absBirth;
  }
  if(u${P}SpawnMode==2){
    // bursts: pick the burst whose cumulative share covers this instance.
    float t0=u${P}BurstT[0];
    for(int i=0;i<${CURVE_KEYS};i++){ if(i>=u${P}BurstN) break; if(instance<=u${P}BurstC[i]){ t0=u${P}BurstT[i]; break; } }
    return t0+fract(instance*7.13+0.37)*u${P}SpawnWindow;
  }
${
  events
    ? /* glsl */ `  if(u${P}SpawnMode==4){
    // event: the instance is born when its own path's head reaches the END of
    // that path. The moment and the origin are one instance attribute, computed
    // on the CPU from whichever layer drives the path (see events-v2.ts), so a
    // single layer can carry the debris of every impact in the document.
    return ev.w+fract(instance*7.13+.37)*u${P}SpawnWindow;
  }
`
    : ""
}${
  path
    ? /* glsl */ `  if(u${P}SpawnMode==5){
    // frontAnchored: the instance owns a hashed parameter along the source
    // crescent's arc and is born the moment that crescent's TAIL curve reaches
    // it. The curve is inverted in closed form, so the embers appear in the
    // order the blade tears with no time table anywhere.
    return curveTInverse(instance)*uFrontSpan+uFrontStart;
  }
  if(u${P}SpawnMode==3){
    // pathAnchored: instance i owns u = i/(count-1) and is born the moment the
    // head curve passes it. The head curve's domain is the layer's own 0..1
    // progress, so the inverse is scaled back into layer seconds.
    return curveHInverse(idx)*uSpan;
  }
`
    : ""
}  return birth;
}

vec3 ${p}Origin(vec4 s, vec4 e, vec4 e2, vec3 srcPos, vec4 ev, float idx){
  float ca=e.x*6.2831853, cz=e.y*2.-1., cr=sqrt(max(0.,1.-cz*cz));
  vec3 unit=vec3(cr*cos(ca),cz,cr*sin(ca));
  float fill=u${P}SurfaceOnly==1?1.:safePow(e.z,.5);
  vec3 sph=unit*fill;
  // bias mirrors samples toward the positive axis (0 = symmetric, 1 = fully biased).
  sph=mix(sph,abs(sph),clamp(u${P}Bias,0.,1.));
  vec3 axis=safeDir(u${P}Axis,vec3(0,1,0));
  vec3 a1=orthoOf(axis), a2=cross(axis,a1);
  if(u${P}ShapeType==0) return vec3(0.);
  if(u${P}ShapeType==1) return sph*u${P}ShapeRadius;
  if(u${P}ShapeType==2) return vec3(sph.x,abs(sph.y),sph.z)*u${P}ShapeRadius;
  if(u${P}ShapeType==3){
    float h=e.w*u${P}ShapeLength;
    float rr=u${P}ShapeRadius+h*tan(min(u${P}ShapeAngle,1.5));
    return axis*h+(a1*cos(ca)+a2*sin(ca))*rr*safePow(e.z,.5);
  }
  if(u${P}ShapeType==4) return (a1*cos(ca)+a2*sin(ca))*u${P}ShapeRadius;
  if(u${P}ShapeType==5){
    float rr=mix(u${P}ShapeInner,u${P}ShapeRadius,safePow(e.z,.5));
    return (a1*cos(ca)+a2*sin(ca))*rr;
  }
  if(u${P}ShapeType==6) return vec3(e.x*2.-1.,e.y*2.-1.,e.z*2.-1.)*u${P}ShapeSize*.5;
  if(u${P}ShapeType==11){
    // frame: the PERIMETER of a rectangle of half-extent (radius, length/2) in
    // the plane across shape.axis, with shape.interiorFraction of the
    // population scattered inside it instead. A rim spray, not a surface one.
    vec2 H=vec2(u${P}ShapeRadius, u${P}ShapeLength*.5);
    vec2 pt; vec2 nrm;
    if(e.w<u${P}Interior){
      pt=vec2((e.x*2.-1.)*H.x*.88,(e.y*2.-1.)*H.y*.90);
      nrm=normalize(pt+vec2(1e-4));
    } else {
      float per=2.*H.x+2.*H.y;
      float sgn=e.z<.5?-1.:1.;
      float dd=e.x*per;
      if(dd<H.x){ pt=vec2(dd,-H.y); nrm=vec2(0.,-1.); }
      else if(dd<H.x+2.*H.y){ pt=vec2(H.x,-H.y+(dd-H.x)); nrm=vec2(1.,0.); }
      else { pt=vec2(H.x-(dd-H.x-2.*H.y),H.y); nrm=vec2(0.,1.); }
      pt.x*=sgn; nrm.x*=sgn;
      pt+=nrm*(e.y-.3)*u${P}ShapeInner;
    }
    return a1*pt.x+a2*pt.y+axis*(e.z-.5)*u${P}ShapeInner;
  }
  if(u${P}ShapeType==13){
    // radialFan: an evenly spaced fan in the plane across shape.axis. The even
    // slot is what keeps a burst from clumping, and angleBias both compresses
    // the fan (a full even ring reads as a clock face) and leans it.
    float bias=clamp(u${P}AngleBias,-1.,1.);
    float ang=idx*6.2831853*(1.-.25*abs(bias))
             +bias*1.5707963
             +(e.x-.5)*u${P}AngleJitter;
    return (a1*cos(ang)+a2*sin(ang))*u${P}ShapeRadius;
  }
  if(u${P}ShapeType==12){
    // orbit: a ring BAND between shape.innerRadius and shape.radius in the
    // plane across shape.axis, hashed on a sqrt so the lane population is even
    // in area rather than in radius.
    float rr=mix(u${P}ShapeInner,u${P}ShapeRadius,sqrt(e.z));
    return (a1*cos(ca)+a2*sin(ca))*rr;
  }
${
  path
    ? /* glsl */ `  if(u${P}SpawnMode==5)
    return frontPoint(s.x)+uFrontN*(e.z-.5)*u${P}ShapeRadius
          +sph*u${P}ShapeRadius*.4;
  if(u${P}ShapeType==8){
    // path: the instance sits ON the document path at its own u, scattered
    // across the path frame by shape.radius so the row reads as a dotted band
    // rather than a string of beads. Paths are in DOCUMENT space.
    vec3 tg=pathTangentE(idx),sd=pathSideE(idx),upn=pathUpE(idx);
    return pathPointE(idx)
      + sd*(e.x-.5)*2.*u${P}ShapeRadius
      + upn*(e.y-.5)*1.5*u${P}ShapeRadius;
  }
`
    : ""
}${
  path
    ? /* glsl */ `  if(u${P}ShapeType==10){
    // pathLine: the instance is SCATTERED along the path at its own hashed u,
    // not at i/(count-1), and spread across the path frame by shape.radius —
    // residue lying along a line rather than an ordered row of beads.
    float pu=fract(s.z*7.31+s.w*3.17);
    vec3 tg=pathTangentE(pu),sd=pathSideE(pu),upn=pathUpE(pu);
    return pathPointE(pu)
      + sd*(e.x-.5)*2.*u${P}ShapeRadius
      + upn*(e.y-.5)*2.*u${P}ShapeRadius
      + tg*(e.z-.5)*u${P}ShapeRadius;
  }
`
    : ""
}${
  events
    ? /* glsl */ `  if(u${P}SpawnMode==4) return ev.xyz+sph*u${P}ShapeRadius;
`
    : ""
}${
  source
    ? /* glsl */ `  if(u${P}ShapeType==9){
    // layerInstances: the site was generated from the SOURCE layer's own hash
    // (crystals-v2 / blob-v2) and rides in as an instance attribute, so it is
    // closed form and independent of how either layer is drawn.
    return srcPos + sph*u${P}ShapeRadius;
  }
`
    : ""
}  return axis*(u${P}ShapeLength*e.w)+sph*u${P}ShapeRadius;
}

vec3 ${p}Dir(vec4 s, vec4 e, vec4 e2, vec3 origin, vec3 srcDir){
  vec3 axis=safeDir(u${P}Axis,vec3(0,1,0));
  vec3 base=safeDir(u${P}Dir,vec3(0,1,0));
  vec3 radial=safeDir(origin,axis);
${
  source
    ? /* glsl */ `  // A layer-instance spawn is thrown along the instance's OWN axis, which is
  // what makes a shatter follow the spikes it broke off rather than the
  // cluster's centre. Every other velocity mode behaves as usual.
  if(u${P}ShapeType==9 && u${P}VelMode==0) return safeDir(srcDir,base);
`
    : ""
}${
  path
    ? /* glsl */ `  // A front-anchored ember is thrown BACKWARD along the arc it was torn off,
  // which is what makes the spray trail the blade instead of spraying out of
  // a ring. Every other velocity mode behaves as usual.
  if(u${P}SpawnMode==5 && u${P}VelMode==0) return safeDir(-frontTangent(s.x),base);
`
    : ""
}  if(u${P}VelMode==0) return safeDir(origin,radial);
  if(u${P}VelMode==1) return base;
  if(u${P}VelMode==2) return safeDir(cross(axis,radial),base);
  vec3 t1=orthoOf(base), t2=cross(base,t1);
  float ph=s.z*6.2831853, cone=s.w*u${P}Angle;
  return safeDir(base+(t1*cos(ph)+t2*sin(ph))*cone, base);
}

/** Speed multiplier at normalized life u (1 when the layer has no speedCurve). */
float ${p}SpeedAt(float u){
  if(u${P}SpeedN<2) return 1.;
  u=clamp(u,0.,1.);
  float v=u${P}SpeedKey[0].y;
  for(int i=1;i<${CURVE_KEYS};i++){
    if(i>=u${P}SpeedN) break;
    float a=u${P}SpeedKey[i-1].x, b=u${P}SpeedKey[i].x;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    v=mix(v,u${P}SpeedKey[i].y,step(a,u)*f);
  }
  return v;
}

/**
 * Integral of the piecewise-linear speed table from 0 to u. Each trapezoid is
 * closed form, so distance travelled stays a pure function of time.
 */
float ${p}SpeedI(float u){
  u=clamp(u,0.,1.);
  float acc=min(u,u${P}SpeedKey[0].x)*u${P}SpeedKey[0].y;
  for(int i=1;i<${CURVE_KEYS};i++){
    if(i>=u${P}SpeedN) break;
    float a=u${P}SpeedKey[i-1].x, b=u${P}SpeedKey[i].x;
    float va=u${P}SpeedKey[i-1].y, vb=u${P}SpeedKey[i].y;
    float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
    acc+=(b-a)*f*(va+(vb-va)*f*.5);
    if(i==u${P}SpeedN-1) acc+=max(u-b,0.)*vb;
  }
  return acc;
}

void ${p}Traj(vec4 s, vec4 e, vec4 e2, vec3 srcPos, vec3 srcDir, vec4 ev, float idx, float age, float life, float t, out vec3 pos, out vec3 vel){
  vec3 origin=${p}Origin(s,e,e2,srcPos,ev,idx);
  vec3 dir=${p}Dir(s,e,e2,origin,srcDir);
  float a=max(age,0.);
  float u=clamp(a/max(life,1e-4),0.,1.);
${
  path
    ? /* glsl */ `  if(u${P}VelMode==4){
    // alongPath: the instance does not fly, it RUNS. One shared head envelope
    // (velocity.speedCurve, sampled on the LAYER's own 0..1 progress) drives
    // every instance, each lagging behind it by its own hashed offset out of
    // the velocity.speed band, so the run reads as a wave travelling down the
    // line rather than as a shower. shape.radius still scatters it.
    float lu=clamp(t/max(uSpan,1e-4),0.,1.);
    float lag=mix(u${P}Speed.x,u${P}Speed.y,e2.w);
    float ru=clamp(${p}SpeedAt(lu)-lag,0.,1.);
    pos=pathPointE(ru)+origin;
    vel=pathTangentE(ru);
    if(u${P}HasFloor==1){ float dy=pos.y-u${P}FloorY; pos.y=u${P}FloorY+max(dy,dy*u${P}FloorSoft); }
    return;
  }
`
    : ""
}
  if(u${P}VelMode==5){
    // orbit: the instance CIRCLES the emitter axis at its own spawn radius.
    // Angular speed is velocity.speed[1] * (r/radius)^-0.5, so the inner lane
    // laps the outer one, plus a small hashed out-of-plane bob. Closed form in
    // age, so a seek lands on exactly the phase playback would have drawn.
    vec3 ax=safeDir(u${P}Axis,vec3(0.,1.,0.));
    float h=dot(origin,ax);
    vec3 rad=origin-ax*h;
    float r=max(length(rad),1e-4);
    float w=u${P}Speed.y*safePow(r/max(u${P}ShapeRadius,1e-3),-.5);
    float ang=w*a, c=cos(ang), sn=sin(ang);
    vec3 turned=rad*c+cross(ax,rad)*sn;
    float bob=(e2.w-.5)*u${P}Speed.x*sin(a*(.6+1.2*e2.x)+e.x*6.2831853);
    pos=turned+ax*(h+bob);
    vel=(cross(ax,turned))*w;
    if(u${P}HasFloor==1){ float dy=pos.y-u${P}FloorY; pos.y=u${P}FloorY+max(dy,dy*u${P}FloorSoft); }
    return;
  }
  float v0=mix(u${P}Speed.x,u${P}Speed.y,e2.w);
  float d,scale;
  if(u${P}SpeedN>1){
    // speedCurve replaces the drag integral: distance = v0 * life * I(u).
    d=life*${p}SpeedI(u); scale=${p}SpeedAt(u);
  } else {
    d=u${P}Drag<.001?a:(1.-exp(-u${P}Drag*a))/u${P}Drag; scale=exp(-u${P}Drag*a);
  }
  pos=origin+dir*v0*d+.5*u${P}Gravity*a*a+u${P}Wind*a;
  vel=dir*v0*scale+u${P}Gravity*a+u${P}Wind;
  if(u${P}PlanarDrag>0.){
    // forces.planarDrag: the HORIZONTAL travel uses its own drag integral while
    // the vertical stays ballistic, so a burst spreads, stops spreading and
    // then settles into a drifting disc.
    float dp=(1.-exp(-u${P}PlanarDrag*a))/u${P}PlanarDrag;
    float sp=exp(-u${P}PlanarDrag*a);
    vec3 flat_=origin+dir*v0*dp+u${P}Wind*a;
    pos.xz=flat_.xz;
    vel.xz=(dir*v0*sp+u${P}Wind).xz;
  }
  if(abs(u${P}VortexW)>1e-5){
    // Rotate the radial part of the displacement about the vortex axis by
    // omega*age, with omega falling off with distance from that axis.
    vec3 ax=safeDir(u${P}VortexAxis,vec3(0.,1.,0.));
    float h=dot(pos,ax); vec3 rad=pos-ax*h; float r=length(rad);
    if(r>1e-5){
      float w=u${P}VortexW/(1.+u${P}VortexFalloff*r);
      float ang=w*a, c=cos(ang), sn=sin(ang);
      pos=ax*h+rad*c+cross(ax,rad)*sn;
      vel=vel*c+cross(ax,vel)*sn;
    }
  }
  if(u${P}Curl>0.){
    vec3 c=curl3(pos*u${P}CurlFreq+vec3(0.,-t*u${P}CurlSpeed,0.)+e2.xyz*3.);
    pos+=c*u${P}Curl*(${curlEnv})*a;
  }
  if(u${P}HasFloor==1){ float dy=pos.y-u${P}FloorY; pos.y=u${P}FloorY+max(dy,dy*u${P}FloorSoft); }
}
`;
}

/** Sub-emitter uniforms plus the sampled parent-transform path. */
const glslSubEmitter = /* glsl */ `
uniform float uParentTimeShift,uInherit,uPathT0,uPathDt;
uniform int uSubMode;
uniform vec2 uSubOffset;
uniform vec3 uParentPath[${CURVE_KEYS}];
/** Parent layer transform delta at absolute time t, from an 8-sample table. */
vec3 parentPathAt(float t){
  float x=clamp((t-uPathT0)/max(uPathDt,1e-4),0.,float(${CURVE_KEYS}-1));
  float i0=floor(x), f=x-i0;
  vec3 a=vec3(0.), b=vec3(0.);
  for(int i=0;i<${CURVE_KEYS};i++){
    float fi=float(i);
    a+=uParentPath[i]*step(abs(fi-i0),.5);
    b+=uParentPath[i]*step(abs(fi-min(i0+1.,float(${CURVE_KEYS}-1))),.5);
  }
  return mix(a,b,f);
}
`;

const glslOrtho = /* glsl */ `
vec3 orthoOf(vec3 a){ return safeDir(abs(a.y)<.9?cross(a,vec3(0,1,0)):cross(a,vec3(1,0,0)), vec3(1,0,0)); }
`;

/**
 * Resolves this instance's birth, life and — for sub-emitters — the parent
 * state it is launched from. `dead` is set when the instance is not alive at
 * the sampled time; both vertex shaders then push it to clip space.
 */
const glslResolveBirth = (sub: boolean) => /* glsl */ `
  float life=selfLife(aSeed);
  float birth; vec3 subOrigin=vec3(0.); vec3 subVel=vec3(0.);
  bool dead=false;
${
  sub
    ? /* glsl */ `
  // Sub-emitter: the child is born where and when the parent was at
  // parentBirth + offset, in the parent's own closed-form trajectory.
  float pLife=parentLife(aPSeed);
  float r=fract(aSeed.x*13.37+aSeed.w*7.77+0.113);
  float off = uSubMode==1 ? pLife
            : uSubMode==2 ? mix(uSubOffset.x,uSubOffset.y,r)
            : mix(uSubOffset.x,uSubOffset.y,fract(aSeed.x*3.0));
  off=clamp(off,0.,pLife);
  float pNow=uTime+uParentTimeShift;
  float pBirth=parentBirth(aPSeed,pNow-off,aEvent,aIndex);
  vec3 ppos,pvel;
  parentTraj(aPSeed,aPExtra,aPExtra2,aSrcPos,aSrcDir,aEvent,aIndex,off,pLife,pBirth+off,ppos,pvel);
  birth=pBirth+off-uParentTimeShift;
  subOrigin=ppos+parentPathAt(pBirth+off);
  subVel=pvel*uInherit;
  if(pBirth>1e8) dead=true;
`
    : `  birth=selfBirth(aSeed,uTime,aEvent,aIndex);
  if(birth>1e8) dead=true;
`
}
  float age=uTime-birth;
  if(age<0. || age>=life) dead=true;
  float u=clamp(age/max(life,1e-4),0.,1.);
`;

export function particleVertexSource(
  sub = false,
  source = false,
  events = false,
) {
  return /* glsl */ `
attribute vec4 aSeed, aExtra, aExtra2;
attribute float aIndex;
${sub ? "attribute vec4 aPSeed, aPExtra, aPExtra2;" : ""}
${source ? "attribute vec3 aSrcPos, aSrcDir;" : ""}
${events ? "attribute vec4 aEvent;" : ""}
uniform float uTime,uStretch,uAtlasTiles,uMotionBlur,uFlipFps,uSpan;
uniform float uTwinkleFreq,uTwinkleDepth;
uniform int uRenderMode,uHasAlphaSpawn,uAtlasCols,uAtlasRows,uFlipMode,uAnchorHead;
uniform vec2 uSize,uRot,uRotInit;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
${glslNoise}
${glslOrtho}
${glslPath("E", "E")}
${glslCurve("A")}
${glslCurve("B")}
${glslCurve("D")}
${glslCurve("E")}
${glslCurve("H")}
${glslCurveInverse("H")}
${glslCurve("T")}
${glslCurveInverse("T")}
${glslParticleCore("", "self", "curveE(u)", source, events)}
${sub ? glslParticleCore("Parent", "parent", "1.0") : ""}
${sub ? glslSubEmitter : ""}
void kill(){ gl_Position=vec4(2.,2.,2.,1.); vAlpha=0.; vU=0.; vRot=0.; vTile=vec2(0.); vWp=vec3(0.); }

void main(){
  vUv=uv; vSeed=aExtra2.xyz;
${glslResolveBirth(sub)}
  if(dead){ kill(); return; }
  vU=u;

  vec3 pos,vel;
  selfTraj(aSeed,aExtra,aExtra2,aSrcPos,aSrcDir,aEvent,aIndex,age,life,uTime,pos,vel);
  pos+=subOrigin+subVel*age;
  vel+=subVel;
  vWp=pos;

  // --- billboard ------------------------------------------------------------
  float size=mix(uSize.x,uSize.y,aExtra2.x)*curveA(u);
  float rot=mix(uRotInit.x,uRotInit.y,aExtra2.y)+mix(uRot.x,uRot.y,aExtra2.z)*age;
  // pathAligned reuses the velocity-stretch machinery with the PATH's heading
  // instead of the particle's velocity: a path-anchored dash holds still, so it
  // has no velocity of its own to align to.
  vec3 heading = uRenderMode==4 && uShapeType==8 ? pathTangentE(aIndex) : vel;
  vec4 mv;
  if(uRenderMode==2 || uRenderMode==3){
    // World-oriented quads: horizontal lies in XZ, vertical in XY.
    float c=cos(rot), s=sin(rot);
    vec2 q=mat2(c,-s,s,c)*position.xy*size;
    vec3 world=uRenderMode==2?vec3(q.x,0.,q.y):vec3(q.x,q.y,0.);
    mv=modelViewMatrix*vec4(pos+world,1.);
    rot=0.;
  } else {
    mv=modelViewMatrix*vec4(pos,1.);
    vec3 sv3=(modelViewMatrix*vec4(heading,0.)).xyz;
    vec2 sv=vec2(sv3.x,sv3.y);
    float svl=length(sv);
    vec2 along=vec2(0.,1.), across=vec2(1.,0.);
    float stretch=1.;
    if((uRenderMode==1 || uRenderMode==4) && svl>1e-4){
      along=sv/svl;
      // Winding: the across axis must be the clockwise perpendicular or the
      // quad is mirrored and back-face culled away.
      across=vec2(along.y,-along.x);
      // post.motionBlur is a multiplier on the velocity stretch, nothing else.
      // A pathAligned quad is stretched by uStretch alone: its heading is a
      // unit tangent, so there is no speed to scale by.
      rot=0.;
      stretch=uRenderMode==4
        ? 1.+uStretch
        : 1.+uStretch*(1.+2.*uMotionBlur)*svl;
    }
    // render.anchor "head": the LEADING point of the stretched card sits on the
    // instance and the streak trails behind it, which is what a speed-line cap
    // needs — the tip is the projectile, the streak is where it has been.
    float anchorShift = uAnchorHead==1 ? -.5*size*stretch : 0.;
    vec2 off=across*position.x*size+along*(position.y*size*stretch+anchorShift);
    if(uMotionBlur>0. && svl>1e-4){
      // Non-stretched modes still elongate along screen velocity, never rotate.
      vec2 vdir=sv/svl;
      off+=vdir*dot(off,vdir)*uMotionBlur*min(svl,8.)*.25;
    }
    mv.xy+=off;
  }
  vRot=rot;
  gl_Position=projectionMatrix*mv;

  vAlpha=curveB(u)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) vAlpha*=curveD(aExtra.w);
  // render.twinkle: a phase hashed off the instance seed, so no two particles
  // blink together. depth 0 leaves the alpha untouched.
  if(uTwinkleDepth>0.)
    vAlpha*=mix(1., safePow(abs(sin(uTime*uTwinkleFreq+aExtra2.y*19.7)),1.5), uTwinkleDepth);

  float cols=float(max(uAtlasCols,1)), rows=float(max(uAtlasRows,1));
  float tiles=max(uAtlasTiles,1.);
  // uFlipMode: 0 = random atlas tile, 1 = flipbook over life, 2 = flipbook at fps.
  float ti=floor(aExtra.z*tiles*.9999);
  if(uFlipMode==1) ti=floor(clamp(u,0.,.9999)*tiles);
  else if(uFlipMode==2) ti=floor(mod(max(age,0.)*uFlipFps,tiles));
  vTile=vec2(mod(ti,cols)/cols, floor(ti/cols)/rows);
}
`;
}

export const particleVertexV2 = particleVertexSource(false);

// --- flat cel strips --------------------------------------------------------

/**
 * `emitter.render.mode:"flatStrip"`: the instance is a tapered flat lick
 * trailing back along the emitter's own axis in VIEW space, not a quad. The
 * anchor still comes from the ordinary trajectory (so the licks ride whatever
 * the emitter shape and the forces do), but the lick's own length, width,
 * lateral offset and wave are re-hashed on floor(layerTime * strip.stepRate) —
 * a FLIPBOOK HOLD. That jump is the whole difference between a hand-drawn lick
 * and a stretched sprite; sliding the same shape along reads as a smear.
 *
 * `position` carries (s along the lick 0..1, side -1..1, 0), and the lick runs
 * from its anchor ALONG the emitter's +axis. Even instances take ramp stop t=0
 * and odd ones t=1 when strip.palettes is 2, and because the draw walks the
 * instances in index order the light set always lands over the dark one — so a
 * flatStrip layer wants render.sortMode "none".
 */
export function stripVertexSource(source = false, events = false) {
  return /* glsl */ `
attribute vec4 aSeed, aExtra, aExtra2;
attribute float aIndex;
${source ? "attribute vec3 aSrcPos, aSrcDir;" : ""}
${events ? "attribute vec4 aEvent;" : ""}
uniform float uTime,uSpan,uStripStep,uStripWave,uPalettes,uStripCount;
uniform float uTwinkleFreq,uTwinkleDepth;
uniform int uHasAlphaSpawn;
uniform vec2 uStripLen,uStripWide,uSize;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
varying float vPalette;
${glslNoise}
${glslOrtho}
${glslPath("E", "E")}
${glslCurve("A")}
${glslCurve("B")}
${glslCurve("D")}
${glslCurve("E")}
${glslCurve("H")}
${glslCurveInverse("H")}
${glslCurve("T")}
${glslCurveInverse("T")}
${glslParticleCore("", "self", "curveE(u)", source, events)}
float stripHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
void kill(){ gl_Position=vec4(2.,2.,2.,1.); vAlpha=0.; vU=0.; vRot=0.; vTile=vec2(0.); vWp=vec3(0.); vPalette=0.; }

void main(){
  vUv=uv; vSeed=aExtra2.xyz; vRot=0.; vTile=vec2(0.);
${glslResolveBirth(false)}
  if(dead){ kill(); return; }
  vU=u;

  vec3 pos,vel;
  selfTraj(aSeed,aExtra,aExtra2,aSrcPos,aSrcDir,aEvent,aIndex,age,life,uTime,pos,vel);
  vWp=pos;

  // The flipbook step: everything about the lick's SHAPE is hashed off k, so it
  // holds for 1/stepRate seconds and then jumps to a new one.
  float k=floor(uTime*uStripStep)+aSeed.x*97.3+aIndex*13.7;
  float L=mix(uStripLen.x,uStripLen.y,stripHash(k*1.31));
  float W=mix(uStripWide.x,uStripWide.y,stripHash(k*3.77+2.1));
  float wob=stripHash(k*5.51+7.7);
  float yc=stripHash(k*9.13+3.3)*uShapeRadius;
  float side=aSeed.y>.5 ? 1. : -1.;

  float s=position.x, v=position.y;
  // The lick tapers at both ends: fat a little way in, sharp at the tip.
  float w=W*.5*safePow(s+.05,.30)*safePow(max(1.-s,0.),.85)*curveA(u);
  float cy=uStripWave*.16*sin(s*3.1+wob*6.2831853)*s;

  vec4 mv=modelViewMatrix*vec4(pos,1.);
  vec3 axisV=(modelViewMatrix*vec4(safeDir(uAxis,vec3(0.,1.,0.)),0.)).xyz;
  vec2 along=length(axisV.xy)>1e-5 ? normalize(axisV.xy) : vec2(1.,0.);
  vec2 across=vec2(-along.y,along.x);
  mv.xy+=along*(s*L)+across*(side*(yc+cy)+v*w);
  gl_Position=projectionMatrix*mv;

  vUv=vec2(s,v*.5+.5);
  // Parity on the INSTANCE INDEX, not on a hash: the draw walks the instances
  // in order, so the odd (light) licks always land over the even (dark) ones.
  // That is why a flatStrip layer wants render.sortMode "none".
  float idx=floor(aIndex*max(uStripCount-1.,1.)+.5);
  vPalette=uPalettes>1.5 ? mod(idx,2.) : 0.;
  vAlpha=curveB(u)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) vAlpha*=curveD(aExtra.w);
  if(uTwinkleDepth>0.)
    vAlpha*=mix(1., safePow(abs(sin(uTime*uTwinkleFreq+aExtra2.y*19.7)),1.5), uTwinkleDepth);
}
`;
}

// --- slivers ----------------------------------------------------------------

/**
 * `emitter.render.mode:"sliver"`: the instance is a flat, tapered, jagged-edged
 * needle in the SCREEN plane, rooted at its own position and pointing along its
 * own heading — the splash sliver's silhouette on an instanced draw.
 *
 * `position` carries (s along the needle 0..1, side -1..1, 0). The notches on
 * each edge are hashed per instance and evaluated here, so all the needles
 * share one buffer and no two share a silhouette.
 *
 * `render.retract` is what a star line does instead of fading: the inner end
 * travels outward while the length collapses, so the ray shortens from the core
 * outward and the middle of the burst stays readable.
 *
 * `render.secondary` compiles a SECOND draw of the same program with uSecondary
 * set and an aSub attribute: short bits strung along each parent needle, which
 * can never drift off the ray they belong to because they re-derive it.
 */
export function sliverVertexSource(source = false, events = false) {
  return /* glsl */ `
attribute vec4 aSeed, aExtra, aExtra2;
attribute float aIndex;
${source ? "attribute vec3 aSrcPos, aSrcDir;" : ""}
${events ? "attribute vec4 aEvent;" : ""}
attribute float aSub;
uniform float uTime,uSpan,uSliverCurve,uSliverTaper,uSliverJag,uSecondary;
uniform float uRetractOn,uRetractStart,uRetractEnd,uRetractTip;
uniform float uSecLength,uTwinkleFreq,uTwinkleDepth;
uniform int uHasAlphaSpawn;
uniform vec2 uSliverLen,uSliverWide,uSecAlong,uSize;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
${glslNoise}
${glslOrtho}
${glslPath("E", "E")}
${glslCurve("A")}
${glslCurve("B")}
${glslCurve("D")}
${glslCurve("E")}
${glslCurve("H")}
${glslCurveInverse("H")}
${glslCurve("T")}
${glslCurveInverse("T")}
${glslParticleCore("", "self", "curveE(u)", source, events)}
float slvHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
/* One notched edge: 2-4 teeth of a hashed depth, exactly the splash sliver's. */
float slvEdge(float t, float base, float h0, float h1, float h2){
  float teeth=2.+floor(h0*3.);
  float depth=uSliverJag*(.34+.30*h1);
  return base*(1.-depth*fract(t*teeth+h2));
}
void kill(){ gl_Position=vec4(2.,2.,2.,1.); vAlpha=0.; vU=0.; vRot=0.; vTile=vec2(0.); vWp=vec3(0.); }

void main(){
  vSeed=aExtra2.xyz; vRot=0.; vTile=vec2(0.);
${glslResolveBirth(false)}
  if(dead){ kill(); return; }
  vU=u;

  vec3 pos,vel;
  selfTraj(aSeed,aExtra,aExtra2,aSrcPos,aSrcDir,aEvent,aIndex,age,life,uTime,pos,vel);
  vWp=pos;

  float hs=aSeed.z*7.3+aSub*2.17;
  float L=mix(uSliverLen.x,uSliverLen.y,slvHash(hs*1.7+.9))*curveA(u);
  float W=mix(uSliverWide.x,uSliverWide.y,slvHash(hs*3.1+5.5));
  // render.retract: the inner end travels outward while the length collapses.
  float root=0.;
  if(uRetractOn>.5){
    float eat=smoothstep(uRetractStart,uRetractEnd,u);
    if(uRetractTip>.5) L*=1.-eat;          // eaten from the tip inward
    else { root=L*eat*.9; L*=1.-eat; }     // eaten from the root outward
  }
  float s=clamp(position.x,0.,1.), v=position.y;

  vec4 mv=modelViewMatrix*vec4(pos,1.);
  // The needle lies along the SCREEN projection of its own heading, so a fan
  // read from a three-quarter camera still fans across the frame.
  vec3 sv3=(modelViewMatrix*vec4(vel,0.)).xyz;
  vec2 along=length(sv3.xy)>1e-5 ? normalize(sv3.xy) : vec2(0.,1.);
  vec2 across=vec2(-along.y,along.x);
  if(uSecondary>.5){
    // A short bit riding its parent needle, at a hashed point along it.
    float at=mix(uSecAlong.x,uSecAlong.y,slvHash(aSub*5.3+aSeed.w*9.1));
    root+=L*at;
    L*=uSecLength;
  }
  float base=W*.5*safePow(max(1.-s,0.),uSliverTaper)*safePow(smoothstep(0.,.22,s),.6);
  float left =slvEdge(s,base,slvHash(hs*2.3),slvHash(hs*4.7+1.1),slvHash(hs*6.1+3.3));
  float right=slvEdge(s,base,slvHash(hs*8.9+2.7),slvHash(hs*11.3+4.9),slvHash(hs*13.7+6.1));
  float w=v<0. ? left : right;
  // Two or three hashed bends, so no two needles are the same straight line.
  float bends=2.+floor(slvHash(hs*17.3+8.3)*2.);
  float bend=uSliverCurve*L*.12*sin(s*3.14159265*bends+slvHash(hs*19.1)*6.2831853)*s
            *(slvHash(hs*23.9)<.5?-1.:1.);
  mv.xy+=along*(root+s*L)+across*(v*w+bend);
  gl_Position=projectionMatrix*mv;

  vUv=vec2(v*.5+.5, s);
  vAlpha=curveB(u)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) vAlpha*=curveD(aExtra.w);
  if(uTwinkleDepth>0.)
    vAlpha*=mix(1., safePow(abs(sin(uTime*uTwinkleFreq+aExtra2.y*19.7)),1.5), uTwinkleDepth);
}
`;
}

/**
 * The needle's fill: the ramp read along its own length (stop t=0 the root, t=1
 * the tip), soft across the width, fading out toward the point.
 */
export const sliverFragmentV2 = /* glsl */ `
precision highp float;
uniform float uOpacity,uFlicker;
uniform int uBlendMode;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
${glslRamp}
void main(){
  if(vAlpha<=0.) discard;
  vec3 col=rampColor(smoothstep(.05,.75,vUv.y));
  float a=vAlpha*uOpacity*uFlicker;
  a*=1.-smoothstep(.72,1.,vUv.y)*.55;
  a*=smoothstep(0.,.30,vUv.x)*smoothstep(1.,.70,vUv.x);
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

/**
 * A flat unlit fill — no gradient, cel style — at one of the ramp's two ends.
 * The silhouette is the strip itself, so there is no mask and no procedural.
 */
export const stripFragmentV2 = /* glsl */ `
precision highp float;
uniform float uOpacity,uFlicker;
uniform int uBlendMode;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
varying float vPalette;
${glslRamp}
void main(){
  if(vAlpha<=0.) discard;
  vec3 col=rampColor(vPalette);
  float a=vAlpha*uOpacity*uFlicker;
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

// --- trails -----------------------------------------------------------------

/**
 * One analytic ribbon per particle: vertex k evaluates the same closed-form
 * position at age - k*spacing, so the ribbon is the particle's own past
 * without any history buffer. `position` carries (side, k, 0).
 */
export function trailVertexSource(sub = false, source = false, events = false) {
  return /* glsl */ `
attribute vec4 aSeed, aExtra, aExtra2;
attribute float aIndex;
${sub ? "attribute vec4 aPSeed, aPExtra, aPExtra2;" : ""}
${source ? "attribute vec3 aSrcPos, aSrcDir;" : ""}
${events ? "attribute vec4 aEvent;" : ""}
uniform float uTime,uSegments,uSpacing,uSpan;
uniform float uTwinkleFreq,uTwinkleDepth;
uniform int uHasAlphaSpawn;
uniform vec2 uSize;
varying vec2 vUv; varying float vU,vAlpha; varying vec3 vSeed; varying vec3 vWp;
${glslNoise}
${glslOrtho}
${glslPath("E", "E")}
${glslCurve("A")}
${glslCurve("B")}
${glslCurve("D")}
${glslCurve("E")}
${glslCurve("G")}
${glslCurve("H")}
${glslCurveInverse("H")}
${glslCurve("T")}
${glslCurveInverse("T")}
${glslParticleCore("", "self", "curveE(u)", source, events)}
${sub ? glslParticleCore("Parent", "parent", "1.0") : ""}
${sub ? glslSubEmitter : ""}
void kill(){ gl_Position=vec4(2.,2.,2.,1.); vAlpha=0.; vU=0.; vUv=vec2(0.); vWp=vec3(0.); }

void main(){
  vSeed=aExtra2.xyz;
${glslResolveBirth(sub)}
  if(dead){ kill(); return; }
  vU=u;

  float side=position.x;
  float k=position.y;
  float kn=clamp(k/max(uSegments-1.,1.),0.,1.);
  vUv=vec2(side*.5+.5, kn);

  float ageK=max(age-k*uSpacing,0.);
  vec3 pos,vel;
  selfTraj(aSeed,aExtra,aExtra2,aSrcPos,aSrcDir,aEvent,aIndex,ageK,life,uTime,pos,vel);
  pos+=subOrigin+subVel*ageK;
  vel+=subVel;
  vWp=pos;

  vec4 mv=modelViewMatrix*vec4(pos,1.);
  vec3 sv3=(modelViewMatrix*vec4(vel,0.)).xyz;
  vec2 sv=vec2(sv3.x,sv3.y);
  float svl=length(sv);
  vec2 across=svl>1e-4?vec2(sv.y,-sv.x)/svl:vec2(1.,0.);
  float width=mix(uSize.x,uSize.y,aExtra2.x)*curveA(u)*curveG(kn)*.5;
  mv.xy+=across*side*width;
  gl_Position=projectionMatrix*mv;

  vAlpha=curveB(u)*smoothstep(0.,.03,age);
  if(uHasAlphaSpawn==1) vAlpha*=curveD(aExtra.w);
  if(uTwinkleDepth>0.)
    vAlpha*=mix(1., safePow(abs(sin(uTime*uTwinkleFreq+aExtra2.y*19.7)),1.5), uTwinkleDepth);
}
`;
}

export const trailFragmentV2 = /* glsl */ `
precision highp float;
uniform sampler2D uTrail;
uniform int uHasTrail,uBlendMode;
uniform float uOpacity,uFlicker,uTrailRampMode;
varying vec2 vUv; varying float vU,vAlpha; varying vec3 vSeed; varying vec3 vWp;
${glslRamp}
void main(){
  if(vAlpha<=0.) discard;
  float shape;
  if(uHasTrail==1){ vec4 m=texture2D(uTrail,vUv); shape=m.a*max(m.r,max(m.g,m.b)); }
  else shape=smoothstep(1.,0.,abs(vUv.x*2.-1.));
  // trail.ramp.space "along" (mode 1) runs the key DOWN the ribbon: vUv.y is 0
  // at the head (the particle itself) and 1 at the tail, the same key
  // trail.widthCurve tapers on. Without a trail ramp the ribbon borrows the
  // layer's ramp keyed on the particle's age, so it is one colour at a time.
  vec3 col=rampColor(uTrailRampMode>.5 ? clamp(vUv.y,0.,1.) : vU);
  float a=shape*vAlpha*uOpacity*uFlicker;
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

export const particleFragmentV2 = /* glsl */ `
precision highp float;
uniform sampler2D uMask,uNoise;
uniform int uHasMask,uHasNoise,uUseErosion,uBlendMode,uProcedural,uAtlasCols,uAtlasRows;
uniform float uTime,uDistort,uErodeSoft,uEdgeW,uEdgeI,uOpacity,uMaskRot;
uniform float uRampKeyMode,uGroundY,uHeightSpan,uFlicker;
uniform float uRampBlendMode,uRampBlendWeight;
uniform vec2 uNoiseScale,uNoisePan,uMaskScale,uMaskPan,uDistortPan;
uniform vec3 uEdgeCol;
varying vec2 vUv; varying float vU,vAlpha,vRot; varying vec3 vSeed; varying vec2 vTile; varying vec3 vWp;
${glslNoise}
${glslRamp}
${glslCurve("C")}
${glslSoft}
${glslProcedural}
${glslSymbol}
/**
 * The ramp key for one of the five spaces a particle understands. 5 is
 * "sprite": the card's own V, 0 at the bottom (the tail of a stretched sprite)
 * and 1 at the top (its head). 4 is "radial" on the card, 3 world height, and
 * everything else is the particle's normalized age.
 */
float particleRampKey(float mode){
  if(mode>4.5) return clamp(vUv.y,0.,1.);
  if(mode>3.5) return clamp(length((vUv-.5)*2.),0.,1.);
  if(mode>2.5) return clamp((vWp.y-uGroundY)/max(uHeightSpan,1e-3),0.,1.);
  return clamp(vU,0.,1.);
}
void main(){
  if(vAlpha<=0.) discard;
  if(uProcedural>=21){
    // The same drawn symbol a sprite draws, on an instanced billboard: the
    // expression (and the cloud lobe layout) is hashed off the instance seed,
    // so a population of six faces is six faces and not one repeated.
    vec2 sp=(vUv-.5)*2.;
    float body,ring,ink,high,hot;
    symbolShape(sp,vSeed.x,uProcedural,body,ring,ink,high,hot);
    float a=(body+ring)*vAlpha*uOpacity*uFlicker*softDepth();
    if(body+ring<.004 || a<.003) discard;
    float tone=screentoneAt(vUv,vWp)*body;
    vec3 col=mix(uSymFill,uScreenCol,tone*.55);
    col=mix(col,uSymHigh,high*.85);
    col=mix(col,uSymHot,hot*uSymHotA);
    col=mix(col,uSymOutline,ring);
    col=mix(col,uSymInk,ink);
    col*=1.+hot*uSymHotA*uSymHotI;
    if(uBlendMode==1) gl_FragColor=vec4(col,clamp(a,0.,1.));
    else gl_FragColor=vec4(col*a,clamp(a,0.,1.));
    return;
  }
  // material.mask.rotation turns the mask on every instance; the per-particle
  // random roll rides on top of it.
  float rot=vRot+uMaskRot;
  vec2 p=vUv-.5; float c=cos(rot), s=sin(rot); p=mat2(c,-s,s,c)*p; vec2 uvp=p+.5;
  float n=.5;
  // Plain discs and un-eroded masks do not consume noise. Avoid evaluating
  // three simplex octaves per fragment unless a feature actually uses them.
  bool needsNoise=uUseErosion==1 || abs(uDistort)>0. ||
    (uHasMask==0 && (uProcedural==1 || uProcedural==2));
  if(needsNoise && uHasNoise==1){
    vec2 nuv=uvp*uNoiseScale+uNoisePan*uTime+vSeed.xy*7.;
    float n1=texture2D(uNoise,nuv).r;
    float n2=texture2D(uNoise,nuv*1.7+vec2(.3,.1)-uNoisePan*uTime*.6).r;
    n=n1*.65+n2*.35;
  } else if(needsNoise) {
    n=.5+.5*fbm3(vec3(uvp*uNoiseScale*2.+uNoisePan*uTime, vSeed.x*17.));
  }
  // noise.distortionPan scrolls the field that drives the distortion (never the
  // mask lookup itself, which would slide the sprite out of its own UV range).
  float nd=n;
  vec2 dp=uDistortPan*uTime;
  if(abs(uDistort)>0. && dot(dp,dp)>0.){
    if(uHasNoise==1) nd=texture2D(uNoise, uvp*uNoiseScale+uNoisePan*uTime+dp+vSeed.xy*7.).r;
    else nd=.5+.5*fbm3(vec3(uvp*uNoiseScale*2.+uNoisePan*uTime+dp, vSeed.x*17.));
  }
  vec2 duv=uvp+(nd-.5)*uDistort*(.4+vU);
  float inside=step(0.,duv.x)*step(duv.x,1.)*step(0.,duv.y)*step(duv.y,1.);
  vec2 muv=duv*uMaskScale+uMaskPan;
  vec2 auv=vec2(muv.x/float(max(uAtlasCols,1)), muv.y/float(max(uAtlasRows,1)))+vTile;
  float shape;
  if(uHasMask==1){ vec4 m=texture2D(uMask,auv); shape=m.a*max(m.r,max(m.g,m.b)); }
  else shape=proceduralShape(p,uvp,n,uTime,0.,uMaskScale,vec3(1.,1.,.1),uProcedural);
  shape*=inside;
  float er=shape, edge=0.;
  if(uUseErosion==1){
    float th=curveC(vU);
    float field=shape*(.35+n*.9);
    er=smoothstep(th,th+uErodeSoft,field);
    edge=smoothstep(th-uEdgeW,th+uErodeSoft*.5,field)-er;
  }
  // Particles key their ramp on life (mode 0/1/2), on world height (3), on the
  // distance out from the card's own centre (4) or along the card itself (5) —
  // "sprite" space, where the quad's +Y is the head of a velocity-stretched
  // streak, so ONE particle carries the whole gradient. material.ramp.blend
  // mixes a second space into the same key. Erosion stays keyed on life.
  float key = particleRampKey(uRampKeyMode);
  if(uRampBlendWeight>0.)
    key = mix(key, particleRampKey(uRampBlendMode), uRampBlendWeight);
  vec3 col=rampColor(key);
  col+=uEdgeCol*uEdgeI*edge*shape;
  // material.flicker: the hashed per-step multiplier, computed on the CPU from
  // floor(layerTime * rate) so every kind that carries it steps together.
  float a=er*vAlpha*uOpacity*uFlicker*softDepth();
  if(a<.002) discard;
  // Alpha blending is set up premultiplied for every mode but "alpha".
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

// ---------------------------------------------------------------------------
// Spherical hex lattice
//
// The cell sites are generated and relaxed on the CPU (lattice-v2.ts) and
// arrive as a 1-row float texture sorted by descending y. A fragment's own
// latitude gives the index its nearest site is near, so only a band of
// LATTICE_SCAN indices either side of it is ever scanned: the lookup cost is
// independent of `lattice.cells`.
//
// `edge` is (d2 - d1) / cellRadius — 0 exactly on a cell boundary, about 1 at a
// cell centre — which is the whole pattern: walls, gaps and fill are three
// smoothsteps on it, so their weight does not change with the cell count.
// ---------------------------------------------------------------------------

const glslLattice = /* glsl */ `
uniform sampler2D uSites; uniform float uCells,uCellA;
float latHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
void cellLookup(vec3 nrm, out vec3 site, out float id, out float edge){
  int centre=int(floor((1.-nrm.y)*uCells*.5));
  float d1=9., d2=9.; id=0.; site=vec3(0.,1.,0.);
  for(int k=-${LATTICE_SCAN};k<=${LATTICE_SCAN};k++){
    int idx=centre+k;
    if(idx<0 || idx>=int(uCells)) continue;
    vec3 q=texture2D(uSites, vec2((float(idx)+.5)/${LATTICE_TEXTURE_WIDTH}.0, .5)).xyz;
    float d=distance(q,nrm);
    if(d<d1){ d2=d1; d1=d; id=float(idx); site=q; }
    else if(d<d2) d2=d;
  }
  edge=(d2-d1)/max(uCellA,1e-4);
}
`;

// ---------------------------------------------------------------------------
// Surface meshes (shell / sprite / ring / beam / trail / decal)
// ---------------------------------------------------------------------------

export const surfaceVertexV2 = /* glsl */ `
uniform float uTime,uLength,uRadius,uThickness,uArc,uVertexAmp,uVertexFreq,uVertexSpeed,uDisplaceShift,uRoll;
uniform float uChannel,uSplitOffset,uSplitGrowth,uLayerU;
uniform int uShell,uHasVertexNoise,uBillboard,uRibbon,uUseLocalZ,uSlab,uSlabBase;
uniform float uSlabTaper;
// geometry.type "frame": the card is grown by uFrameMargin metres on every side
// so the halo around the bar has room, and vObj carries the LOCAL position in
// metres, which is what the fragment reads the rounded-rect SDF off.
uniform int uFrameV;
uniform float uFrameMargin;
uniform vec2 uZRange;
uniform vec3 uVertexBias;
varying vec3 vN,vWp,vObj; varying float vAlong,vLobe,vRing; varying vec2 vUv;
${glslNoise}
${glslCurve("F")}
vec3 orthoOf(vec3 a){ return safeDir(abs(a.y)<.9?cross(a,vec3(0,1,0)):cross(a,vec3(1,0,0)), vec3(1,0,0)); }
void main(){
  // The object-space position: the lattice looks its cells up on it and a
  // reveal front keys on it, so both are independent of the layer's transform.
  vUv=uv; vLobe=0.; vRing=uv.x; vObj=position;
  vec3 worldPos, worldNormal;
  if(uFrameV==1){
    // A flat card standing in the layer's own XY plane, sized from the LIVE
    // geometry every frame so a track on length or radius really resizes the
    // doorway. Everything else about a frame happens per pixel.
    vec2 half2=vec2(uRadius+uFrameMargin, uLength*.5+uFrameMargin);
    vec3 local=vec3(position.xy*half2, 0.);
    vObj=local;
    vAlong=clamp(uv.y,0.,1.);
    worldPos=(modelMatrix*vec4(local,1.)).xyz;
    worldNormal=safeDir((modelMatrix*vec4(0.,0.,1.,0.)).xyz, vec3(0.,0.,1.));
    vWp=worldPos; vN=worldNormal;
    gl_Position=projectionMatrix*viewMatrix*vec4(worldPos,1.);
    if(uChannel>=0.)
      gl_Position.x+=(uChannel-1.)*uSplitOffset*(1.+uSplitGrowth*clamp(uLayerU,0.,1.))*gl_Position.w;
    return;
  }
  if(uSlab==1){
    // geometry.type "slab": a VIEW-SPACE bar. The quad is rebuilt every frame
    // on the screen projection of the layer's own local +Z, so the bar runs
    // along the axis from any camera angle, never shears as the axis tilts away
    // and never goes edge-on — which is what a real tube does at a grazing
    // angle and exactly what a beam body must not do.
    //
    // Because it is built in view space the whole thing is done here in clip
    // space; the fragment's world position is the layer origin, which is all
    // the height ramp and the ground glow ever need from a billboard.
    float s=position.x*.5+.5;              // 0..1 along the bar
    vAlong=s; vRing=position.y*.5+.5; vUv=vec2(s,position.y*.5+.5);
    vec3 centre=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
    vec4 mv=viewMatrix*vec4(centre,1.);
    vec3 axisV=(viewMatrix*modelMatrix*vec4(0.,0.,1.,0.)).xyz;
    vec2 along=length(axisV.xy)>1e-5 ? normalize(axisV.xy) : vec2(1.,0.);
    vec2 across=vec2(-along.y,along.x);
    // transform.scale reaches the bar the way it reaches every other kind.
    float sAxis=length(modelMatrix[2].xyz);
    float sRad=.5*(length(modelMatrix[0].xyz)+length(modelMatrix[1].xyz));
    float len=uLength*sAxis;
    float half_=uThickness*.5*sRad*mix(1.,uSlabTaper,s);
    float offAlong=uSlabBase==1 ? s*len : (s-.5)*len;
    mv.xy+=along*offAlong+across*position.y*half_;
    vWp=centre;
    vN=vec3(0.,0.,1.);
    gl_Position=projectionMatrix*mv;
    if(uChannel>=0.)
      gl_Position.x+=(uChannel-1.)*uSplitOffset*(1.+uSplitGrowth*clamp(uLayerU,0.,1.))*gl_Position.w;
    return;
  }
  if(uRibbon==1){
    // A tapered arc sweep in the local XY plane (the swoosh of a slash):
    // geometry.radius is the arc radius, geometry.length the angle it sweeps
    // (uArc, radians) and geometry.thickness its half-width at the fattest
    // point. The strip carries (u along the arc, side) in the position attribute.
    float ua=clamp(position.x,0.,1.); float side=position.y;
    vAlong=clamp(uv.y,0.,1.);
    float a=ua*uArc;
    float taper=safePow(max(0.,sin(3.14159265*ua)),.6);
    float w=max(1e-4,uThickness*taper);
    float rr=uRadius+side*w;
    vec3 local=vec3(cos(a)*rr, sin(a)*rr, .12*uRadius*sin(a*2.));
    if(uHasVertexNoise==1){
      float nz=fbm3(vec3(local.xy*uVertexFreq, a-uTime*uVertexSpeed));
      local+=vec3(cos(a),sin(a),0.)*nz*uVertexAmp*uRadius*curveF(vAlong);
    }
    worldPos=(modelMatrix*vec4(local,1.)).xyz;
    worldNormal=safeDir((modelMatrix*vec4(0.,0.,1.,0.)).xyz, vec3(0.,0.,1.));
  } else if(uShell==1){
    // Unit sphere -> teardrop: along = (1-z)/2 on the local +Z axis (z=+1 is
    // the head). The tube frame is built from the WORLD axis so that the ring
    // "up" reference and the bias push direction live in the same space no
    // matter how the layer's transform decomposes into euler angles.
    float along=clamp((1.-position.z)*.5,0.,1.); vAlong=along;
    // Squaring, not pow(): a negative base would be clamped by safePow and the
    // bulbous nose would flatten into a full-radius cylinder.
    float taper=along*2.-1.;
    // transform.scale reaches the analytic body too: the axis column of the
    // model matrix scales nose-to-tail, the lateral columns the body radius.
    float sAxis=length(modelMatrix[2].xyz);
    float sRad=.5*(length(modelMatrix[0].xyz)+length(modelMatrix[1].xyz));
    float radius=uRadius*sRad, length_=uLength*sAxis;
    // The tail is a fan of coincident vertices: closing it to a point over the
    // last 5% of 'along' replaces a torn cap with a smooth taper.
    float tailCap=smoothstep(1.,.95,along);
    float r=radius*(1.05*sqrt(max(0.,1.-taper*taper))*(1.-along*.45)+.06)*tailCap;
    float len=length_*(along<.5? along*.9 : .45+(along-.5)*1.1);
    vec3 head=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
    vec3 axis=safeDir((modelMatrix*vec4(0.,0.,1.,0.)).xyz, vec3(0.,0.,1.));
    vec3 t1=orthoOf(axis), t2=cross(axis,t1);
    vec2 ring=normalize(position.xy+vec2(1e-5));
    vRing=atan(ring.y,ring.x)*.15915494+.5;
    vec3 radial=t1*ring.x+t2*ring.y;
    vec3 base=head+axis*len+radial*r;
    float amp=uHasVertexNoise==1?uVertexAmp:0.;
    float nz=fbm3(vec3(ring*uVertexFreq+vec2(along*3.5,0.), along*4.-uTime*uVertexSpeed)+vec3(0.,0.,along*3.));
    float disp=nz*amp*curveF(along)*radius*2.4*tailCap;
    // Low-frequency lobes on one side of the tube only: a few big licks lift
    // off the tail along the bias direction, so the body silhouette stays thin.
    vec3 bias=safeDir(uVertexBias,vec3(0.,1.,0.));
    float lobe=snoise(vec3(ring*(uVertexFreq*.36)+vec2(along*1.4,0.), along*2.2-uTime*(uVertexSpeed*.75)));
    float up=smoothstep(.2,.95,ring.y)*smoothstep(.35,.8,along);
    vLobe=max(0.,lobe)*up*step(1e-4,amp);
    float lick=vLobe*radius*(amp*6.2)*tailCap;
    worldPos=base+radial*disp+axis*nz*.25*along
      +bias*(length_*.236*safePow(along,2.3)*(.6+.4*nz)+lick);
    worldNormal=safeDir(radial, vec3(0.,1.,0.));
  } else if(uBillboard==1){
    // A sprite is a camera-facing square of half-size geometry.radius: the quad
    // is rebuilt on the view's right/up axes around the layer origin, so it
    // never edges out of the shot. transform.rotation[2] survives as a roll.
    vAlong=clamp(uv.y,0.,1.);
    vec3 centre=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
    vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
    vec3 up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
    // The instance's own scale still shapes the quad (a streak stays a streak).
    vec2 half2=vec2(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz));
    float c=cos(uRoll), s=sin(uRoll);
    vec2 q=vec2(position.x*half2.x, position.y*half2.y);
    q=vec2(q.x*c-q.y*s, q.x*s+q.y*c);
    worldPos=centre+right*q.x+up*q.y;
    worldNormal=safeDir(cross(right,up), vec3(0.,0.,1.));
  } else {
    // A mesh whose axis really runs along local +Z (a bar, a crystal) keys its
    // ramp and erosion on that axis; flat cards and lathed shapes keep uv.y.
    vAlong=uUseLocalZ==1
      ? clamp((position.z-uZRange.x)/max(uZRange.y-uZRange.x,1e-4),0.,1.)
      : clamp(uv.y,0.,1.);
    vec3 pos=position;
    if(uHasVertexNoise==1){
      float nz=fbm3(vec3(position.xy*uVertexFreq, position.z*uVertexFreq-uTime*uVertexSpeed));
      vec3 bias=safeDir(uVertexBias,normal);
      pos+=mix(normal,bias,.5)*nz*uVertexAmp*curveF(vAlong);
    }
    worldPos=(modelMatrix*vec4(pos,1.)).xyz;
    worldNormal=safeDir((modelMatrix*vec4(normal,0.)).xyz, vec3(0.,1.,0.));
  }
  vWp=worldPos;
  vN=worldNormal;
  gl_Position=projectionMatrix*viewMatrix*vec4(worldPos,1.);
  // material.rgbSplit: this draw is one of three per-channel copies (uChannel
  // 0/1/2), pushed apart in CLIP space so the offset is a constant fraction of
  // the frame at any depth. uChannel < 0 is the ordinary single draw.
  if(uChannel>=0.)
    gl_Position.x+=(uChannel-1.)*uSplitOffset*(1.+uSplitGrowth*clamp(uLayerU,0.,1.))*gl_Position.w;
}
`;

export const surfaceFragmentV2 = /* glsl */ `
precision highp float;
uniform float uTime,uOpacity,uErodeSoft,uEdgeW,uEdgeI,uProtect,uRimBias,uDisplaceShift;
uniform float uFresnelPower,uFresnelStrength,uDistort,uRampKeyMode,uLayerU,uMaskRot,uRadius,uLength,uThickness;
uniform float uGroundY,uHeightSpan,uChannel,uRampBlendMode,uRampBlendWeight;
uniform int uShell,uHasMask,uHasNoise,uUseErosion,uBlendMode,uProcedural,uHasFresnel,uBolt;
uniform vec2 uNoiseScale,uNoisePan,uMaskScale,uMaskPan,uDistortPan;
uniform vec3 uEdgeCol,uCam;
uniform sampler2D uMask,uNoise;
// material.lattice / reveal / planeGlow / ripples, and the band's own facing dim.
uniform int uHasLattice,uHasReveal,uRevealMode,uHasPlaneGlow,uHasDissolve,uRippleN,uBand;
uniform float uLatEdge,uLatGap,uPulseSpeed,uPhaseJitter,uGrazeFade;
uniform float uDisStart,uDisStagger,uDisSoft;
uniform float uRevealFrom,uRevealTo,uRevealWidth;
uniform float uPlaneDist,uPlaneI,uBandStripes;
uniform vec3 uTileCol,uLatEdgeCol,uPlaneCol;
// 0..3 are the great-circle origins, 4..7 their (speed, width, decay).
uniform vec4 uRipple[8];
// geometry.slab: the tiered billboard bar, and material.flicker's per-step
// multiplier (computed on the CPU from floor(layerTime * rate), so the mesh and
// every other kind that carries it step together).
uniform int uSlab,uSlabN;
// 0..3 are (height, intensity); 4..7 carry the tier colour in .rgb.
uniform vec4 uSlabTier[8];
uniform float uFlicker;
// kind "reflection": the same draw, mirrored under the ground plane, washed
// toward uReflectTint and faded with depth below it.
uniform int uReflect;
uniform vec3 uReflectTint;
uniform float uReflectOpacity,uReflectBlur;
// material.streaks / material.creases: hard surface bands and the narrow dark
// folds under them, both keyed on the body's own (angle, along) coordinates.
uniform int uStreakOn,uStreakRadiate,uCreaseOn;
uniform vec4 uStreakA;   // (frequency, pan, width, segmentation)
uniform vec4 uStreakB;   // (intensity, fadeFrom, fadeTo, -)
uniform vec3 uStreakCol;
uniform vec3 uCrease;    // (frequency, depth, alongStart)
uniform float uSymbolSeed;
varying vec3 vN,vWp,vObj; varying float vAlong,vLobe,vRing; varying vec2 vUv;
${glslNoise}
${glslRamp}
${glslCurve("C")}
${glslProcedural}
${glslSymbol}
${glslFrame}
${glslFlow}
${glslSwirl}
${glslLattice}
void main(){
  vec3 V=safeDir(uCam-vWp, vec3(0.,0.,1.));
  float fres=1.-abs(dot(vN,V));
  if(uProcedural>=21){
    // A drawn symbol: a flat fill inside an ink outline, coloured by
    // material.symbol and never by the ramp. Mixing a gradient through it is
    // exactly what stops it reading as drawn.
    vec2 sp=(vUv-.5)*2.;
    float body,ring,ink,high,hot;
    symbolShape(sp,uSymbolSeed,uProcedural,body,ring,ink,high,hot);
    float a=(body*uOpacity+ring)*uFlicker;
    if(body+ring<.004 || a<.003) discard;
    float tone=screentoneAt(vUv,vObj)*body;
    vec3 col=mix(uSymFill,uScreenCol,tone*.55);
    col=mix(col,uSymHigh,high*.85);
    col=mix(col,uSymHot,hot*uSymHotA);
    col=mix(col,uSymOutline,ring);
    col=mix(col,uSymInk,ink);
    col*=1.+hot*uSymHotA*uSymHotI;
    if(uChannel>=0.)
      col*=uChannel<.5?vec3(1.,0.,0.):(uChannel<1.5?vec3(0.,1.,0.):vec3(0.,0.,1.));
    if(uBlendMode==1) gl_FragColor=vec4(col,clamp(a,0.,1.));
    else gl_FragColor=vec4(col*a,clamp(a,0.,1.));
    return;
  }
  if(uSlab==1){
    // Hard tiers, not a gaussian: a soft-edged wide slab reads as fog, a tiered
    // one as a bar. The tiers are listed outermost first, so each later one
    // paints over the one before it and the last entry is the hot core.
    float y=abs(vUv.y-.5)*uThickness;          // world metres from the axis
    float hmax=max(uSlabTier[0].x,1e-4);
    vec3 c=vec3(0.); float a=0.;
    for(int i=0;i<4;i++){
      if(i>=uSlabN) break;
      float h=max(uSlabTier[i].x,1e-4);
      float e=h*.08;                           // the 8% edge
      float w=1.-smoothstep(h-e,h+e,y);
      c=mix(c,uSlabTier[4+i].rgb,w);
      a+=w*uSlabTier[i].y;
    }
    // A faint gaussian seat under the tiers, so the bar is not pasted on.
    a+=exp(-(y/hmax)*(y/hmax)*1.6)*.10;
    // Soft at both ends: a squared-off tip reads as a card, and a column must
    // never end in a flat cap.
    a*=smoothstep(0.,.07,vAlong)*(1.-smoothstep(.88,1.02,vAlong));
    a*=stripeTerm(vAlong*uLength, vUv.y, uTime)*uOpacity*uFlicker;
    if(a<.002) discard;
    if(uBlendMode==1) gl_FragColor=vec4(c,a);
    else gl_FragColor=vec4(c*a,a);
    return;
  }
  if(uFrame==1){
    // The whole rim, read off one signed distance: the drawn arc (the reveal
    // front runs the PERIMETER, so the doorway draws itself up both sides at
    // once), the solid bar, the hot spine down the middle of it, the thinner
    // parallel line inside it and the halo skirts around the lot. The ramp is
    // sampled at four fixed keys, which is what lets ONE ramp carry a rim.
    vec2 H=vec2(max(uRadius-uThickness*.5,1e-3), max(uLength*.5-uThickness*.5,1e-3));
    float d=sdRoundRect(vObj.xy, H, min(uCorner, min(H.x,H.y)*.98));
    float ad=abs(d);
    float u=framePerimeter(vObj.xy, H);
    float front=mix(uRevealFrom,uRevealTo,clamp(uLayerU,0.,1.));
    float gate = uHasReveal==1 ? 1.-smoothstep(front, front+max(uRevealWidth,1e-3), u) : 1.;
    // Squared, never safePow: safePow clamps a negative base to an epsilon,
    // which would make every pixel INSIDE the frame read as the spine.
    float lk=(u-front)/max(uRevealWidth,1e-3);
    float lead = uHasReveal==1
      ? exp(-lk*lk*4.)*step(.004,front)*step(front,.996) : 0.;
    float bead=beadTerm(u,uTime);
    float hw=uThickness*.5;
    float core = 1.-smoothstep(hw-uThickness*.08, hw+uThickness*.05, ad);
    float sk=d/max(uSdfSpine,1e-4);
    float ik=(d+uSdfInnerOff)/max(uSdfInnerW,1e-4);
    float spine = uSdfSpine>0. ? exp(-sk*sk) : 0.;
    float inner = uSdfInnerW>0. ? exp(-ik*ik) : 0.;
    float halo=0.;
    for(int i=0;i<3;i++){
      if(i>=uSdfN) break;
      halo+=exp(-ad/max(uSdfHalo[i].x,1e-4))*uSdfHalo[i].y;
    }
    float lit=bead*.11+lead*.16;
    vec3 col = rampColor(.22)*core*(uSdfCore+lit)
             + rampColor(0.)*spine*(1.+bead*.38+lead*1.5)
             + rampColor(.45)*inner
             + rampColor(1.)*halo;
    float a=clamp(core*uSdfCore + spine*.8 + inner*.9 + halo, 0., 1.);
    a*=gate*uOpacity*uFlicker*stripeTerm(u*max(2.*(uRadius+uLength*.5),1e-3), ad/max(hw,1e-4), uTime);
    col*=gate;
    if(uReflect==1){
      col=mix(col,uReflectTint,.45);
      a*=uReflectOpacity*(1.-smoothstep(0.,max(1.-uReflectBlur,.05),clamp(vUv.y,0.,1.)));
    }
    if(uChannel>=0.)
      col*=uChannel<.5?vec3(1.,0.,0.):(uChannel<1.5?vec3(0.,1.,0.):vec3(0.,0.,1.));
    if(a<.003) discard;
    if(uBlendMode==1) gl_FragColor=vec4(col,a);
    else gl_FragColor=vec4(col*a,a);
    return;
  }
  if(uProcedural==19){
    // The polar swirl disc. The band mask IS the silhouette, the detail spiral
    // shades it from inside, and the ramp (space "radial") runs from the hot
    // centre out to the haze. The erosion curve raises the mask threshold, so
    // the disc TEARS from the outside in on the dissipate rather than dimming.
    vec2 q=(vUv-.5)*2.;
    float dd=length(q);
    if(dd>1.) discard;
    vec2 sw=swirlDisc(q,uTime);
    float outer=1.-smoothstep(.78,1.04,dd);
    // The erosion curve is the mask THRESHOLD over the layer's own progress
    // (not over an along coordinate, which a disc does not have), and
    // erosion.rimBias biases it outward: the disc tears from the rim inward on
    // the dissipate instead of dimming as a whole.
    float thr=curveC(clamp(uLayerU,0.,1.))+uRimBias*.55*smoothstep(.2,1.,dd);
    float mask=smoothstep(thr,thr+max(uErodeSoft,.01),sw.x)*outer;
    // The lit term is what the ramp reads: 0 at the hot centre, 1 at the haze.
    float litR=1./(1.+safePow(dd*1.95,2.));
    vec3 col=rampColor(clamp(1.-litR,0.,1.));
    // The detail spiral only ever SHADES: a second mask here would read as a
    // copy of the first rather than as structure inside the arms.
    col=mix(col*.30, col, sw.y);
    col*=.62+.5*litR;
    col+=rampColor(0.)*smoothstep(.86,1.,litR)*.18;
    float a=mask*uOpacity*uFlicker;
    if(uReflect==1){ col=mix(col,uReflectTint,.45); a*=uReflectOpacity; }
    if(uChannel>=0.)
      col*=uChannel<.5?vec3(1.,0.,0.):(uChannel<1.5?vec3(0.,1.,0.):vec3(0.,0.,1.));
    if(a<.003) discard;
    if(uBlendMode==1) gl_FragColor=vec4(col,a);
    else gl_FragColor=vec4(col*a,a);
    return;
  }
  // material.flow: the multi-layer panning surface REPLACES material.noise as
  // the field, and (with ramp.space "surface") as the ramp key: stop t=0 is the
  // open surface and t=1 the patch that covers it.
  float flowMask=-1.;
  if(uFlowOn==1){
    vec2 vd=(viewMatrix*vec4(safeDir(uCam-vWp,vec3(0.,0.,1.)),0.)).xy;
    float field=flowField(vUv*vec2(uRadius*2., uLength), uTime, vd);
    flowMask=smoothstep(uFlowCut.x, uFlowCut.x+max(uFlowCut.y,1e-3), field);
  }
  float n=.5;
  if(uFlowOn==1){
    n=flowMask;
  } else if(uShell==1){
    n=.5+.5*(.7*snoise(vec3(vUv.x*3.0, vAlong*3.2-uTime*2.0, .7))+.3*snoise(vec3(vUv.x*6.0, vAlong*6.0-uTime*3.1, 2.3)));
    if(uHasNoise==1){
      float ntex=texture2D(uNoise, vec2(vUv.x*uNoiseScale.x, vAlong*uNoiseScale.y+uNoisePan.y*uTime)).r;
      n=n*.75+ntex*.25;
    }
  } else if(uHasNoise==1){
    n=texture2D(uNoise, vUv*uNoiseScale+uNoisePan*uTime).r;
  } else {
    n=.5+.5*fbm3(vec3(vUv*uNoiseScale*2.+uNoisePan*uTime, 3.1));
  }

  float shape=1.;
  vec3 dims=vec3(uRadius,uLength,uThickness);
  if(uBolt==1){
    // A bolt is a tube: its normals face the camera along the centreline and
    // graze it at the silhouette, which is exactly the falloff a hot core with
    // a soft edge wants. Without it the tube reads as a flat blown-out slab.
    shape=safePow(abs(dot(vN,V)),.65);
  } else if(uShell==1 || uHasLattice==1 || uBand==1){
    // A closed body, a lattice shell and a belt all have a silhouette of their
    // own, so a BILLBOARD silhouette (modes 0-3 and 12-16: a soft disc, a
    // flame, a glint, a sigil) has nothing to describe — applied here it would
    // cut the surface down to a disc in UV space, which on a sphere is a
    // crescent and on a strip is a blob halfway along it. Only the surface
    // patterns (4-11) apply, on (angle, distance along) for the shell and on
    // the mesh's own UV for the other two.
    if(uProcedural>=4 && uProcedural<12)
      shape=uShell==1
        ? proceduralShape(vec2(vRing,vAlong)-.5,vec2(vRing,vAlong),n,uTime,fres,uMaskScale,dims,uProcedural)
        : proceduralShape(vUv-.5,vUv,n,uTime,fres,uMaskScale,dims,uProcedural);
  } else {
    // noise.distortionPan scrolls the field that drives the distortion.
    float nd=n;
    vec2 dp=uDistortPan*uTime;
    if(dot(dp,dp)>0.)
      nd=uHasNoise==1
        ? texture2D(uNoise, vUv*uNoiseScale+uNoisePan*uTime+dp).r
        : .5+.5*fbm3(vec3(vUv*uNoiseScale*2.+uNoisePan*uTime+dp, 3.1));
    vec2 duv=vUv+(nd-.5)*uDistort;
    float mc=cos(uMaskRot), ms=sin(uMaskRot);
    vec2 muv=(mat2(mc,-ms,ms,mc)*(duv-.5)+.5)*uMaskScale+uMaskPan;
    if(uHasMask==1){ vec4 m=texture2D(uMask,muv); shape=m.a*max(m.r,max(m.g,m.b)); }
    else shape=proceduralShape(vUv-.5,vUv,n,uTime,fres,uMaskScale,dims,uProcedural);
  }

  // Every ramp space this surface understands, as one function, so
  // material.ramp.blend can ask it twice and mix the two keys.
  #define MESH_RAMP_KEY(mode, dst) \
    /* 5 = "sprite": the mesh's own V. On a card that is bottom-to-top, which */ \
    /* is the same axis a stretched particle's sprite gradient runs along. */ \
    if(mode>4.5) dst=clamp(vUv.y,0.,1.); \
    /* 4 = "radial": distance from the layer centre over geometry.radius, read */ \
    /* off the card's own UV so it is independent of the transform. */ \
    else if(mode>3.5) dst=clamp(length((vUv-.5)*2.),0.,1.); \
    /* A flow surface keys the "surface" space on its own MASK, not on the */ \
    /* along coordinate: the patches are what the two stops describe. */ \
    else if(mode>1.5 && mode<2.5 && flowMask>=0.) dst=flowMask; \
    /* 3 = "height": world metres above environment.groundY, over uHeightSpan. */ \
    else if(mode>2.5) dst=clamp((vWp.y-uGroundY)/max(uHeightSpan,1e-3),0.,1.); \
    else if(mode>1.5) dst=clamp(vAlong*1.08+(n-.5)*.35*smoothstep(.15,.7,vAlong),0.,1.); \
    else if(mode>0.5) dst=clamp(uLayerU,0.,1.); \
    else dst=clamp(vAlong,0.,1.);
  float key;
  MESH_RAMP_KEY(uRampKeyMode, key)
  if(uRampBlendWeight>0.){
    float bkey;
    MESH_RAMP_KEY(uRampBlendMode, bkey)
    key=mix(key,bkey,uRampBlendWeight);
  }
  // The rim term is attenuated near the start of a mesh's axis so a bar does not
  // flare at its root; a lattice body has no such root, and its rim is exactly
  // what carries the silhouette where the cells fade out, so it is exempt.
  if(uHasFresnel==1)
    key+=safePow(fres,uFresnelPower)*uFresnelStrength
        *(uHasLattice==1?1.:smoothstep(0.,.4,vAlong));
  key+=uDisplaceShift*vLobe;
  // lensFlare and radialRays supply their own key, radially: ramp stop t=0 is
  // the hot core and t=1 the outer halo, so one card is both.
  float pk=proceduralKey(vUv-.5,uTime,uProcedural);
  if(pk>=0.) key=pk;
  key=clamp(key,0.,1.);

  float alpha=uOpacity;
  float rim=0.;
  if(uUseErosion==1){
    // The field stays mostly low frequency so a tail carves into a few long
    // tongues instead of confetti.
    float low=.5+.5*snoise(vec3(vUv.x*1.15, vAlong*1.25-uTime*1.5, 4.1));
    float field=uShell==1?((.25*low+.75*n)*.9+.2):(shape*(.35+n*.9));
    float th=max(0., curveC(vAlong) - vLobe*uProtect + fres*uRimBias*.5);
    float er=smoothstep(th,th+uErodeSoft,field);
    if(er<.01) discard;
    rim=smoothstep(th-uEdgeW,th+uErodeSoft*.5,field)-er;
    alpha*=er;
  }
  // shape is 1 on an analytic shell with procedural "none", so this is a no-op
  // there and the procedural pattern applies everywhere else.
  alpha*=shape;
  // material.stripes: panning hard bands on the along coordinate in world
  // metres, so a beam that extends does not squash its own bands.
  // material.flicker: the hashed per-step multiplier, computed on the CPU.
  alpha*=stripeTerm(vAlong*uLength, vRing, uTime)*uFlicker;

  // --- reveal / lattice / ground proximity / ripples ------------------------
  // Every one of them is a pure function of (object position, layer time), so a
  // seek lands on exactly the cells, front and rings playback would have drawn.
  vec3 objN=safeDir(vObj, vec3(0.,1.,0.));
  // The front travels from reveal.from to reveal.to over the layer's own 0..1
  // progress; values outside 0..1 finish a reveal early inside a longer layer.
  float front=mix(uRevealFrom,uRevealTo,clamp(uLayerU,0.,1.));
  float ndv=abs(dot(vN,V));
  // Analytic ground proximity: no depth texture, so it cannot flicker.
  float nearGround=uHasPlaneGlow==1
    ? smoothstep(uPlaneDist,0.,vWp.y-uGroundY) : 0.;
  float latticeVis=0.;
  vec3 latticeCol=vec3(0.);
  if(uHasLattice==1){
    vec3 site; float id,edge;
    cellLookup(objN,site,id,edge);
    float hc=latHash(id*1.7+.31);
    // The reveal keys on the CELL, not the pixel, so a cell lights up whole.
    float cellKey=(1.-site.y)*.5;
    float on=uHasReveal==1 ? 1.-smoothstep(front-.04,front+.02,cellKey) : 1.;
    float band=uHasReveal==1
      ? (1.-smoothstep(0.,max(uRevealWidth,1e-3),abs(cellKey-front))) : 0.;
    float off=uHasDissolve==1
      ? 1.-smoothstep(hc*uDisStagger, hc*uDisStagger+uDisSoft,
                      max(0.,clamp(uLayerU,0.,1.)-uDisStart))
      : 1.;
    float cellOn=on*off;
    // Outward pulse from the crown, each cell on its own hashed phase.
    float pulse=.5+.5*sin(uTime*uPulseSpeed-(1.-site.y)*2.6+hc*uPhaseJitter*6.2831853);
    // Expanding great-circle ripples brighten whatever they cross.
    float rip=0.;
    for(int i=0;i<4;i++){
      if(i>=uRippleN) break;
      float age=uTime-uRipple[i].w;
      if(age<0.) continue;
      float gc=acos(clamp(dot(objN,uRipple[i].xyz),-1.,1.));
      float r=age*uRipple[4+i].x;
      rip+=(1.-smoothstep(0.,max(uRipple[4+i].y,1e-3),abs(gc-r)))*exp(-age*uRipple[4+i].z);
    }
    float gap=smoothstep(uLatGap,uLatEdge,edge);
    float line=smoothstep(uLatEdge*1.7,uLatEdge,edge)*gap;
    float fill=smoothstep(uLatEdge*1.1,uLatEdge*2.,edge);
    // At grazing angles the cells compress below a pixel; fade them out and let
    // the fresnel rim carry the silhouette instead of letting them shimmer.
    float graze=smoothstep(.03,max(uGrazeFade,.04),ndv);
    float soft=safePow(1.-ndv,2.2);
    latticeVis=(.26+.74*max(soft*graze,nearGround))*graze;
    float bright=(.70+.55*pulse+rip*.9)*cellOn;
    latticeCol=uTileCol*fill*bright*latticeVis*.62
             + uLatEdgeCol*line*bright*latticeVis*.46
             + vec3(.90,1.,.98)*band*(fill*.35+line*.8)*.55*graze;
    // The translucent body under the cells: lit where a cell is on, dim where
    // the lattice has not arrived or has already dissolved.
    alpha*=mix(.28,1.,max(cellOn,soft*graze));
  } else if(uHasReveal==1){
    float key2=uRevealMode==0 ? length(vObj.xy) : (1.-objN.y)*.5;
    alpha*=1.-smoothstep(front-.02,front+.03,key2);
    alpha*=1.+(1.-smoothstep(0.,max(uRevealWidth,1e-3),abs(key2-front)))*.9;
  }
  if(uBand==1){
    // A spherical belt: bright stripes running ALONG it, soft edges ACROSS it,
    // and the far arc dimmed so the strip reads as one ring around the body
    // rather than as two unrelated arcs.
    alpha*=.90+.10*sin(vUv.x*max(uBandStripes,1.)*6.2831853-uTime*2.);
    alpha*=smoothstep(0.,.07,vUv.y)*smoothstep(1.,.93,vUv.y);
    alpha*=gl_FrontFacing ? 1. : .85;
  }

  vec3 col=rampColor(key);
  // material.creases: a second, higher-frequency surface field that darkens
  // narrow folds. A smooth body with no creases reads as plastic; the folds are
  // what make it read as a skin under tension.
  if(uCreaseOn==1){
    float gr=.5+.5*snoise(vec3(vRing*uCrease.x, vAlong*uCrease.x*.185-uTime*.9, 5.3));
    float crease=smoothstep(.44,.30,gr)*smoothstep(uCrease.z,uCrease.z+.09,vAlong);
    col*=mix(1., 1.-clamp(uCrease.y,0.,1.), crease);
  }
  // material.streaks: thin HARD bands on the ramp key. The radiate flag is the
  // difference between rings and speed lines — false runs them round the body,
  // true keys them on the angular coordinate so they run back from the nose,
  // which is what reads as flowing water rather than as a painted barcode.
  if(uStreakOn==1){
    float key_ = uStreakRadiate==1
      ? vRing*uStreakA.x + vAlong*.9
      : vAlong*uStreakA.x;
    float band=fract(key_ - uTime*uStreakA.y + (n-.5)*.10);
    float stripe=smoothstep(uStreakA.z, uStreakA.z*.35, abs(band-.5));
    float seg = uStreakA.w>0.
      ? smoothstep(.34,.58,.5+.5*snoise(vec3(vRing*uStreakA.w*6.2831853, vAlong*.35, uTime*.3)))
      : 1.;
    float fade=smoothstep(uStreakB.y,uStreakB.y+.12,vAlong)
              *(1.-smoothstep(max(uStreakB.z-.40,uStreakB.y),uStreakB.z,vAlong));
    col+=uStreakCol*stripe*seg*fade*uStreakB.x;
  }
  // The ramp carries the translucent body AND the fresnel rim, so it is only
  // dimmed by the lattice's visibility, never multiplied away by it: the rim has
  // to survive exactly where the cells compress below a pixel.
  if(uHasLattice==1) col=col*mix(.35,1.,latticeVis)+latticeCol;
  if(uHasPlaneGlow==1) col+=uPlaneCol*nearGround*uPlaneI;
  if(uBand==1) col*=gl_FrontFacing ? 1. : .42;
  if(uShell==1){
    col*=mix(1.+(n-.5)*.18, 1., smoothstep(.08,.45,vAlong));
    alpha*=(1.-smoothstep(.5,1.,vAlong)*.5);
  }
  col+=uEdgeCol*uEdgeI*rim*(1.-smoothstep(.5,.95,vAlong));
  // kind "reflection": the mirrored copy is washed toward its tint and fades
  // with depth below the plane, so the floor catches a smear and not a twin.
  if(uReflect==1){
    col=mix(col,uReflectTint,.45);
    // vUv.y 0 is the end of the card that meets the plane, so the smear is
    // strongest at the contact and gone by the far end.
    alpha*=uReflectOpacity
          *(1.-smoothstep(0.,max(1.-uReflectBlur,.05),clamp(vUv.y,0.,1.)));
  }
  // One channel per copy: the three masked copies sum back to the original
  // colour at offset 0, so this is a split rather than a tint.
  if(uChannel>=0.)
    col*=uChannel<.5?vec3(1.,0.,0.):(uChannel<1.5?vec3(0.,1.,0.):vec3(0.,0.,1.));
  if(alpha<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,alpha);
  else gl_FragColor=vec4(col*alpha,alpha);
}
`;

// ---------------------------------------------------------------------------
// Ribbons
//
// The strip buffer carries no positions: every vertex is (w along the window,
// side, strand) and the world position is swept here from the document path,
// the live window and the live morph blend. Nothing is rebuilt when the head
// moves, so the same head at the same layer time always draws the same strip.
//
// An orbit path WRAPS (a head past 1 keeps circling), a bezier CLAMPS: a
// thrown arc has two ends, a ring does not. A ribbon whose head runs past 1
// therefore wants a closed orbit — height 0 and a whole number of turns — or
// the wrap point shows as a step.
// ---------------------------------------------------------------------------

export const ribbonVertexV2 = /* glsl */ `
uniform float uTime,uHead,uTail,uWidth,uMorph,uSpread,uWidthJitter,uPhaseJitter;
uniform float uTaperHead,uTaperTail,uOrientPath;
varying float vSide,vW,vStrand,vFade;
${glslNoise}
${glslPath("", "")}
${glslPath("Morph", "M")}
float ribbonHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
/** The two paths blended by ribbon.morph.curve, wrapped or clamped per type. */
vec3 sweep(float u){
  float ua=uPathType==1?clamp(u,0.,1.):fract(u);
  float ub=uMorphPathType==1?clamp(u,0.,1.):fract(u);
  return mix(pathPoint(ua), pathPointM(ub), uMorph);
}
void main(){
  float w=position.x, side=position.y, strand=position.z;
  float hs=ribbonHash(strand*11.7+3.1);
  // Window: only [head - tail, head] of the path is ever drawn, offset per
  // strand so the strands braid instead of overlapping exactly.
  float u=uHead-(1.-w)*uTail+(hs-.5)*uPhaseJitter*uTail;
  vec3 p=sweep(u);
  vec3 tangent=normalize(sweep(u+1e-3)-sweep(u-1e-3)+vec3(0.,0.,1e-6));
  vec3 sd=normalize(cross(tangent,vec3(0.,1.,0.))+vec3(1e-5,0.,0.));
  vec3 upn=normalize(cross(sd,tangent));
  p+=sd*((hs-.5)*uSpread)+upn*((ribbonHash(strand*3.7+9.1)-.5)*uSpread);
  vec4 world=modelMatrix*vec4(p,1.);
  // Taper both ends of the window: a squared-off end reads as a card.
  float fade=smoothstep(0.,max(uTaperTail,1e-4),w)*smoothstep(1.,1.-max(uTaperHead,1e-4),w);
  // ribbon.width is the FULL width of one strand at its fattest.
  float strandW=mix(1.-uWidthJitter,1.,hs);
  float half_=uWidth*.5*strandW*fade;
  vec3 worldTangent=normalize(mat3(modelMatrix)*tangent+vec3(0.,0.,1e-6));
  vec3 view=normalize(cameraPosition-world.xyz);
  vec3 across=uOrientPath>.5
    ? normalize(mat3(modelMatrix)*upn)
    : normalize(cross(worldTangent,view));
  vSide=side; vW=w; vStrand=hs; vFade=fade;
  gl_Position=projectionMatrix*viewMatrix*vec4(world.xyz+across*side*half_,1.);
}
`;

export const ribbonFragmentV2 = /* glsl */ `
precision highp float;
uniform float uTime,uOpacity,uCore;
uniform int uBlendMode;
varying float vSide,vW,vStrand,vFade;
${glslRamp}
void main(){
  if(vFade<=0.) discard;
  // The ramp runs ACROSS the strip: stop t=0 is the core, t=1 the outer edge.
  float q=abs(vSide);
  float core=exp(-q*q*9.), halo=exp(-q*q*1.6);
  float flicker=.85+.15*sin(vW*40.+uTime*6.+vStrand*9.);
  vec3 col=rampColor(q)*(core*1.5*uCore+halo*.30)*flicker;
  float a=vFade*uOpacity*(core*.9+halo*.35);
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

// ---------------------------------------------------------------------------
// Wire bursts
//
// One LineSegments buffer (wire-burst-v2.ts) whose outward travel and scale
// envelope are applied here from layer time, so the buffer is built once and
// the burst is still closed form.
// ---------------------------------------------------------------------------

export const wireBurstVertexV2 = /* glsl */ `
attribute vec3 aDir; attribute float aSeed; attribute float aKind;
uniform float uTime,uLayerU,uTravel,uChannel,uSplitOffset,uSplitGrowth;
varying float vA,vK;
${glslNoise}
${glslCurve("A")}
float burstHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
void main(){
  float h=burstHash(aSeed*1.7+.3);
  float e=clamp(uLayerU,0.,1.);
  // easeOut travel: the burst is fastest on the frame it appears.
  float out1=1.-safePow(1.-e,2.6);
  float travel=mix(.40,1.45,h)*out1*uTravel*mix(1.,${SPOKE_REACH.toFixed(2)},aKind);
  float scale=curveA(e)*mix(.75,1.25,h);
  vec3 p=aDir*travel+position*scale;
  vA=1.-smoothstep(.25,1.,e);
  vK=aKind;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
  if(uChannel>=0.)
    gl_Position.x+=(uChannel-1.)*uSplitOffset*(1.+uSplitGrowth*e)*gl_Position.w;
}
`;

export const wireBurstFragmentV2 = /* glsl */ `
precision highp float;
uniform float uOpacity,uLayerU,uRampKeyMode,uChannel;
uniform int uBlendMode;
varying float vA,vK;
${glslRamp}
void main(){
  // ramp.space "surface" keys the ramp on the population (0 outline, 1 spoke);
  // anything else keys it on the layer's own progress.
  float key=uRampKeyMode>1.5&&uRampKeyMode<2.5 ? vK : clamp(uLayerU,0.,1.);
  vec3 col=rampColor(key);
  // A spoke is a supporting line, not the shape: it draws a quarter dimmer.
  float a=vA*uOpacity*mix(1.,.75,vK);
  if(uChannel>=0.)
    col*=uChannel<.5?vec3(1.,0.,0.):(uChannel<1.5?vec3(0.,1.,0.):vec3(0.,0.,1.));
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

// ---------------------------------------------------------------------------
// Arcs
//
// Helical polylines around the layer's +Y axis, drawn as CAMERA-FACING ribbons:
// the strip carries only (u along the arc, side) and the world path is swept
// here, so the ribbon always presents its width to the camera however the arc
// twists. A 3D tube would go edge-on and vanish; this cannot.
//
// The whole arc — radius, pitch, base height, length and phase — is re-hashed on
// its own BLINK INDEX k = floor((layerTime - offset)/period), so no two flashes
// of the same arc trace the same wire and nothing accumulates: a seek lands
// inside exactly the blink playback was in.
// ---------------------------------------------------------------------------

export const arcVertexV2 = /* glsl */ `
attribute float aSeed;
uniform float uTime,uHeight,uWidthK,uSpan,uWidth,uMinWidth;
uniform float uJitterAmp,uJitterFreq,uJitterFold,uSkip;
uniform vec2 uRadius,uPitch,uPeriod,uOnTime;
varying vec2 vUv; varying float vA;
${glslNoise}
float arcHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
/** fbm folded toward corners: |n| kinks the wire instead of curling it. */
float arcNoise(float a, float b){
  float n=fbm3(vec3(a,b,1.7));
  return mix(n, abs(n)*2.-1., clamp(uJitterFold,0.,1.));
}
/** One blink's worth of helix, in the layer's own space. */
vec3 arcPoint(float u, float s, float k){
  float r  = mix(uRadius.x,uRadius.y,arcHash(s*3.11+k*1.7))*uWidthK;
  float pv = mix(uPitch.x,uPitch.y,arcHash(s*7.73+k*2.3));
  float y0 = arcHash(s*5.31+k*3.1)*uSpan*.74;
  float ln = uSpan*(.18+.37*arcHash(s*11.1+k*.7));
  float ph = arcHash(s*13.7+k*4.9)*6.2831853;
  float y  = (y0+u*ln)*uHeight;
  float a  = ph+u*pv*6.2831853;
  float j1 = arcNoise(u*uJitterFreq, s*3.1+k*.31);
  float j2 = arcNoise(u*uJitterFreq*2.4+7., s*5.7+k*.73);
  float j3 = fbm3(vec3(u*uJitterFreq*4.2+3., s*7.9+k*1.13, .9))*.5;
  r *= 1.+uJitterAmp*(.70*j1+.22*j3);
  a += uJitterAmp*(1.45*j2+.40*j3);
  return vec3(cos(a)*r, y, sin(a)*r);
}
void main(){
  float s=aSeed, u=position.x, side=position.y;
  // Per-arc stepped window: lit for onTime out of period, and some cycles are
  // skipped outright, so the set never settles into a rhythm.
  float per=mix(uPeriod.x,uPeriod.y,arcHash(s*1.71));
  float onT=mix(uOnTime.x,uOnTime.y,arcHash(s*2.93));
  float off=arcHash(s*4.37)*per;
  float k=floor((uTime-off)/max(per,1e-4));
  float loc=(uTime-off)-k*max(per,1e-4);
  float live=step(loc,onT)*step(uSkip,arcHash(k*1.373+s*9.11));
  float w=sin(3.14159265*clamp(loc/max(onT,1e-4),0.,1.));
  vA=live*w*(.55+.45*arcHash(k*2.11+s*5.5));
  vUv=vec2(u,side*.5+.5);
  vec3 a3=arcPoint(u,s,k);
  vec3 b3=arcPoint(min(u+.035,1.)+(u>.965?-.070:0.),s,k);
  vec4 mv=modelViewMatrix*vec4(a3,1.);
  vec4 mb=modelViewMatrix*vec4(b3,1.);
  vec2 d=mb.xy-mv.xy;
  vec2 pp=length(d)>1e-5 ? normalize(vec2(-d.y,d.x)) : vec2(1.,0.);
  // A minimum width in SCREEN space: an arc thinner than a pixel shimmers into
  // nothing at depth, which reads as a renderer fault rather than as lightning.
  float wid=max(uWidth*.5*(.55+.45*sin(3.14159265*u)), -mv.z*uMinWidth);
  mv.xy+=pp*side*wid;
  gl_Position=projectionMatrix*mv;
}
`;

export const arcFragmentV2 = /* glsl */ `
precision highp float;
uniform vec3 uCore,uHalo;
uniform float uOpacity,uFlicker;
uniform int uBlendMode;
varying vec2 vUv; varying float vA;
void main(){
  if(vA<=0.) discard;
  float y=abs(vUv.y-.5)*2.;
  float core=1.-smoothstep(.10,.55,y);    // the white-blue filament
  float halo=1.-smoothstep(.30,1.00,y);   // a thin sheath around it
  float ends=smoothstep(0.,.06,vUv.x)*(1.-smoothstep(.94,1.,vUv.x));
  vec3 c=uCore*core*1.85+uHalo*halo*.75;
  float a=vA*ends*uOpacity*uFlicker;
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(c,a);
  else gl_FragColor=vec4(c*a,a);
}
`;

// ---------------------------------------------------------------------------
// Streak bursts
//
// Long thin quads leaving the layer origin in SCREEN space: the radial speed
// lines of an eruption. Screen space, not world, because a burst read from a
// three-quarter camera has to fan across the FRAME — a world-space fan collapses
// to a line the moment the camera is not square to it.
//
// The fan clumps into `bundles` headings; an even fan reads as a lens star.
// ---------------------------------------------------------------------------

export const streakVertexV2 = /* glsl */ `
attribute float aSeed;
uniform float uGrow,uCurvature,uUpBias,uBundles,uBundleSpread,uStagger;
uniform vec2 uLength,uWidth;
uniform vec3 uHueA,uHueB,uHueC;
varying vec2 vUv; varying float vK; varying vec3 vC;
float stHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
void main(){
  float s=aSeed;
  vUv=vec2(position.x,position.y*.5+.5);
  float n=max(uBundles,1.);
  float bi=floor(stHash(s*.771)*n);
  float bth=(bi+.65*stHash(bi*4.73+.9))/n*6.2831853;
  float bsp=uBundleSpread*(.30+.70*stHash(bi*9.11+2.3));
  float th=bth+(stHash(s*1.13)-.5)*bsp;
  vec2 d=vec2(cos(th),sin(th));
  d.y=d.y*(1.-abs(uUpBias)*.22)+uUpBias;   // the burst leans up (or down)
  d=normalize(d+vec2(1e-5,0.));
  vec2 pp=vec2(-d.y,d.x);
  float hue=stHash(s*17.1);
  float L=mix(uLength.x,uLength.y,pow(max(stHash(s*3.31),1e-5),1.5));
  float W=mix(uWidth.x,uWidth.y,stHash(s*5.17));
  float cv=sign(stHash(s*7.91)-.5)*uCurvature*(.3+.7*stHash(s*37.3));
  // Not every streak leaves at once: each lags the envelope by its own share.
  float stag=stHash(s*11.3)*uStagger;
  float g=clamp((uGrow-stag)/max(1.-stag,1e-3),0.,1.);
  g=1.-pow(max(1.-g,1e-5),3.);
  float x=position.x*L*g;
  vec2 root=vec2((stHash(s*23.1)-.5)*L*.05,(stHash(s*29.7)-.5)*L*.16);
  vec2 off=root+d*x+pp*(cv*x*x*.42/max(L,1e-3))+pp*position.y*W;
  vec4 mv=modelViewMatrix*vec4(0.,0.,0.,1.);
  mv.xy+=off;
  vK=.55+.45*stHash(s*13.7);
  vC=hue>.84 ? uHueB : (hue>.58 ? uHueC : uHueA);
  gl_Position=projectionMatrix*mv;
}
`;

export const streakFragmentV2 = /* glsl */ `
precision highp float;
uniform float uOpacity,uFlicker;
uniform int uBlendMode;
varying vec2 vUv; varying float vK; varying vec3 vC;
void main(){
  float x=vUv.x;
  // A needle, not a wedge: full width at the root, tapering only near the tip.
  float wid=(1.-smoothstep(.10,1.,x))+.12;
  float y=abs(vUv.y-.5)*2./max(wid,1e-3);
  float a=exp(-y*y*3.2);
  a*=smoothstep(0.,.012,x)*(1.-smoothstep(.22,1.,x));
  // A speed line is a thin needle a few pixels wide: without a headroom factor
  // the additive coverage is too small to read against a lit flare, however
  // bright its hue is authored.
  a*=vK*uOpacity*uFlicker*2.;
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(vC,a);
  else gl_FragColor=vec4(vC*a,a);
}
`;

// ---------------------------------------------------------------------------
// Blob lobes
//
// One lobe is an icosphere whose RADIUS is a function of the surface direction:
// unit sphere x (1 + amplitude * positive-biased fbm). That makes cauliflower
// bumps instead of the smooth wobble `geometry.vertexNoise` produces, and it
// needs its own normal, because the analytic derivative of an fbm chain is not
// worth writing: two finite differences along the tangent plane give it in
// three extra evaluations.
//
// After the radius field the lobe is optionally deformed into a comma (taper
// one end to a tail, bend the result around z, then turn the tail outward) and
// squashed vertically. The outline pass runs the identical vertex program with
// uInflate > 0 and back faces, so the hull tracks every bump.
// ---------------------------------------------------------------------------

/** Shared by the fill pass and the inverted hull: the lobe's own shape. */
/* Every lobe of a layer is one instance of a shared draw: the lobe's own shape,
 * placement and shading ride as instance attributes, so a cluster of ninety
 * lobes costs one program and two draws rather than ninety materials.
 *   aLobeA (seed, amplitude, frequency, squash)
 *   aLobeB (curl, taper, rotation, unused)
 *   aLobeC (lobe age, shade, alpha, unused)   -- read by the fragment too
 *   aLobeP (centre in layer space, radius)
 */
const glslLobeShape = /* glsl */ `
uniform float uTime,uNoiseSpeed;
attribute vec4 aLobeA, aLobeB, aLobeC, aLobeP;
float lobeR(vec3 n){
  vec3 q=n*aLobeA.z+vec3(aLobeA.x*7.3,aLobeA.x*3.1-uTime*uNoiseSpeed,aLobeA.x*11.7);
  float f=.6*snoise(q)+.3*snoise(q*2.1+5.)+.15*snoise(q*4.3+11.);
  // Positive bias: bumps push OUT of the sphere, they never dent it inward.
  return 1.+aLobeA.y*(.45*f+.55*abs(f));
}
vec3 lobeP(vec3 n){
  vec3 p=n*lobeR(n);
  float s=clamp(p.y*.5+.5,0.,1.);
  p.xz*=mix(1.,1.-aLobeB.y,smoothstep(.2,1.,s));
  float a=aLobeB.x*p.y;
  p.xy=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xy;
  p.xy=mat2(cos(aLobeB.z),-sin(aLobeB.z),sin(aLobeB.z),cos(aLobeB.z))*p.xy;
  p.y*=aLobeA.w;
  return p;
}
`;

export const blobVertexV2 = /* glsl */ `
varying vec3 vN,vV,vWp;
varying vec3 vLobe;
${glslNoise}
${glslLobeShape}
void main(){
  vLobe=aLobeC.xyz;
  vec3 n=safeDir(position, vec3(0.,1.,0.));
  vec3 p=lobeP(n);
  // Finite-difference normal in the tangent plane of the unit sphere.
  vec3 up=abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.);
  vec3 t1=safeDir(cross(n,up), vec3(1.,0.,0.));
  vec3 t2=safeDir(cross(n,t1), vec3(0.,0.,1.));
  float e=.055;
  vec3 nrm=safeDir(cross(lobeP(safeDir(n+t1*e,n))-p, lobeP(safeDir(n+t2*e,n))-p), n);
  if(dot(nrm,n)<0.) nrm=-nrm;
  // aLobeB.w inflates the outline hull in the lobe's own unit space.
  p+=nrm*aLobeB.w;
  // The lobe's own placement, uniform in scale so the normal survives it.
  p=p*aLobeP.w+aLobeP.xyz;
  vec4 wp=modelMatrix*vec4(p,1.);
  vWp=wp.xyz;
  vN=safeDir(mat3(modelMatrix)*nrm, vec3(0.,1.,0.));
  vV=safeDir(cameraPosition-wp.xyz, vec3(0.,0.,1.));
  gl_Position=projectionMatrix*viewMatrix*wp;
}
`;

export const blobFragmentV2 = /* glsl */ `
precision highp float;
varying vec3 vN,vV,vWp;
varying vec3 vLobe;
uniform vec3 uShadow,uBody,uHigh,uRimCol,uLight;
uniform float uBands,uBandA,uBandB,uRimPow,uRimAmt,uFlat;
uniform float uRampKeyMode,uLayerU,uGroundY,uHeightSpan,uUseToon;
// material.toon.colorSource "ramp": the BODY band's colour comes from
// material.ramp evaluated in the ramp's own space, and the other two bands are
// derived from it, so the cluster still posterises while its base colour grades.
uniform float uToonRamp,uToonShadowScale,uToonHighMix,uRampBlendMode,uRampBlendWeight;
// blob.lightFrom: a fake POINT light the lobes are shaded toward instead of the
// parallel world light material.toon carries, plus the far/near brightness bias
// an "orbit" ring applies to whichever half is currently behind the centre.
uniform float uLightOn,uLightFall;
uniform vec3 uLightPos;
uniform int uBlendMode;
${glslRamp}
vec3 safeDirLocal(vec3 v){ float l=length(v); return l>1e-5 ? v/l : vec3(0.,1.,0.); }
/**
 * The lobe's ramp key: world height over uHeightSpan (3), the layer's own
 * progress (1), or the lobe's own 0..1 age — the only scalar a generated lobe
 * has, which is what "life" and "surface" both fall back to. material.ramp.blend
 * mixes a second space into it.
 */
float lobeRampKey(float mode){
  return mode>2.5
    ? clamp((vWp.y-uGroundY)/max(uHeightSpan,1e-3),0.,1.)
    : (mode>0.5 && mode<1.5 ? clamp(uLayerU,0.,1.) : clamp(vLobe.x,0.,1.));
}
float lobeRampKeyBlended(){
  float key=lobeRampKey(uRampKeyMode);
  if(uRampBlendWeight>0.) key=mix(key,lobeRampKey(uRampBlendMode),uRampBlendWeight);
  return key;
}
void main(){
  // The outline hull draws flat and unlit whatever else is set.
  if(uFlat>.5){ gl_FragColor=vec4(uShadow*vLobe.y*vLobe.z,vLobe.z); return; }
  vec3 c;
  if(uUseToon>.5){
    vec3 N=safeDirLocal(vN);
    // Half lambert against the document's FIXED toon light, posterised.
    // A point light is a direction per lobe, not per document, and it falls
    // off: that is what makes a ring of lobes read as lit by the core it
    // circles rather than by the sun.
    vec3 L=safeDirLocal(uLight);
    float fall=1.;
    if(uLightOn>.5){
      vec3 toLight=uLightPos-vWp;
      float dist=length(toLight);
      L=safeDirLocal(toLight);
      fall=1./(1.+uLightFall*dist*uLightFall*dist);
    }
    float ndl=dot(N,L)*.5+.5;
    // colorSource "ramp": the three fixed hexes become one continuous body
    // colour plus two derived neighbours. The BANDING is unchanged — the same
    // two thresholds on the same half-lambert — so a cluster that should read
    // cel-shaded still does; only the constant is gone.
    vec3 body=uBody, shadow=uShadow, high=uHigh;
    if(uToonRamp>.5){
      body=rampColor(lobeRampKeyBlended());
      shadow=mix(body*uToonShadowScale, uShadow, .25);
      high=mix(body, uHigh, uToonHighMix);
    }
    c = uBands>2.5
      ? (ndl<uBandA ? shadow : (ndl<uBandB ? body : high))
      : (ndl<uBandA ? shadow : high);
    c+=uRimCol*pow(max(1.-clamp(dot(N,safeDirLocal(vV)),0.,1.),1e-4),uRimPow)*uRimAmt;
    c*=mix(1.,fall,step(.5,uLightOn));
  } else {
    // No toon: the ramp is the colour source, keyed the usual way.
    c=rampColor(lobeRampKeyBlended());
  }
  c*=vLobe.y;
  if(uBlendMode==1) gl_FragColor=vec4(c,vLobe.z);
  else gl_FragColor=vec4(c*vLobe.z,vLobe.z);
}
`;

// ---------------------------------------------------------------------------
// Crystal spikes
//
// One instanced draw. The shared mesh (crystals-v2.ts) is a unit hex prism that
// narrows into a pyramid, built non-indexed so every face is flat; each
// instance carries its direction, base, length, width, start time and seed, and
// the vertex program builds the instance frame from the direction, scales the
// mesh along it with easeOutBack and collapses it at the shatter.
//
// The outline pass runs the IDENTICAL program with uInflate > 0 and back faces,
// so the dark separator hull tracks the facets rather than a smooth cone.
// ---------------------------------------------------------------------------

const glslCrystalShape = /* glsl */ `
attribute vec3 aDir,aOrg; attribute float aLen,aWid,aT0,aSeed,aAlong;
uniform float uTime,uSpan,uGrowDur,uOvershoot,uInflate;
uniform float uHasCollapse,uCollapseStart,uCollapseDur;
varying vec3 vN,vW; varying float vAlong,vSeed;
`;

export const crystalVertexV2 = /* glsl */ `
${glslNoise}
${glslCrystalShape}
void main(){
  float born=aT0*uSpan;
  // easeOutBack: the spike overshoots its length and settles.
  float u=clamp((uTime-born)/max(uGrowDur,1e-4),0.,1.);
  float s=u>=1. ? 1. : u*u*((uOvershoot+1.)*u-uOvershoot);
  s=max(s,0.);
  if(uHasCollapse>.5){
    float from=uCollapseStart*uSpan+aSeed*uCollapseDur*1.125;
    s*=1.-smoothstep(from,from+max(uCollapseDur,1e-4),uTime);
  }
  // A slow breath during the hold keeps the silhouette alive at rest.
  s*=1.+.035*sin(uTime*2.1+aSeed*6.2831853);

  vec3 up=safeDir(aDir, vec3(0.,1.,0.));
  vec3 ref=abs(up.y)>.95 ? vec3(1.,0.,0.) : vec3(0.,1.,0.);
  vec3 rt=safeDir(cross(ref,up), vec3(1.,0.,0.));
  vec3 fw=cross(up,rt);
  // Per-instance twist, so neighbouring spikes never share a facet layout.
  float tw=aSeed*6.2831853, ct=cos(tw), st=sin(tw);
  vec2 pxz=vec2(position.x*ct-position.z*st, position.x*st+position.z*ct);
  vec2 nxz=vec2(normal.x*ct-normal.z*st, normal.x*st+normal.z*ct);

  float L=aLen*s, W=aWid*(.35+.65*s);
  vec3 lp=vec3(pxz.x*W, position.y*L, pxz.y*W);
  // The hull is pushed out in the spike's own frame, scaled with its growth so
  // the line weight stays constant in world metres.
  lp+=safeDir(vec3(pxz.x, position.y*.25, pxz.y), vec3(0.,1.,0.))*uInflate*(.6+.4*s);
  vec3 wp=aOrg+rt*lp.x+up*lp.y+fw*lp.z;
  vec3 ln=safeDir(vec3(nxz.x*L, normal.y*W, nxz.y*L), vec3(0.,1.,0.));
  vN=safeDir(rt*ln.x+up*ln.y+fw*ln.z, up);
  vec4 world=modelMatrix*vec4(wp,1.);
  vW=world.xyz;
  vAlong=aAlong; vSeed=aSeed;
  gl_Position=projectionMatrix*viewMatrix*world;
}
`;

export const crystalFragmentV2 = /* glsl */ `
precision highp float;
${glslNoise}
varying vec3 vN,vW; varying float vAlong,vSeed;
uniform vec3 uTip,uFace,uEdge,uCam;
uniform float uFresPow,uGlintFreq,uGlintSpeed,uOpacity,uFlat,uTime;
uniform int uBlendMode;
void main(){
  // The outline hull draws flat and unlit, dark at the base and cooler at the
  // tip: a separator between overlapping spikes, never a second rim light.
  if(uFlat>.5){
    vec3 c=mix(uEdge*.16,uEdge*.55,smoothstep(.05,.85,vAlong));
    gl_FragColor=vec4(c*uOpacity,uOpacity);
    return;
  }
  vec3 n=safeDir(vN, vec3(0.,1.,0.));
  vec3 v=safeDir(uCam-vW, vec3(0.,0.,1.));
  float ndv=abs(dot(n,v));
  float fres=safePow(1.-ndv,uFresPow);
  // A cool ambient wrap: an unlit facet still reads pale, never black.
  float lam=.42+.58*clamp(dot(n,normalize(vec3(.25,.9,.4)))*.5+.5,0.,1.);
  vec3 col=uFace*(.30+.50*lam);
  // Tips run vivid, the mid body stays pale, the base stays near white; the
  // tip is darkened as it saturates so ACES does not wash it back out.
  float tip=smoothstep(.18,.92,vAlong);
  col=mix(col,uTip*1.30,tip*.94);
  col*=mix(1.,.55,tip);
  col=mix(col,uEdge,fres*.30*(1.-tip*.55));
  // A narrow specular band sliding along the axis.
  float gb=sin((vAlong*uGlintFreq-uTime*uGlintSpeed+vSeed*6.2831853)*3.14159265);
  col+=uEdge*safePow(max(gb,0.),22.)*(.35+.65*fres)*.9;
  // Internal fracture grain, plus a per-instance brightness so no two spikes
  // catch the light identically.
  float ice=.5+.5*fbm3(vec3(vAlong*9.+vSeed*17., vSeed*31.+vW.y*4., 1.7));
  col*=(.88+.26*ice)*(.72+.56*fract(vSeed*13.7+2.1));
  col+=uTip*safePow(1.-ndv,3.)*.60;
  float a=clamp(.80+fres*.20,0.,1.)*uOpacity;
  if(a<.002) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

// ---------------------------------------------------------------------------
// Splash slivers — flat, unlit, camera facing. The quad is rebuilt on the
// view's right/up axes around the layer origin (the same trick the sprite kind
// uses), so the fan reads as a graphic accent from any camera angle.
// ---------------------------------------------------------------------------

export const splashVertexV2 = /* glsl */ `
uniform vec2 uSliverScale;
uniform vec3 uSliverOffset;
uniform float uSliverRoll;
varying vec2 vUv;
void main(){
  vUv=uv;
  vec3 centre=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
  vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
  vec3 up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  vec3 fwd=cross(right,up);
  vec2 q=vec2(position.x*uSliverScale.x, position.y*uSliverScale.y);
  float c=cos(uSliverRoll), s=sin(uSliverRoll);
  q=vec2(q.x*c-q.y*s, q.x*s+q.y*c);
  vec2 o=vec2(uSliverOffset.x, uSliverOffset.y);
  vec3 world=centre+right*(q.x+o.x)+up*(q.y+o.y)+fwd*uSliverOffset.z;
  gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
}
`;

export const splashFragmentV2 = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uCol,uDark;
uniform float uOpacity;
uniform int uBlendMode;
void main(){
  // No uShade here: a sliver's backing and body colours are already darkened on
  // the CPU when the pair is built, and this program has never carried the
  // blob's orbit brightness uniform. Multiplying by it was a paste from
  // blobFragmentV2 that left the program unlinkable, so every splash layer's
  // draw was silently skipped.
  vec3 c=mix(uDark,uCol,smoothstep(.0,.55,vUv.y));
  if(uBlendMode==1) gl_FragColor=vec4(c,uOpacity);
  else gl_FragColor=vec4(c*uOpacity,uOpacity);
}
`;

// ---------------------------------------------------------------------------
// Sheets — curved, tapered, OPAQUE membranes.
//
// Cel shading against a FIXED world light (material.toon), two bands and a rim,
// with a low-frequency noise threshold eating the border so the crescent
// silhouette is ragged rather than cut with scissors. DoubleSide and depth
// writing: sheets intersect each other for real, which is the whole reason the
// tail of a water projectile is mesh and not particles.
// ---------------------------------------------------------------------------

export const sheetVertexV2 = /* glsl */ `
attribute float aSheetSeed;
// How far through its own life this sheet is. Per SHEET, not per layer: the
// membranes are born on staggered cadences, so a young one has barely started
// to come apart while an old one is nearly eaten. It rides on the geometry so
// that every sheet of a layer can still share one material.
attribute float aSheetAge;
varying vec3 vN,vW; varying vec2 vUv; varying float vSeed,vAge;
void main(){
  vSeed=aSheetSeed;
  vAge=aSheetAge;
  vUv=uv;
  vec4 wp=modelMatrix*vec4(position,1.);
  vN=normalize(mat3(modelMatrix)*normal);
  vW=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}
`;

export const sheetFragmentV2 = /* glsl */ `
precision highp float;
varying vec3 vN,vW; varying vec2 vUv; varying float vSeed,vAge;
uniform vec3 uShadow,uBody,uHigh,uRim,uLight,uCam;
uniform vec2 uBands;
uniform float uRimPow,uRimAmt,uOpacity,uTear,uTearScale,uBandCount;
uniform int uBlendMode;
${glslNoise}
void main(){
  // The torn edge: a low-frequency field raises the border threshold, so the
  // membrane is eaten unevenly instead of ending on a straight cut.
  // The border eats a little more as the sheet ages, so a membrane comes
  // apart rather than simply shrinking.
  if(uTear>0.){
    float tear=uTear*(.7+.6*vAge);
    float fld=.5+.5*snoise(vec3(vUv.x*uTearScale, vUv.y*uTearScale*.65, vSeed));
    float edge=min(min(vUv.x,1.-vUv.x)*2.2, min(vUv.y,1.-vUv.y)*1.5);
    if(edge+fld*.55 < tear) discard;
  }
  vec3 N=normalize(vN);
  if(!gl_FrontFacing) N=-N;
  float ndl=dot(N,normalize(uLight))*.5+.5;
  vec3 c = uBandCount>2.5
    ? (ndl<uBands.x ? uShadow : (ndl<uBands.y ? uBody : uHigh))
    : (ndl<uBands.x ? uShadow : uHigh);
  vec3 V=normalize(uCam-vW);
  float rim=pow(max(1.-clamp(dot(N,V),0.,1.),1e-4),uRimPow);
  c+=uRim*rim*uRimAmt;
  if(uBlendMode==1) gl_FragColor=vec4(c,uOpacity);
  else gl_FragColor=vec4(c*uOpacity,uOpacity);
}
`;

// ---------------------------------------------------------------------------
// Crescent — the arc-window blade.
//
// aS runs along the arc and aQ across it (0 = outer edge, 1 = inner). Only the
// window [uTail, uHead] is drawn; the thickness profile peaks a little behind
// the LIVE tip, so the leading edge is a razor and the body is fat. Everything
// is swept here, so a track on the radius or the sweep re-shapes the blade with
// nothing rebuilt.
//
// The tail does not fade, it is EATEN: Voronoi cells behind the front are
// removed, which is what breaks the trailing end into tongues.
// ---------------------------------------------------------------------------

const glslVoronoi = /* glsl */ `
float vorHash11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float vorHash21(vec2 p){ return vorHash11(dot(p, vec2(127.1,311.7))); }
float vorNoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=vorHash21(i), b=vorHash21(i+vec2(1.,0.));
  float c=vorHash21(i+vec2(0.,1.)), d=vorHash21(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float vorFbm(vec2 p){ return .55*vorNoise(p)+.28*vorNoise(p*2.07+11.3)+.17*vorNoise(p*4.11+5.7); }
/* x = cell id 0..1, y = distance to the nearest cell EDGE. */
vec2 voronoi2(vec2 p){
  vec2 ip=floor(p), fp=fract(p);
  float d1=8., d2=8., id=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 o=vec2(vorHash21(ip+g), vorHash21(ip+g+vec2(37.7,11.3)));
    vec2 r=g+o-fp;
    float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=vorHash21(ip+g+vec2(7.1,3.9)); }
    else if(d<d2) d2=d;
  }
  return vec2(id, sqrt(d2)-sqrt(d1));
}
`;

export const crescentVertexV2 = /* glsl */ `
attribute float aS; attribute float aQ;
uniform vec3 uEx,uEy,uN;
uniform float uR,uPh0,uSweep,uWmax,uHead,uTail,uScale,uRadOff,uWiden,uTime,uSeed;
uniform float uPeakFrom,uTipPower,uRootFade,uScreenSpace;
varying float vS,vQ,vWin,vTipD;
${glslVoronoi}
float crescentWidth(float s){
  float dt=uHead-s;                                    // behind the LIVE tip
  float rise=pow(max(smoothstep(0.,uPeakFrom*.9,dt),1e-4),uTipPower);
  float fall=1.-smoothstep(uPeakFrom,uPeakFrom*2.6,dt);
  float root=pow(max(smoothstep(0.,uRootFade,s-uTail),1e-4),.8);
  return uWmax*rise*(.14+.86*fall)*root;
}
void main(){
  float ph=uPh0+aS*uSweep;
  vec3 rad=uEx*cos(ph)+uEy*sin(ph);
  float w=crescentWidth(aS)*uScale;
  // The strip widens and flutters as the tear-away grows: a blade coming apart
  // swells before it breaks, and a constant width reads as a solid ribbon.
  float flut=vorFbm(vec2(aS*7.-uTime*1.1,uSeed))-.5;
  w*=1.+uWiden*(.55+1.5*flut)+.14*flut;
  vec3 ctr=(modelMatrix*vec4(rad*uR,1.)).xyz;
  vec3 tang=normalize(mat3(modelMatrix)*normalize(-uEx*sin(ph)+uEy*cos(ph)));
  vec3 nrm=normalize(mat3(modelMatrix)*uN);
  vec3 across;
  if(uScreenSpace>.5){
    // The across axis is built from the camera, so the blade never goes
    // edge-on however the arc plane is leaning.
    vec3 view=normalize(cameraPosition-ctr);
    across=normalize(cross(tang,view));
    vec3 wr=normalize(mat3(modelMatrix)*rad);
    across*=sign(dot(across,wr));                      // +across = the OUTER side
  } else {
    across=normalize(mat3(modelMatrix)*rad);
  }
  float off=(.5-aQ)*w+uRadOff;
  vec3 p=ctr+across*off;
  // A short fade band at both ends of the window, so nothing pops in.
  vWin=smoothstep(uTail,uTail+.035,aS)*(1.-smoothstep(uHead-.012,uHead,aS));
  vS=aS; vQ=aQ; vTipD=clamp((uHead-aS)/max(uPeakFrom*.75,1e-3),0.,1.);
  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
}
`;

export const crescentFragmentV2 = /* glsl */ `
precision highp float;
varying float vS,vQ,vWin,vTipD;
uniform vec3 uC0,uC1,uC2,uC3,uStreakCol;
uniform vec4 uI;                       // per-band intensities
uniform float uTime,uSeed,uAlpha,uHead,uTail,uTear,uErode,uTipHot;
uniform float uStreakOn,uStreakFreq,uStreakPan,uStreakI,uStreakSeg;
uniform float uVorScale,uSeamWidth,uFrontWidth;
uniform vec4 uBandT;                   // the four ramp stop positions
uniform int uBlendMode;
${glslVoronoi}
vec3 bandColor(float q){
  vec3 c=uC0*uI.x;
  c=mix(c,uC1*uI.y,smoothstep(uBandT.x,uBandT.y,q));
  c=mix(c,uC2*uI.z,smoothstep(uBandT.y,uBandT.z,q));
  c=mix(c,uC3*uI.w,smoothstep(uBandT.z,uBandT.w,q));
  return c;
}
void main(){
  if(vWin<=.001) discard;
  // Flow streaks running ALONG the blade, panning toward the tail. The Voronoi
  // seams are what make them read as torn sheets of flame rather than as an
  // airbrushed gradient.
  vec2 cell=voronoi2(vec2(vS*uVorScale+uTime*uStreakPan, vQ*uVorScale*.6+uSeed*3.1));
  float streak=1.;
  if(uStreakOn>.5){
    float lines=mix(.60,1.45,vorFbm(vec2(vS*uStreakFreq*3.3+uTime*uStreakPan*1.6, vQ*7.+uSeed)));
    float seam=1.-smoothstep(0.,max(uSeamWidth,1e-3),cell.y);
    streak=lines*(.72+.60*cell.x)+.35*seam*uStreakSeg;
    streak=mix(1.,streak,clamp(uStreakI,0.,1.));
  }
  // The erosion FRONT: cells behind it are eaten, so the tail breaks into
  // tongues instead of dimming. The front's reach is measured from the tail.
  float front=clamp((vS-uTail)/max(.10,uFrontWidth),0.,1.);
  float th=uErode+uTear*(1.-front);
  float n=.42*cell.x+.58*vorFbm(vec2(vS*uVorScale+uSeed*5., vQ*2.1-uTime*.6));
  float a=smoothstep(th,th+.16,n);
  float edge=smoothstep(th-.02,th+.09,n)*(1.-smoothstep(th+.09,th+.26,n));
  float tip=pow(max(1.-vTipD,1e-4),2.4);
  vec3 col=bandColor(vQ)*streak;
  col+=uC0*tip*uTipHot;
  col+=uStreakCol*edge*uStreakI;
  float al=a*vWin*uAlpha*(.86+.14*(1.-vQ))*(.78+.35*streak);
  al=clamp(al,0.,1.);
  if(al<.003) discard;
  if(uBlendMode==1) gl_FragColor=vec4(col,al);
  else gl_FragColor=vec4(col*al,al);
}
`;

// ---------------------------------------------------------------------------
// Licks — flat cel flame strips peeling off a crescent's erosion front.
//
// The shape is re-hashed on floor(layerTime * flipbookHz), so the set JUMPS
// rather than slides; two flat colour bands and no gradient, because a gradient
// is exactly what stops a lick reading as drawn.
// ---------------------------------------------------------------------------

export const lickVertexV2 = /* glsl */ `
attribute float aSeed, aSide;
uniform vec3 uAnchor,uTangent,uNormal,uDrift;
uniform vec2 uLength,uWidth,uStagger,uLife;
uniform float uTime,uSpan,uCurl,uFlipHz;
varying float vS,vA;
float lickHash(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
void main(){
  float u=position.x, v=position.y;
  float h1=lickHash(aSeed*2.3+.4), h2=lickHash(aSeed*4.9+6.6);
  // The flipbook: the shape holds for 1/flipbookHz of a second and then jumps.
  float k=floor(uTime*max(uFlipHz,1e-3))+aSeed;
  float L=mix(uLength.x,uLength.y,lickHash(k*1.31));
  float W=mix(uWidth.x,uWidth.y,lickHash(k*3.77+2.1));
  float birth=mix(uStagger.x,uStagger.y,h1)*uSpan;
  float life=mix(uLife.x,uLife.y,h2);
  float age=uTime-birth;
  float a01=clamp(age/max(life,1e-4),0.,1.);
  float alive=step(0.,age)*step(a01,.999);
  vA=alive*sin(3.14159265*pow(max(a01,1e-4),.7));
  vS=u;
  // Screen-aligned: the strip lies in the view plane, trailing back along the
  // arc and leaning up, which is what a peeling lick does.
  vec3 R=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
  vec3 Up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  vec3 base=uAnchor+uNormal*(h1-.5)*.10+uDrift*age;
  vec2 dir=normalize(vec2(dot(-uTangent,R),dot(-uTangent,Up))+vec2(0.,.55)+vec2(1e-4));
  vec2 pr=vec2(-dir.y,dir.x);
  float w=W*.5*pow(max(u+.06,1e-4),.30)*pow(max(1.-u,1e-4),.85);
  float curl=uCurl*sin(u*3.+h1*6.2831853)*u*aSide;
  vec2 q=dir*(u*L*(.45+.85*a01))+pr*(aSide*.045+curl+v*w);
  vec3 wp=base+(R*q.x+Up*q.y)*alive;
  gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);
}
`;

export const lickFragmentV2 = /* glsl */ `
precision highp float;
varying float vS,vA;
uniform vec3 uHot,uBody;
uniform float uOpacity;
uniform int uBlendMode;
void main(){
  float a=vA*uOpacity;
  if(a<=.004) discard;
  // Two flat bands: cel, not gradient.
  vec3 col = vS<.42 ? uHot : uBody;
  if(uBlendMode==1) gl_FragColor=vec4(col,a);
  else gl_FragColor=vec4(col*a,a);
}
`;

// ---------------------------------------------------------------------------
// Uniform builders
// ---------------------------------------------------------------------------

export { rampUniforms, writeRamp, curveUniforms, writeCurve } from "./uniforms-v2";
