Shader "autoV/Native/ribbon" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float uHead;
    float uTail;
    float uWidth;
    float uMorph;
    float uSpread;
    float uWidthJitter;
    float uPhaseJitter;
    float uTaperHead;
    float uTaperTail;
    float uOrientPath;
    int uPathType;
    float3 uPathA;
    float3 uPathB;
    float3 uPathC;
    float4 uPathD;
    float2 uPathW;
    int uMorphPathType;
    float3 uMorphPathA;
    float3 uMorphPathB;
    float3 uMorphPathC;
    float4 uMorphPathD;
    float2 uMorphPathW;
    float uOpacity;
    float uCore;
    int uBlendMode;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float3 position;
static float vSide;
static float vW;
static float vStrand;
static float vFade;
static float3 normal;
static float2 uv;
static float avfxVertexIndex;

struct SPIRV_Cross_Input {
    float3 position : POSITION;
    float3 normal : NORMAL;
    float2 uv : TEXCOORD0;
    float avfxVertexIndex : TEXCOORD1;
};

struct SPIRV_Cross_Output
{
    float vSide : TEXCOORD0;
    float vW : TEXCOORD1;
    float vStrand : TEXCOORD2;
    float vFade : TEXCOORD3;
    float4 gl_Position : SV_Position;
};

float ribbonHash(inout float p)
{
    p = frac(p * 0.103100001811981201171875f);
    p *= (p + 33.3300018310546875f);
    p *= (p + p);
    return frac(p);
}

float3 pathPoint(float u)
{
    if (uPathType == 1)
    {
        float m = 1.0f - u;
        return ((uPathA * (m * m)) + (uPathB * ((2.0f * m) * u))) + (uPathC * (u * u));
    }
    float th = ((6.283185482025146484375f * uPathD.z) * u) + uPathD.w;
    float r = uPathD.x + (uPathW.x * sin(uPathW.y * th));
    float y = (uPathA.y + (uPathD.y * u)) + ((uPathW.x * 0.5f) * sin(((uPathW.y * th) * 2.0f) + 1.2999999523162841796875f));
    return float3(uPathA.x + (cos(th) * r), y, uPathA.z + (sin(th) * r));
}

float3 pathPointM(float u)
{
    if (uMorphPathType == 1)
    {
        float m = 1.0f - u;
        return ((uMorphPathA * (m * m)) + (uMorphPathB * ((2.0f * m) * u))) + (uMorphPathC * (u * u));
    }
    float th = ((6.283185482025146484375f * uMorphPathD.z) * u) + uMorphPathD.w;
    float r = uMorphPathD.x + (uMorphPathW.x * sin(uMorphPathW.y * th));
    float y = (uMorphPathA.y + (uMorphPathD.y * u)) + ((uMorphPathW.x * 0.5f) * sin(((uMorphPathW.y * th) * 2.0f) + 1.2999999523162841796875f));
    return float3(uMorphPathA.x + (cos(th) * r), y, uMorphPathA.z + (sin(th) * r));
}

float3 sweep(float u)
{
    float _261;
    if (uPathType == 1)
    {
        _261 = clamp(u, 0.0f, 1.0f);
    }
    else
    {
        _261 = frac(u);
    }
    float ua = _261;
    float _275;
    if (uMorphPathType == 1)
    {
        _275 = clamp(u, 0.0f, 1.0f);
    }
    else
    {
        _275 = frac(u);
    }
    float ub = _275;
    float param = ua;
    float param_1 = ub;
    return lerp(pathPoint(param), pathPointM(param_1), uMorph.xxx);
}

void vert_main()
{
    float w = position.x;
    float side = position.y;
    float strand = position.z;
    float param = (strand * 11.69999980926513671875f) + 3.099999904632568359375f;
    float _316 = ribbonHash(param);
    float hs = _316;
    float u = (uHead - ((1.0f - w) * uTail)) + (((hs - 0.5f) * uPhaseJitter) * uTail);
    float param_1 = u;
    float3 p = sweep(param_1);
    float param_2 = u + 0.001000000047497451305389404296875f;
    float param_3 = u - 0.001000000047497451305389404296875f;
    float3 tangent = normalize((sweep(param_2) - sweep(param_3)) + float3(0.0f, 0.0f, 9.9999999747524270787835121154785e-07f));
    float3 sd = normalize(cross(tangent, float3(0.0f, 1.0f, 0.0f)) + float3(9.9999997473787516355514526367188e-06f, 0.0f, 0.0f));
    float3 upn = normalize(cross(sd, tangent));
    float param_4 = (strand * 3.7000000476837158203125f) + 9.1000003814697265625f;
    float _386 = ribbonHash(param_4);
    p += ((sd * ((hs - 0.5f) * uSpread)) + (upn * ((_386 - 0.5f) * uSpread)));
    float4 world = mul(float4(p, 1.0f), modelMatrix);
    float fade = smoothstep(0.0f, max(uTaperTail, 9.9999997473787516355514526367188e-05f), w) * smoothstep(1.0f, 1.0f - max(uTaperHead, 9.9999997473787516355514526367188e-05f), w);
    float strandW = lerp(1.0f - uWidthJitter, 1.0f, hs);
    float half_ = ((uWidth * 0.5f) * strandW) * fade;
    float3 worldTangent = normalize(mul(tangent, float3x3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz)) + float3(0.0f, 0.0f, 9.9999999747524270787835121154785e-07f));
    float3 view = normalize(cameraPosition - world.xyz);
    float3 _466;
    if (uOrientPath > 0.5f)
    {
        _466 = normalize(mul(upn, float3x3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz)));
    }
    else
    {
        _466 = normalize(cross(worldTangent, view));
    }
    float3 across = _466;
    vSide = side;
    vW = w;
    vStrand = hs;
    vFade = fade;
    gl_Position = mul(float4(world.xyz + ((across * side) * half_), 1.0f), mul(viewMatrix, projectionMatrix));
}

SPIRV_Cross_Output avfxVertex(SPIRV_Cross_Input stage_input)
{
    position = stage_input.position;
    normal = stage_input.normal;
    uv = stage_input.uv;
    avfxVertexIndex = stage_input.avfxVertexIndex;
    vert_main();
    SPIRV_Cross_Output stage_output;
    stage_output.gl_Position = gl_Position;
    stage_output.vSide = vSide;
    stage_output.vW = vW;
    stage_output.vStrand = vStrand;
    stage_output.vFade = vFade;
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
    float uHead;
    float uTail;
    float uWidth;
    float uMorph;
    float uSpread;
    float uWidthJitter;
    float uPhaseJitter;
    float uTaperHead;
    float uTaperTail;
    float uOrientPath;
    int uPathType;
    float3 uPathA;
    float3 uPathB;
    float3 uPathC;
    float4 uPathD;
    float2 uPathW;
    int uMorphPathType;
    float3 uMorphPathA;
    float3 uMorphPathB;
    float3 uMorphPathC;
    float4 uMorphPathD;
    float2 uMorphPathW;
    float uOpacity;
    float uCore;
    int uBlendMode;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float vFade;
static float vSide;
static float vW;
static float vStrand;
static float4 avfxColor;

struct SPIRV_Cross_Input
{
    float vSide : TEXCOORD0;
    float vW : TEXCOORD1;
    float vStrand : TEXCOORD2;
    float vFade : TEXCOORD3;
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
    if (vFade <= 0.0f)
    {
        discard;
    }
    float q = abs(vSide);
    float core = exp(((-q) * q) * 9.0f);
    float halo = exp(((-q) * q) * 1.60000002384185791015625f);
    float flicker = 0.85000002384185791015625f + (0.1500000059604644775390625f * sin(((vW * 40.0f) + (uTime * 6.0f)) + (vStrand * 9.0f)));
    float param = q;
    float3 _147 = rampColor(param);
    float3 col = (_147 * (((core * 1.5f) * uCore) + (halo * 0.300000011920928955078125f))) * flicker;
    float a = (vFade * uOpacity) * ((core * 0.89999997615814208984375f) + (halo * 0.3499999940395355224609375f));
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
    vFade = stage_input.vFade;
    vSide = stage_input.vSide;
    vW = stage_input.vW;
    vStrand = stage_input.vStrand;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }