Shader "autoV/Native/sheet" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float3 uShadow;
    float3 uBody;
    float3 uHigh;
    float3 uRim;
    float3 uLight;
    float3 uCam;
    float2 uBands;
    float uRimPow;
    float uRimAmt;
    float uOpacity;
    float uTear;
    float uTearScale;
    float uBandCount;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float avfxVertexIndex;
static float vSeed;
static float vAge;
static float2 vUv;
static float2 uv;
static float3 position;
static float3 vN;
static float3 normal;
static float3 vW;

struct SPIRV_Cross_Input {
    float3 position : POSITION;
    float3 normal : NORMAL;
    float2 uv : TEXCOORD0;
    float avfxVertexIndex : TEXCOORD1;
};

struct SPIRV_Cross_Output
{
    float3 vN : TEXCOORD0;
    float3 vW : TEXCOORD1;
    float2 vUv : TEXCOORD2;
    float vSeed : TEXCOORD3;
    float vAge : TEXCOORD4;
    float4 gl_Position : SV_Position;
};

static float aSheetSeed;
static float aSheetAge;

void vert_main()
{
    aSheetSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 2) + 0) % 1024, ((int(avfxVertexIndex) * 2) + 0) / 1024), 0)).x;
    aSheetAge = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 2) + 1) % 1024, ((int(avfxVertexIndex) * 2) + 1) / 1024), 0)).x;
    vSeed = aSheetSeed;
    vAge = aSheetAge;
    vUv = uv;
    float4 wp = mul(float4(position, 1.0f), modelMatrix);
    vN = normalize(mul(normal, float3x3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz)));
    vW = wp.xyz;
    gl_Position = mul(wp, mul(viewMatrix, projectionMatrix));
}

SPIRV_Cross_Output avfxVertex(SPIRV_Cross_Input stage_input)
{
    avfxVertexIndex = stage_input.avfxVertexIndex;
    uv = stage_input.uv;
    position = stage_input.position;
    normal = stage_input.normal;
    vert_main();
    SPIRV_Cross_Output stage_output;
    stage_output.gl_Position = gl_Position;
    stage_output.vSeed = vSeed;
    stage_output.vAge = vAge;
    stage_output.vUv = vUv;
    stage_output.vN = vN;
    stage_output.vW = vW;
    return stage_output;
}

#else

    row_major float4x4 modelMatrix;
    row_major float4x4 viewMatrix;
    row_major float4x4 projectionMatrix;
    row_major float4x4 modelViewMatrix;
    row_major float3x3 normalMatrix;
    float3 cameraPosition;
    float3 uShadow;
    float3 uBody;
    float3 uHigh;
    float3 uRim;
    float3 uLight;
    float3 uCam;
    float2 uBands;
    float uRimPow;
    float uRimAmt;
    float uOpacity;
    float uTear;
    float uTearScale;
    float uBandCount;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static bool gl_FrontFacing;
static float vAge;
static float2 vUv;
static float vSeed;
static float3 vN;
static float3 vW;
static float4 avfxColor;

struct SPIRV_Cross_Input
{
    float3 vN : TEXCOORD0;
    float3 vW : TEXCOORD1;
    float2 vUv : TEXCOORD2;
    float vSeed : TEXCOORD3;
    float vAge : TEXCOORD4;
    bool gl_FrontFacing : SV_IsFrontFace;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

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

void frag_main()
{
    if (uTear > 0.0f)
    {
        float tear = uTear * (0.699999988079071044921875f + (0.60000002384185791015625f * vAge));
        float3 param = float3(vUv.x * uTearScale, (vUv.y * uTearScale) * 0.64999997615814208984375f, vSeed);
        float fld = 0.5f + (0.5f * snoise(param));
        float edge = min(min(vUv.x, 1.0f - vUv.x) * 2.2000000476837158203125f, min(vUv.y, 1.0f - vUv.y) * 1.5f);
        if ((edge + (fld * 0.550000011920928955078125f)) < tear)
        {
            discard;
        }
    }
    float3 N = normalize(vN);
    if (!gl_FrontFacing)
    {
        N = -N;
    }
    float ndl = (dot(N, normalize(uLight)) * 0.5f) + 0.5f;
    float3 _492;
    if (uBandCount > 2.5f)
    {
        float3 _500;
        if (ndl < uBands.x)
        {
            _500 = uShadow;
        }
        else
        {
            float3 _511;
            if (ndl < uBands.y)
            {
                _511 = uBody;
            }
            else
            {
                _511 = uHigh;
            }
            _500 = _511;
        }
        _492 = _500;
    }
    else
    {
        float3 _528;
        if (ndl < uBands.x)
        {
            _528 = uShadow;
        }
        else
        {
            _528 = uHigh;
        }
        _492 = _528;
    }
    float3 c = _492;
    float3 V = normalize(uCam - vW);
    float rim = pow(max(1.0f - clamp(dot(N, V), 0.0f, 1.0f), 9.9999997473787516355514526367188e-05f), uRimPow);
    c += ((uRim * rim) * uRimAmt);
    if (uBlendMode == 1)
    {
        avfxColor = float4(c, uOpacity);
    }
    else
    {
        avfxColor = float4(c * uOpacity, uOpacity);
    }
}

SPIRV_Cross_Output avfxFragment(SPIRV_Cross_Input stage_input)
{
    gl_FrontFacing = !stage_input.gl_FrontFacing;
    vAge = stage_input.vAge;
    vUv = stage_input.vUv;
    vSeed = stage_input.vSeed;
    vN = stage_input.vN;
    vW = stage_input.vW;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }