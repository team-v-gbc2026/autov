/** TSL inline Fn graphs do not support early returns. Keep a single return for
 * uniform-dependent helpers, with explicit branches matching the GLSL contract.
 * Pure functions can retain native WGSL function layouts.
 */
export function lowerReturns(source) {
  const replaceBody = (name, body) => {
    const match = new RegExp(
      "\\b(?:float|vec3) " + name + "\\([^)]*\\)\\s*\\{",
    ).exec(source);
    if (!match) return;
    const start = match.index + match[0].length;
    let end = start,
      depth = 1;
    while (depth) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
      end++;
    }
    source = source.slice(0, start) + body + source.slice(end - 1);
  };
  for (const [p, P] of [
    ["self", ""],
    ["parent", "Parent"],
  ]) {
    replaceBody(
      p + "Birth",
      `
      float instance=s.x, birth=instance*u${P}SpawnWindow;
      float result=birth;
      if(u${P}SpawnMode==1){
        float cycle=floor((t-birth)/max(u${P}Period,1e-4));
        float absBirth=birth+cycle*u${P}Period;
        result=(absBirth<0. || absBirth>u${P}SpawnDuration)?1e9:absBirth;
      } else if(u${P}SpawnMode==2){
        float t0=u${P}BurstT[0];
        for(int i=0;i<8;i++){if(i>=u${P}BurstN)break;if(instance<=u${P}BurstC[i]){t0=u${P}BurstT[i];break;}}
        result=t0+fract(instance*7.13+.37)*u${P}SpawnWindow;
      }
      return result;
    `,
    );
    replaceBody(
      p + "Origin",
      `
      float ca=e.x*6.2831853,cz=e.y*2.-1.,cr=sqrt(max(0.,1.-cz*cz));
      vec3 unit=vec3(cr*cos(ca),cz,cr*sin(ca));
      float fill=u${P}SurfaceOnly==1?1.:safePow(e.z,.5);
      vec3 sph=unit*fill;
      sph=mix(sph,abs(sph),clamp(u${P}Bias,0.,1.));
      vec3 axis=safeDir(u${P}Axis,vec3(0,1,0));
      vec3 a1=orthoOf(axis),a2=cross(axis,a1);
      vec3 result=axis*(u${P}ShapeLength*e.w)+sph*u${P}ShapeRadius;
      if(u${P}ShapeType==0)result=vec3(0.);
      else if(u${P}ShapeType==1)result=sph*u${P}ShapeRadius;
      else if(u${P}ShapeType==2)result=vec3(sph.x,abs(sph.y),sph.z)*u${P}ShapeRadius;
      else if(u${P}ShapeType==3){float h=e.w*u${P}ShapeLength;float rr=u${P}ShapeRadius+h*tan(min(u${P}ShapeAngle,1.5));result=axis*h+(a1*cos(ca)+a2*sin(ca))*rr*safePow(e.z,.5);}
      else if(u${P}ShapeType==4)result=(a1*cos(ca)+a2*sin(ca))*u${P}ShapeRadius;
      else if(u${P}ShapeType==5){float rr=mix(u${P}ShapeInner,u${P}ShapeRadius,safePow(e.z,.5));result=(a1*cos(ca)+a2*sin(ca))*rr;}
      else if(u${P}ShapeType==6)result=vec3(e.x*2.-1.,e.y*2.-1.,e.z*2.-1.)*u${P}ShapeSize*.5;
      return result;
    `,
    );
    replaceBody(
      p + "Dir",
      `
      vec3 axis=safeDir(u${P}Axis,vec3(0,1,0));
      vec3 base=safeDir(u${P}Dir,vec3(0,1,0));
      vec3 radial=safeDir(origin,axis);
      vec3 t1=orthoOf(base),t2=cross(base,t1);
      float ph=s.z*6.2831853,cone=s.w*u${P}Angle;
      vec3 result=safeDir(base+(t1*cos(ph)+t2*sin(ph))*cone,base);
      if(u${P}VelMode==0)result=safeDir(origin,radial);
      else if(u${P}VelMode==1)result=base;
      else if(u${P}VelMode==2)result=safeDir(cross(axis,radial),base);
      return result;
    `,
    );
    replaceBody(
      p + "SpeedAt",
      `
      float v=1.;
      if(u${P}SpeedN>=2){
        u=clamp(u,0.,1.);v=u${P}SpeedKey[0].y;
        for(int i=1;i<8;i++){
          if(i>=u${P}SpeedN)break;
          float a=u${P}SpeedKey[i-1].x,b=u${P}SpeedKey[i].x;
          float f=clamp((u-a)/max(b-a,1e-5),0.,1.);
          v=mix(v,u${P}SpeedKey[i].y,step(a,u)*f);
        }
      }
      return v;
    `,
    );
  }
  replaceBody(
    "softDepth",
    `
    float result=1.;
    if(uSoft>0.){
      vec2 sc=gl_FragCoord.xy/max(uResolution,vec2(1.));
      float sd=linDepth(texture2D(tDepth,sc).x),fd=linDepth(gl_FragCoord.z);
      result=clamp((sd-fd)/uSoft,0.,1.);
    }
    return result;
  `,
  );
  return source;
}
