Shader "autoV/Native/wireBurst" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
HLSLPROGRAM
#pragma target 4.5
#pragma vertex avfxVertex
#pragma fragment avfxFragment
#if defined(SHADER_STAGE_VERTEX)

    row_major float4x4 modelMatrix;
    row_major float4x4 viewMatrix;
    row_major float4x4 projectionMatrix;
    row_major float4x4 modelViewMatrix;
    row_major float3x3 normalMatrix;
    float3 cameraPosition;
    float uTime;
    float uLayerU;
    float uTravel;
    float uChannel;
    float uSplitOffset;
    float uSplitGrowth;
    float4 uCurveA[8];
    int uCurveAN;
    float uCurveAEase;
    float uOpacity;
    float uRampKeyMode;
    int uBlendMode;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float avfxVertexIndex;
static float3 position;
static float vA;
static float vK;
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
    float vA : TEXCOORD0;
    float vK : TEXCOORD1;
    float4 gl_Position : SV_Position;
};

static float3 aDir;
static float aSeed;
static float aKind;

float burstHash(inout float p)
{
    p = frac(p * 0.103100001811981201171875f);
    p *= (p + 33.3300018310546875f);
    p *= (p + p);
    return frac(p);
}

float safePow(float base, float e)
{
    return pow(max(base, 9.9999997473787516355514526367188e-06f), e);
}

float curveA(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float v = uCurveA[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uCurveAN)
        {
            break;
        }
        float a = uCurveA[i - 1].xy.x;
        float b = uCurveA[i].xy.x;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        f = lerp(f, (f * f) * (3.0f - (2.0f * f)), uCurveAEase);
        v = lerp(v, uCurveA[i].xy.y, step(a, u) * f);
    }
    return v;
}

void vert_main()
{
    aDir = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 3) + 0) % 1024, ((int(avfxVertexIndex) * 3) + 0) / 1024), 0)).xyz;
    aSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 3) + 1) % 1024, ((int(avfxVertexIndex) * 3) + 1) / 1024), 0)).x;
    aKind = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 3) + 2) % 1024, ((int(avfxVertexIndex) * 3) + 2) / 1024), 0)).x;
    float param = (aSeed * 1.7000000476837158203125f) + 0.300000011920928955078125f;
    float _208 = burstHash(param);
    float h = _208;
    float e = clamp(uLayerU, 0.0f, 1.0f);
    float param_1 = 1.0f - e;
    float param_2 = 2.599999904632568359375f;
    float out1 = 1.0f - safePow(param_1, param_2);
    float travel = ((lerp(0.4000000059604644775390625f, 1.4500000476837158203125f, h) * out1) * uTravel) * lerp(1.0f, 1.5f, aKind);
    float param_3 = e;
    float _239 = curveA(param_3);
    float scale = _239 * lerp(0.75f, 1.25f, h);
    float3 p = (aDir * travel) + (position * scale);
    vA = 1.0f - smoothstep(0.25f, 1.0f, e);
    vK = aKind;
    gl_Position = mul(float4(p, 1.0f), mul(modelViewMatrix, projectionMatrix));
    if (uChannel >= 0.0f)
    {
        gl_Position.x += ((((uChannel - 1.0f) * uSplitOffset) * (1.0f + (uSplitGrowth * e))) * gl_Position.w);
    }
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
    stage_output.vK = vK;
    return stage_output;
}

#else

    row_major float4x4 modelMatrix;
    row_major float4x4 viewMatrix;
    row_major float4x4 projectionMatrix;
    row_major float4x4 modelViewMatrix;
    row_major float3x3 normalMatrix;
    float3 cameraPosition;
    float uTime;
    float uLayerU;
    float uTravel;
    float uChannel;
    float uSplitOffset;
    float uSplitGrowth;
    float4 uCurveA[8];
    int uCurveAN;
    float uCurveAEase;
    float uOpacity;
    float uRampKeyMode;
    int uBlendMode;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float vK;
static float vA;
static float4 avfxColor;

struct SPIRV_Cross_Input
{
    float vA : TEXCOORD0;
    float vK : TEXCOORD1;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

float3 rampColor(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float3 c = uRamp[0].xyz * uRamp[0].w;
    float prev = uRampT[0].x;
    for (int i = 1; i < 6; i++)
    {
        if (i >= uRampN)
        {
            break;
        }
        float t = uRampT[i].x;
        float3 ci = uRamp[i].xyz * uRamp[i].w;
        c = lerp(c, ci, smoothstep(prev, max(t, prev + 9.9999997473787516355514526367188e-05f), u).xxx);
        prev = t;
    }
    return c;
}

void frag_main()
{
    bool _105 = uRampKeyMode > 1.5f;
    bool _112;
    if (_105)
    {
        _112 = uRampKeyMode < 2.5f;
    }
    else
    {
        _112 = _105;
    }
    float _113;
    if (_112)
    {
        _113 = vK;
    }
    else
    {
        _113 = clamp(uLayerU, 0.0f, 1.0f);
    }
    float key = _113;
    float param = key;
    float3 _128 = rampColor(param);
    float3 col = _128;
    float a = (vA * uOpacity) * lerp(1.0f, 0.75f, vK);
    if (uChannel >= 0.0f)
    {
        float3 _150;
        if (uChannel < 0.5f)
        {
            _150 = float3(1.0f, 0.0f, 0.0f);
        }
        else
        {
            bool3 _161 = (uChannel < 1.5f).xxx;
            _150 = float3(_161.x ? float3(0.0f, 1.0f, 0.0f).x : float3(0.0f, 0.0f, 1.0f).x, _161.y ? float3(0.0f, 1.0f, 0.0f).y : float3(0.0f, 0.0f, 1.0f).y, _161.z ? float3(0.0f, 1.0f, 0.0f).z : float3(0.0f, 0.0f, 1.0f).z);
        }
        col *= _150;
    }
    if (a < 0.00200000009499490261077880859375f)
    {
        discard;
    }
    if (uBlendMode == 1)
    {
        avfxColor = float4(col, a);
    }
    else
    {
        avfxColor = float4(col * a, a);
    }
}

SPIRV_Cross_Output avfxFragment(SPIRV_Cross_Input stage_input)
{
    vK = stage_input.vK;
    vA = stage_input.vA;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }
