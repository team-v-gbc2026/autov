Shader "autoV/Native/streak" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float uGrow;
    float uCurvature;
    float uUpBias;
    float uBundles;
    float uBundleSpread;
    float uStagger;
    float2 uLength;
    float2 uWidth;
    float3 uHueA;
    float3 uHueB;
    float3 uHueC;
    float uOpacity;
    float uFlicker;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float avfxVertexIndex;
static float2 vUv;
static float3 position;
static float vK;
static float3 vC;
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
    float vK : TEXCOORD1;
    float3 vC : TEXCOORD2;
    float4 gl_Position : SV_Position;
};

static float aSeed;

float stHash(inout float p)
{
    p = frac(p * 0.103100001811981201171875f);
    p *= (p + 33.3300018310546875f);
    p *= (p + p);
    return frac(p);
}

void vert_main()
{
    aSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 1) + 0) % 1024, ((int(avfxVertexIndex) * 1) + 0) / 1024), 0)).x;
    float s = aSeed;
    vUv = float2(position.x, (position.y * 0.5f) + 0.5f);
    float n = max(uBundles, 1.0f);
    float param = s * 0.77100002765655517578125f;
    float _95 = stHash(param);
    float bi = floor(_95 * n);
    float param_1 = (bi * 4.730000019073486328125f) + 0.89999997615814208984375f;
    float _108 = stHash(param_1);
    float bth = ((bi + (0.64999997615814208984375f * _108)) / n) * 6.283185482025146484375f;
    float param_2 = (bi * 9.10999965667724609375f) + 2.2999999523162841796875f;
    float _127 = stHash(param_2);
    float bsp = uBundleSpread * (0.300000011920928955078125f + (0.699999988079071044921875f * _127));
    float param_3 = s * 1.12999999523162841796875f;
    float _137 = stHash(param_3);
    float th = bth + ((_137 - 0.5f) * bsp);
    float2 d = float2(cos(th), sin(th));
    d.y = (d.y * (1.0f - (abs(uUpBias) * 0.2199999988079071044921875f))) + uUpBias;
    d = normalize(d + float2(9.9999997473787516355514526367188e-06f, 0.0f));
    float2 pp = float2(-d.y, d.x);
    float param_4 = s * 17.1000003814697265625f;
    float _181 = stHash(param_4);
    float hue = _181;
    float param_5 = s * 3.309999942779541015625f;
    float _192 = stHash(param_5);
    float L = lerp(uLength.x, uLength.y, pow(max(_192, 9.9999997473787516355514526367188e-06f), 1.5f));
    float param_6 = s * 5.1700000762939453125f;
    float _207 = stHash(param_6);
    float W = lerp(uWidth.x, uWidth.y, _207);
    float param_7 = s * 7.909999847412109375f;
    float _214 = stHash(param_7);
    float param_8 = s * 37.299999237060546875f;
    float _225 = stHash(param_8);
    float cv = (sign(_214 - 0.5f) * uCurvature) * (0.300000011920928955078125f + (0.699999988079071044921875f * _225));
    float param_9 = s * 11.30000019073486328125f;
    float _234 = stHash(param_9);
    float stag = _234 * uStagger;
    float g = clamp((uGrow - stag) / max(1.0f - stag, 0.001000000047497451305389404296875f), 0.0f, 1.0f);
    g = 1.0f - pow(max(1.0f - g, 9.9999997473787516355514526367188e-06f), 3.0f);
    float x = (position.x * L) * g;
    float param_10 = s * 23.1000003814697265625f;
    float _269 = stHash(param_10);
    float param_11 = s * 29.700000762939453125f;
    float _279 = stHash(param_11);
    float2 root = float2(((_269 - 0.5f) * L) * 0.0500000007450580596923828125f, ((_279 - 0.5f) * L) * 0.1599999964237213134765625f);
    float2 off = ((root + (d * x)) + (pp * ((((cv * x) * x) * 0.4199999868869781494140625f) / max(L, 0.001000000047497451305389404296875f)))) + ((pp * position.y) * W);
    float4 mv = mul(float4(0.0f, 0.0f, 0.0f, 1.0f), modelViewMatrix);
    float2 _323 = mv.xy + off;
    mv = float4(_323.x, _323.y, mv.z, mv.w);
    float param_12 = s * 13.69999980926513671875f;
    float _334 = stHash(param_12);
    vK = 0.550000011920928955078125f + (0.449999988079071044921875f * _334);
    float3 _344;
    if (hue > 0.839999973773956298828125f)
    {
        _344 = uHueB;
    }
    else
    {
        float3 _355;
        if (hue > 0.579999983310699462890625f)
        {
            _355 = uHueC;
        }
        else
        {
            _355 = uHueA;
        }
        _344 = _355;
    }
    vC = _344;
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
    stage_output.vUv = vUv;
    stage_output.vK = vK;
    stage_output.vC = vC;
    return stage_output;
}

#else

    row_major float4x4 modelMatrix;
    row_major float4x4 viewMatrix;
    row_major float4x4 projectionMatrix;
    row_major float4x4 modelViewMatrix;
    row_major float3x3 normalMatrix;
    float3 cameraPosition;
    float uGrow;
    float uCurvature;
    float uUpBias;
    float uBundles;
    float uBundleSpread;
    float uStagger;
    float2 uLength;
    float2 uWidth;
    float3 uHueA;
    float3 uHueB;
    float3 uHueC;
    float uOpacity;
    float uFlicker;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float2 vUv;
static float vK;
static float4 avfxColor;
static float3 vC;

struct SPIRV_Cross_Input
{
    float2 vUv : TEXCOORD0;
    float vK : TEXCOORD1;
    float3 vC : TEXCOORD2;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

void frag_main()
{
    float x = vUv.x;
    float wid = (1.0f - smoothstep(0.100000001490116119384765625f, 1.0f, x)) + 0.119999997317790985107421875f;
    float y = (abs(vUv.y - 0.5f) * 2.0f) / max(wid, 0.001000000047497451305389404296875f);
    float a = exp(((-y) * y) * 3.2000000476837158203125f);
    a *= (smoothstep(0.0f, 0.01200000010430812835693359375f, x) * (1.0f - smoothstep(0.2199999988079071044921875f, 1.0f, x)));
    a *= (((vK * uOpacity) * uFlicker) * 2.0f);
    if (a < 0.00200000009499490261077880859375f)
    {
        discard;
    }
    if (uBlendMode == 1)
    {
        avfxColor = float4(vC, a);
    }
    else
    {
        avfxColor = float4(vC * a, a);
    }
}

SPIRV_Cross_Output avfxFragment(SPIRV_Cross_Input stage_input)
{
    vUv = stage_input.vUv;
    vK = stage_input.vK;
    vC = stage_input.vC;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }
