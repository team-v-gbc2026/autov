// ACES fit from three.js (MIT), see THREE-LICENSE.txt bundled with the adapter.
Shader "Hidden/autoV/PreviewTone" {
Properties { _MainTex ("HDR source", 2D) = "black" {} _Exposure ("Exposure", Float) = 1 }
SubShader { Cull Off ZWrite Off ZTest Always Pass {
CGPROGRAM
#pragma vertex vert_img
#pragma fragment frag
#include "UnityCG.cginc"
sampler2D _MainTex;
float _Exposure;
float4 frag(v2f_img i) : SV_Target {
    float3 c=tex2D(_MainTex,i.uv).rgb*(_Exposure/0.6);
    c=mul(float3x3(0.59719,0.35458,0.04823, 0.07600,0.90834,0.01566, 0.02840,0.13383,0.83777),c);
    c=(c*(c+0.0245786)-0.000090537)/(c*(0.983729*c+0.4329510)+0.238081);
    c=saturate(mul(float3x3(1.60475,-0.53108,-0.07367, -0.10208,1.10813,-0.00605, -0.00327,-0.07276,1.07602),c));
    c=float3(c.r<=0.0031308?c.r*12.92:1.055*pow(c.r,1.0/2.4)-0.055,
             c.g<=0.0031308?c.g*12.92:1.055*pow(c.g,1.0/2.4)-0.055,
             c.b<=0.0031308?c.b*12.92:1.055*pow(c.b,1.0/2.4)-0.055);
    return float4(c,1);
}
ENDCG
} }
}
