Shader "autoV/Native/blob" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float uNoiseSpeed;
    float3 uShadow;
    float3 uBody;
    float3 uHigh;
    float3 uRimCol;
    float3 uLight;
    float uBands;
    float uBandA;
    float uBandB;
    float uRimPow;
    float uRimAmt;
    float uFlat;
    float uRampKeyMode;
    float uLayerU;
    float uGroundY;
    float uHeightSpan;
    float uUseToon;
    float uToonRamp;
    float uToonShadowScale;
    float uToonHighMix;
    float uRampBlendMode;
    float uRampBlendWeight;
    float uLightOn;
    float uLightFall;
    float3 uLightPos;
    int uBlendMode;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float avfxVertexIndex;
static float3 vLobe;
static float3 position;
static float3 vWp;
static float3 vN;
static float3 vV;
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
    float3 vN : TEXCOORD0;
    float3 vV : TEXCOORD1;
    float3 vWp : TEXCOORD2;
    float3 vLobe : TEXCOORD3;
    float4 gl_Position : SV_Position;
};

static float4 aLobeA;
static float4 aLobeB;
static float4 aLobeC;
static float4 aLobeP;

float3 safeDir(float3 v, float3 fallback)
{
    float l = length(v);
    float3 _406;
    if (l > 9.9999997473787516355514526367188e-06f)
    {
        _406 = v / l.xxx;
    }
    else
    {
        _406 = fallback;
    }
    return _406;
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

float lobeR(float3 n)
{
    float3 q = (n * aLobeA.z) + float3(aLobeA.x * 7.30000019073486328125f, (aLobeA.x * 3.099999904632568359375f) - (uTime * uNoiseSpeed), aLobeA.x * 11.69999980926513671875f);
    float3 param = q;
    float3 param_1 = (q * 2.099999904632568359375f) + 5.0f.xxx;
    float3 param_2 = (q * 4.30000019073486328125f) + 11.0f.xxx;
    float f = ((0.60000002384185791015625f * snoise(param)) + (0.300000011920928955078125f * snoise(param_1))) + (0.1500000059604644775390625f * snoise(param_2));
    return 1.0f + (aLobeA.y * ((0.449999988079071044921875f * f) + (0.550000011920928955078125f * abs(f))));
}

float3 lobeP(float3 n)
{
    float3 param = n;
    float3 p = n * lobeR(param);
    float s = clamp((p.y * 0.5f) + 0.5f, 0.0f, 1.0f);
    float2 _521 = p.xz * lerp(1.0f, 1.0f - aLobeB.y, smoothstep(0.20000000298023223876953125f, 1.0f, s));
    p = float3(_521.x, p.y, _521.y);
    float a = aLobeB.x * p.y;
    float2 _545 = mul(p.xy, float2x2(float2(cos(a), -sin(a)), float2(sin(a), cos(a))));
    p = float3(_545.x, _545.y, p.z);
    float2 _566 = mul(p.xy, float2x2(float2(cos(aLobeB.z), -sin(aLobeB.z)), float2(sin(aLobeB.z), cos(aLobeB.z))));
    p = float3(_566.x, _566.y, p.z);
    p.y *= aLobeA.w;
    return p;
}

void vert_main()
{
    aLobeA = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 4) + 0) % 1024, ((int(avfxVertexIndex) * 4) + 0) / 1024), 0));
    aLobeB = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 4) + 1) % 1024, ((int(avfxVertexIndex) * 4) + 1) / 1024), 0));
    aLobeC = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 4) + 2) % 1024, ((int(avfxVertexIndex) * 4) + 2) / 1024), 0));
    aLobeP = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 4) + 3) % 1024, ((int(avfxVertexIndex) * 4) + 3) / 1024), 0));
    vLobe = aLobeC.xyz;
    float3 param = position;
    float3 param_1 = float3(0.0f, 1.0f, 0.0f);
    float3 n = safeDir(param, param_1);
    float3 param_2 = n;
    float3 p = lobeP(param_2);
    bool3 _672 = (abs(n.y) < 0.89999997615814208984375f).xxx;
    float3 up = float3(_672.x ? float3(0.0f, 1.0f, 0.0f).x : float3(1.0f, 0.0f, 0.0f).x, _672.y ? float3(0.0f, 1.0f, 0.0f).y : float3(1.0f, 0.0f, 0.0f).y, _672.z ? float3(0.0f, 1.0f, 0.0f).z : float3(1.0f, 0.0f, 0.0f).z);
    float3 param_3 = cross(n, up);
    float3 param_4 = float3(1.0f, 0.0f, 0.0f);
    float3 t1 = safeDir(param_3, param_4);
    float3 param_5 = cross(n, t1);
    float3 param_6 = float3(0.0f, 0.0f, 1.0f);
    float3 t2 = safeDir(param_5, param_6);
    float e = 0.054999999701976776123046875f;
    float3 param_7 = n + (t1 * e);
    float3 param_8 = n;
    float3 param_9 = safeDir(param_7, param_8);
    float3 param_10 = n + (t2 * e);
    float3 param_11 = n;
    float3 param_12 = safeDir(param_10, param_11);
    float3 param_13 = cross(lobeP(param_9) - p, lobeP(param_12) - p);
    float3 param_14 = n;
    float3 nrm = safeDir(param_13, param_14);
    if (dot(nrm, n) < 0.0f)
    {
        nrm = -nrm;
    }
    p += (nrm * aLobeB.w);
    p = (p * aLobeP.w) + aLobeP.xyz;
    float4 wp = mul(float4(p, 1.0f), modelMatrix);
    vWp = wp.xyz;
    float3 param_15 = mul(nrm, float3x3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz));
    float3 param_16 = float3(0.0f, 1.0f, 0.0f);
    vN = safeDir(param_15, param_16);
    float3 param_17 = cameraPosition - wp.xyz;
    float3 param_18 = float3(0.0f, 0.0f, 1.0f);
    vV = safeDir(param_17, param_18);
    gl_Position = mul(wp, mul(viewMatrix, projectionMatrix));
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
    stage_output.vLobe = vLobe;
    stage_output.vWp = vWp;
    stage_output.vN = vN;
    stage_output.vV = vV;
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
    float uNoiseSpeed;
    float3 uShadow;
    float3 uBody;
    float3 uHigh;
    float3 uRimCol;
    float3 uLight;
    float uBands;
    float uBandA;
    float uBandB;
    float uRimPow;
    float uRimAmt;
    float uFlat;
    float uRampKeyMode;
    float uLayerU;
    float uGroundY;
    float uHeightSpan;
    float uUseToon;
    float uToonRamp;
    float uToonShadowScale;
    float uToonHighMix;
    float uRampBlendMode;
    float uRampBlendWeight;
    float uLightOn;
    float uLightFall;
    float3 uLightPos;
    int uBlendMode;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float3 vWp;
static float3 vLobe;
static float4 avfxColor;
static float3 vN;
static float3 vV;

struct SPIRV_Cross_Input
{
    float3 vN : TEXCOORD0;
    float3 vV : TEXCOORD1;
    float3 vWp : TEXCOORD2;
    float3 vLobe : TEXCOORD3;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

float3 safeDirLocal(float3 v)
{
    float l = length(v);
    float3 _114;
    if (l > 9.9999997473787516355514526367188e-06f)
    {
        _114 = v / l.xxx;
    }
    else
    {
        _114 = float3(0.0f, 1.0f, 0.0f);
    }
    return _114;
}

float lobeRampKey(float mode)
{
    float _129;
    if (mode > 2.5f)
    {
        _129 = clamp((vWp.y - uGroundY) / max(uHeightSpan, 0.001000000047497451305389404296875f), 0.0f, 1.0f);
    }
    else
    {
        float _157;
        if ((mode > 0.5f) && (mode < 1.5f))
        {
            _157 = clamp(uLayerU, 0.0f, 1.0f);
        }
        else
        {
            _157 = clamp(vLobe.x, 0.0f, 1.0f);
        }
        _129 = _157;
    }
    return _129;
}

float lobeRampKeyBlended()
{
    float param = uRampKeyMode;
    float key = lobeRampKey(param);
    if (uRampBlendWeight > 0.0f)
    {
        float param_1 = uRampBlendMode;
        key = lerp(key, lobeRampKey(param_1), uRampBlendWeight);
    }
    return key;
}

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
    if (uFlat > 0.5f)
    {
        avfxColor = float4((uShadow * vLobe.y) * vLobe.z, vLobe.z);
        return;
    }
    float3 c;
    if (uUseToon > 0.5f)
    {
        float3 param = vN;
        float3 N = safeDirLocal(param);
        float3 param_1 = uLight;
        float3 L = safeDirLocal(param_1);
        float fall = 1.0f;
        if (uLightOn > 0.5f)
        {
            float3 toLight = uLightPos - vWp;
            float dist = length(toLight);
            float3 param_2 = toLight;
            L = safeDirLocal(param_2);
            fall = 1.0f / (1.0f + (((uLightFall * dist) * uLightFall) * dist));
        }
        float ndl = (dot(N, L) * 0.5f) + 0.5f;
        float3 body = uBody;
        float3 shadow = uShadow;
        float3 high = uHigh;
        if (uToonRamp > 0.5f)
        {
            float param_3 = lobeRampKeyBlended();
            float3 _297 = rampColor(param_3);
            body = _297;
            shadow = lerp(body * uToonShadowScale, uShadow, 0.25f.xxx);
            high = lerp(body, uHigh, uToonHighMix.xxx);
        }
        float3 _321;
        if (uBands > 2.5f)
        {
            float3 _329;
            if (ndl < uBandA)
            {
                _329 = shadow;
            }
            else
            {
                bool3 _342 = (ndl < uBandB).xxx;
                _329 = float3(_342.x ? body.x : high.x, _342.y ? body.y : high.y, _342.z ? body.z : high.z);
            }
            _321 = _329;
        }
        else
        {
            bool3 _352 = (ndl < uBandA).xxx;
            _321 = float3(_352.x ? shadow.x : high.x, _352.y ? shadow.y : high.y, _352.z ? shadow.z : high.z);
        }
        c = _321;
        float3 param_4 = vV;
        c += ((uRimCol * pow(max(1.0f - clamp(dot(N, safeDirLocal(param_4)), 0.0f, 1.0f), 9.9999997473787516355514526367188e-05f), uRimPow)) * uRimAmt);
        c *= lerp(1.0f, fall, step(0.5f, uLightOn));
    }
    else
    {
        float param_5 = lobeRampKeyBlended();
        float3 _388 = rampColor(param_5);
        c = _388;
    }
    c *= vLobe.y;
    if (uBlendMode == 1)
    {
        avfxColor = float4(c, vLobe.z);
    }
    else
    {
        avfxColor = float4(c * vLobe.z, vLobe.z);
    }
}

SPIRV_Cross_Output avfxFragment(SPIRV_Cross_Input stage_input)
{
    vWp = stage_input.vWp;
    vLobe = stage_input.vLobe;
    vN = stage_input.vN;
    vV = stage_input.vV;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }