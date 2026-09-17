Shader "autoV/Native/arc" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend], One [_DstBlend]
HLSLPROGRAM
#pragma target 4.5
#pragma vertex avfxVertex
#pragma fragment avfxFragment
#if defined(SHADER_STAGE_VERTEX)

    uniform float4x4 modelMatrix;
    uniform float4x4 viewMatrix;
    uniform float4x4 projectionMatrix;
    uniform float4x4 modelViewMatrix;
    uniform float3x3 normalMatrix;
    uniform float3 cameraPosition;
    uniform float uTime;
    uniform float uHeight;
    uniform float uWidthK;
    uniform float uSpan;
    uniform float uWidth;
    uniform float uMinWidth;
    uniform float uJitterAmp;
    uniform float uJitterFreq;
    uniform float uJitterFold;
    uniform float uSkip;
    uniform float2 uRadius;
    uniform float2 uPitch;
    uniform float2 uPeriod;
    uniform float2 uOnTime;
    uniform float3 uCore;
    uniform float3 uHalo;
    uniform float uOpacity;
    uniform float uFlicker;
    uniform int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float avfxVertexIndex;
static float3 position;
static float vA;
static float2 vUv;
static float3 normal;
static float2 uv;

struct SPIRV_Cross_Input {
    float3 position : POSITION;
    float3 normal : NORMAL;
    float2 uv : TEXCOORD0;
    float avfxVertexIndex : TEXCOORD1;
};

struct SPIRV_Cross_Output
{
    float2 vUv : TEXCOORD0;
    float vA : TEXCOORD1;
    float4 gl_Position : SV_Position;
};

static float aSeed;

float arcHash(inout float p)
{
    p = frac(p * 0.103100001811981201171875f);
    p *= (p + 33.3300018310546875f);
    p *= (p + p);
    return frac(p);
}

float3 mod289v3(float3 x)
{
    return x - (floor(x * 0.00346020772121846675872802734375f) * 289.0f);
}

float4 mod289v4(float4 x)
{
    return x - (floor(x * 0.00346020772121846675872802734375f) * 289.0f);
}

float4 permute289(float4 x)
{
    float4 param = ((x * 34.0f) + 1.0f.xxxx) * x;
    return mod289v4(param);
}

float4 taylorInvSqrtV(float4 r)
{
    return 1.792842864990234375f.xxxx - (r * 0.8537347316741943359375f);
}

float snoise(float3 v)
{
    float3 i = floor(v + dot(v, 0.3333333432674407958984375f.xxx).xxx);
    float3 x0 = (v - i) + dot(i, 0.16666667163372039794921875f.xxx).xxx;
    float3 g = step(x0.yzx, x0);
    float3 l = 1.0f.xxx - g;
    float3 i1 = min(g, l.zxy);
    float3 i2 = max(g, l.zxy);
    float3 x1 = (x0 - i1) + 0.16666667163372039794921875f.xxx;
    float3 x2 = (x0 - i2) + 0.3333333432674407958984375f.xxx;
    float3 x3 = x0 - 0.5f.xxx;
    float3 param = i;
    i = mod289v3(param);
    float4 param_1 = i.z.xxxx + float4(0.0f, i1.z, i2.z, 1.0f);
    float4 param_2 = (permute289(param_1) + i.y.xxxx) + float4(0.0f, i1.y, i2.y, 1.0f);
    float4 param_3 = (permute289(param_2) + i.x.xxxx) + float4(0.0f, i1.x, i2.x, 1.0f);
    float4 p = permute289(param_3);
    float n_ = 0.14285714924335479736328125f;
    float3 ns = (float3(2.0f, 0.5f, 1.0f) * n_) - float3(0.0f, 1.0f, 0.0f);
    float4 j = p - (floor((p * ns.z) * ns.z) * 49.0f);
    float4 x_ = floor(j * ns.z);
    float4 y_ = floor(j - (x_ * 7.0f));
    float4 x = (x_ * ns.x) + ns.yyyy;
    float4 y = (y_ * ns.x) + ns.yyyy;
    float4 h = (1.0f.xxxx - abs(x)) - abs(y);
    float4 b0 = float4(x.xy, y.xy);
    float4 b1 = float4(x.zw, y.zw);
    float4 s0 = (floor(b0) * 2.0f) + 1.0f.xxxx;
    float4 s1 = (floor(b1) * 2.0f) + 1.0f.xxxx;
    float4 sh = -step(h, 0.0f.xxxx);
    float4 a0 = b0.xzyw + (s0.xzyw * sh.xxyy);
    float4 a1 = b1.xzyw + (s1.xzyw * sh.zzww);
    float3 p0 = float3(a0.xy, h.x);
    float3 p1 = float3(a0.zw, h.y);
    float3 p2 = float3(a1.xy, h.z);
    float3 p3 = float3(a1.zw, h.w);
    float4 param_4 = float4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3));
    float4 norm = taylorInvSqrtV(param_4);
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    float4 m = max(0.60000002384185791015625f.xxxx - float4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0f.xxxx);
    m *= m;
    return 42.0f * dot(m * m, float4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm3(float3 p)
{
    float3 param = p;
    float3 param_1 = (p * 2.019999980926513671875f) + 7.0f.xxx;
    float3 param_2 = (p * 4.05000019073486328125f) + 3.0f.xxx;
    float3 param_3 = (p * 8.1000003814697265625f) + 1.0f.xxx;
    return (((0.5f * snoise(param)) + (0.25f * snoise(param_1))) + (0.125f * snoise(param_2))) + (0.0625f * snoise(param_3));
}

float arcNoise(float a, float b)
{
    float3 param = float3(a, b, 1.7000000476837158203125f);
    float n = fbm3(param);
    return lerp(n, (abs(n) * 2.0f) - 1.0f, clamp(uJitterFold, 0.0f, 1.0f));
}

float3 arcPoint(float u, float s, float k)
{
    float param = (s * 3.1099998950958251953125f) + (k * 1.7000000476837158203125f);
    float _500 = arcHash(param);
    float r = lerp(uRadius.x, uRadius.y, _500) * uWidthK;
    float param_1 = (s * 7.730000019073486328125f) + (k * 2.2999999523162841796875f);
    float _520 = arcHash(param_1);
    float pv = lerp(uPitch.x, uPitch.y, _520);
    float param_2 = (s * 5.309999942779541015625f) + (k * 3.099999904632568359375f);
    float _531 = arcHash(param_2);
    float y0 = (_531 * uSpan) * 0.7400000095367431640625f;
    float param_3 = (s * 11.1000003814697265625f) + (k * 0.699999988079071044921875f);
    float _551 = arcHash(param_3);
    float ln = uSpan * (0.180000007152557373046875f + (0.37000000476837158203125f * _551));
    float param_4 = (s * 13.69999980926513671875f) + (k * 4.900000095367431640625f);
    float _564 = arcHash(param_4);
    float ph = _564 * 6.283185482025146484375f;
    float y = (y0 + (u * ln)) * uHeight;
    float a = ph + ((u * pv) * 6.283185482025146484375f);
    float param_5 = u * uJitterFreq;
    float param_6 = (s * 3.099999904632568359375f) + (k * 0.310000002384185791015625f);
    float j1 = arcNoise(param_5, param_6);
    float param_7 = ((u * uJitterFreq) * 2.400000095367431640625f) + 7.0f;
    float param_8 = (s * 5.69999980926513671875f) + (k * 0.730000019073486328125f);
    float j2 = arcNoise(param_7, param_8);
    float3 param_9 = float3(((u * uJitterFreq) * 4.19999980926513671875f) + 3.0f, (s * 7.900000095367431640625f) + (k * 1.12999999523162841796875f), 0.89999997615814208984375f);
    float j3 = fbm3(param_9) * 0.5f;
    r *= (1.0f + (uJitterAmp * ((0.699999988079071044921875f * j1) + (0.2199999988079071044921875f * j3))));
    a += (uJitterAmp * ((1.4500000476837158203125f * j2) + (0.4000000059604644775390625f * j3)));
    return float3(cos(a) * r, y, sin(a) * r);
}

void vert_main()
{
    aSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 1) + 0) % 1024, ((int(avfxVertexIndex) * 1) + 0) / 1024), 0)).x;
    float s = aSeed;
    float u = position.x;
    float side = position.y;
    float param = s * 1.71000003814697265625f;
    float _721 = arcHash(param);
    float per = lerp(uPeriod.x, uPeriod.y, _721);
    float param_1 = s * 2.9300000667572021484375f;
    float _733 = arcHash(param_1);
    float onT = lerp(uOnTime.x, uOnTime.y, _733);
    float param_2 = s * 4.36999988555908203125f;
    float _740 = arcHash(param_2);
    float off = _740 * per;
    float k = floor((uTime - off) / max(per, 9.9999997473787516355514526367188e-05f));
    float loc = (uTime - off) - (k * max(per, 9.9999997473787516355514526367188e-05f));
    float param_3 = (k * 1.37300002574920654296875f) + (s * 9.10999965667724609375f);
    float _779 = arcHash(param_3);
    float live = step(loc, onT) * step(uSkip, _779);
    float w = sin(3.1415927410125732421875f * clamp(loc / max(onT, 9.9999997473787516355514526367188e-05f), 0.0f, 1.0f));
    float param_4 = (k * 2.1099998950958251953125f) + (s * 5.5f);
    float _806 = arcHash(param_4);
    vA = (live * w) * (0.550000011920928955078125f + (0.449999988079071044921875f * _806));
    vUv = float2(u, (side * 0.5f) + 0.5f);
    float param_5 = u;
    float param_6 = s;
    float param_7 = k;
    float3 a3 = arcPoint(param_5, param_6, param_7);
    float param_8 = min(u + 0.0350000001490116119384765625f, 1.0f) + ((u > 0.964999973773956298828125f) ? (-0.070000000298023223876953125f) : 0.0f);
    float param_9 = s;
    float param_10 = k;
    float3 b3 = arcPoint(param_8, param_9, param_10);
    float4 mv = mul(float4(a3, 1.0f), modelViewMatrix);
    float4 mb = mul(float4(b3, 1.0f), modelViewMatrix);
    float2 d = mb.xy - mv.xy;
    float2 _875;
    if (length(d) > 9.9999997473787516355514526367188e-06f)
    {
        _875 = normalize(float2(-d.y, d.x));
    }
    else
    {
        _875 = float2(1.0f, 0.0f);
    }
    float2 pp = _875;
    float wid = max((uWidth * 0.5f) * (0.550000011920928955078125f + (0.449999988079071044921875f * sin(3.1415927410125732421875f * u))), (-mv.z) * uMinWidth);
    float2 _914 = mv.xy + ((pp * side) * wid);
    mv = float4(_914.x, _914.y, mv.z, mv.w);
    gl_Position = mul(mv, projectionMatrix);
}

SPIRV_Cross_Output avfxVertex(SPIRV_Cross_Input stage_input)
{
    avfxVertexIndex = stage_input.avfxVertexIndex;
    position = stage_input.position;
    normal = stage_input.normal;
    uv = stage_input.uv;
    vert_main();
    SPIRV_Cross_Output stage_output;
    stage_output.gl_Position = gl_Position;
    stage_output.vA = vA;
    stage_output.vUv = vUv;
    return stage_output;
}

#else

    uniform float4x4 modelMatrix;
    uniform float4x4 viewMatrix;
    uniform float4x4 projectionMatrix;
    uniform float4x4 modelViewMatrix;
    uniform float3x3 normalMatrix;
    uniform float3 cameraPosition;
    uniform float uTime;
    uniform float uHeight;
    uniform float uWidthK;
    uniform float uSpan;
    uniform float uWidth;
    uniform float uMinWidth;
    uniform float uJitterAmp;
    uniform float uJitterFreq;
    uniform float uJitterFold;
    uniform float uSkip;
    uniform float2 uRadius;
    uniform float2 uPitch;
    uniform float2 uPeriod;
    uniform float2 uOnTime;
    uniform float3 uCore;
    uniform float3 uHalo;
    uniform float uOpacity;
    uniform float uFlicker;
    uniform int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float vA;
static float2 vUv;
static float4 avfxColor;

struct SPIRV_Cross_Input
{
    float2 vUv : TEXCOORD0;
    float vA : TEXCOORD1;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

void frag_main()
{
    if (vA <= 0.0f)
    {
        discard;
    }
    float y = abs(vUv.y - 0.5f) * 2.0f;
    float core = 1.0f - smoothstep(0.100000001490116119384765625f, 0.550000011920928955078125f, y);
    float halo = 1.0f - smoothstep(0.300000011920928955078125f, 1.0f, y);
    float ends = smoothstep(0.0f, 0.0599999986588954925537109375f, vUv.x) * (1.0f - smoothstep(0.939999997615814208984375f, 1.0f, vUv.x));
    float3 c = ((uCore * core) * 1.85000002384185791015625f) + ((uHalo * halo) * 0.75f);
    float a = ((vA * ends) * uOpacity) * uFlicker;
    if (a < 0.00200000009499490261077880859375f)
    {
        discard;
    }
    if (uBlendMode == 1)
    {
        avfxColor = float4(c, a);
    }
    else
    {
        avfxColor = float4(c * a, a);
    }
}

SPIRV_Cross_Output avfxFragment(SPIRV_Cross_Input stage_input)
{
    vA = stage_input.vA;
    vUv = stage_input.vUv;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }
