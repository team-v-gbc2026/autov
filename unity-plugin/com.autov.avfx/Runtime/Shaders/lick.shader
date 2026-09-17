Shader "autoV/Native/lick" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float3 uAnchor;
    float3 uTangent;
    float3 uNormal;
    float3 uDrift;
    float2 uLength;
    float2 uWidth;
    float2 uStagger;
    float2 uLife;
    float uTime;
    float uSpan;
    float uCurl;
    float uFlipHz;
    float3 uHot;
    float3 uBody;
    float uOpacity;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float avfxVertexIndex;
static float3 position;
static float vA;
static float vS;
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
    float vS : TEXCOORD0;
    float vA : TEXCOORD1;
    float4 gl_Position : SV_Position;
};

static float aSeed;
static float aSide;

float lickHash(inout float p)
{
    p = frac(p * 0.103100001811981201171875f);
    p *= (p + 33.3300018310546875f);
    p *= (p + p);
    return frac(p);
}

void vert_main()
{
    aSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 2) + 0) % 1024, ((int(avfxVertexIndex) * 2) + 0) / 1024), 0)).x;
    aSide = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 2) + 1) % 1024, ((int(avfxVertexIndex) * 2) + 1) / 1024), 0)).x;
    float u = position.x;
    float v = position.y;
    float param = (aSeed * 2.2999999523162841796875f) + 0.4000000059604644775390625f;
    float _95 = lickHash(param);
    float h1 = _95;
    float param_1 = (aSeed * 4.900000095367431640625f) + 6.599999904632568359375f;
    float _103 = lickHash(param_1);
    float h2 = _103;
    float k = floor(uTime * max(uFlipHz, 0.001000000047497451305389404296875f)) + aSeed;
    float param_2 = k * 1.309999942779541015625f;
    float _134 = lickHash(param_2);
    float L = lerp(uLength.x, uLength.y, _134);
    float param_3 = (k * 3.769999980926513671875f) + 2.099999904632568359375f;
    float _148 = lickHash(param_3);
    float W = lerp(uWidth.x, uWidth.y, _148);
    float birth = lerp(uStagger.x, uStagger.y, h1) * uSpan;
    float life = lerp(uLife.x, uLife.y, h2);
    float age = uTime - birth;
    float a01 = clamp(age / max(life, 9.9999997473787516355514526367188e-05f), 0.0f, 1.0f);
    float alive = step(0.0f, age) * step(a01, 0.999000012874603271484375f);
    vA = alive * sin(3.1415927410125732421875f * pow(max(a01, 9.9999997473787516355514526367188e-05f), 0.699999988079071044921875f));
    vS = u;
    float3 R = float3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
    float3 Up = float3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);
    float3 base = (uAnchor + ((uNormal * (h1 - 0.5f)) * 0.100000001490116119384765625f)) + (uDrift * age);
    float2 dir = normalize((float2(dot(-uTangent, R), dot(-uTangent, Up)) + float2(0.0f, 0.550000011920928955078125f)) + 9.9999997473787516355514526367188e-05f.xx);
    float2 pr = float2(-dir.y, dir.x);
    float w = ((W * 0.5f) * pow(max(u + 0.0599999986588954925537109375f, 9.9999997473787516355514526367188e-05f), 0.300000011920928955078125f)) * pow(max(1.0f - u, 9.9999997473787516355514526367188e-05f), 0.85000002384185791015625f);
    float curl = ((uCurl * sin((u * 3.0f) + (h1 * 6.283185482025146484375f))) * u) * aSide;
    float2 q = (dir * ((u * L) * (0.449999988079071044921875f + (0.85000002384185791015625f * a01)))) + (pr * (((aSide * 0.04500000178813934326171875f) + curl) + (v * w)));
    float3 wp = base + (((R * q.x) + (Up * q.y)) * alive);
    gl_Position = mul(float4(wp, 1.0f), mul(viewMatrix, projectionMatrix));
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
    stage_output.vS = vS;
    return stage_output;
}

#else

    row_major float4x4 modelMatrix;
    row_major float4x4 viewMatrix;
    row_major float4x4 projectionMatrix;
    row_major float4x4 modelViewMatrix;
    row_major float3x3 normalMatrix;
    float3 cameraPosition;
    float3 uAnchor;
    float3 uTangent;
    float3 uNormal;
    float3 uDrift;
    float2 uLength;
    float2 uWidth;
    float2 uStagger;
    float2 uLife;
    float uTime;
    float uSpan;
    float uCurl;
    float uFlipHz;
    float3 uHot;
    float3 uBody;
    float uOpacity;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float vA;
static float vS;
static float4 avfxColor;

struct SPIRV_Cross_Input
{
    float vS : TEXCOORD0;
    float vA : TEXCOORD1;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

void frag_main()
{
    float a = vA * uOpacity;
    if (a <= 0.0040000001899898052215576171875f)
    {
        discard;
    }
    float3 _39;
    if (vS < 0.4199999868869781494140625f)
    {
        _39 = uHot;
    }
    else
    {
        _39 = uBody;
    }
    float3 col = _39;
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
    vA = stage_input.vA;
    vS = stage_input.vS;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }
