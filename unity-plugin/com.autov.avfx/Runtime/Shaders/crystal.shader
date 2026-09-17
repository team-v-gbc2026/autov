Shader "autoV/Native/crystal" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float uSpan;
    float uGrowDur;
    float uOvershoot;
    float uInflate;
    float uHasCollapse;
    float uCollapseStart;
    float uCollapseDur;
    float3 uTip;
    float3 uFace;
    float3 uEdge;
    float3 uCam;
    float uFresPow;
    float uGlintFreq;
    float uGlintSpeed;
    float uOpacity;
    float uFlat;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float avfxVertexIndex;
static float3 position;
static float3 normal;
static float3 vN;
static float3 vW;
static float vAlong;
static float vSeed;
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
    float3 vW : TEXCOORD1;
    float vAlong : TEXCOORD2;
    float vSeed : TEXCOORD3;
    float4 gl_Position : SV_Position;
};

static float3 aDir;
static float3 aOrg;
static float aLen;
static float aWid;
static float aT0;
static float aSeed;
static float aAlong;

float3 safeDir(float3 v, float3 fallback)
{
    float l = length(v);
    float3 _22;
    if (l > 9.9999997473787516355514526367188e-06f)
    {
        _22 = v / l.xxx;
    }
    else
    {
        _22 = fallback;
    }
    return _22;
}

void vert_main()
{
    aDir = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 7) + 0) % 1024, ((int(avfxVertexIndex) * 7) + 0) / 1024), 0)).xyz;
    aOrg = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 7) + 1) % 1024, ((int(avfxVertexIndex) * 7) + 1) / 1024), 0)).xyz;
    aLen = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 7) + 2) % 1024, ((int(avfxVertexIndex) * 7) + 2) / 1024), 0)).x;
    aWid = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 7) + 3) % 1024, ((int(avfxVertexIndex) * 7) + 3) / 1024), 0)).x;
    aT0 = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 7) + 4) % 1024, ((int(avfxVertexIndex) * 7) + 4) / 1024), 0)).x;
    aSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 7) + 5) % 1024, ((int(avfxVertexIndex) * 7) + 5) / 1024), 0)).x;
    aAlong = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 7) + 6) % 1024, ((int(avfxVertexIndex) * 7) + 6) / 1024), 0)).x;
    float born = aT0 * uSpan;
    float u = clamp((uTime - born) / max(uGrowDur, 9.9999997473787516355514526367188e-05f), 0.0f, 1.0f);
    float _196;
    if (u >= 1.0f)
    {
        _196 = 1.0f;
    }
    else
    {
        _196 = (u * u) * (((uOvershoot + 1.0f) * u) - uOvershoot);
    }
    float s = _196;
    s = max(s, 0.0f);
    if (uHasCollapse > 0.5f)
    {
        float from = (uCollapseStart * uSpan) + ((aSeed * uCollapseDur) * 1.125f);
        s *= (1.0f - smoothstep(from, from + max(uCollapseDur, 9.9999997473787516355514526367188e-05f), uTime));
    }
    s *= (1.0f + (0.0350000001490116119384765625f * sin((uTime * 2.099999904632568359375f) + (aSeed * 6.283185482025146484375f))));
    float3 param = aDir;
    float3 param_1 = float3(0.0f, 1.0f, 0.0f);
    float3 up = safeDir(param, param_1);
    bool3 _279 = (abs(up.y) > 0.949999988079071044921875f).xxx;
    float3 ref = float3(_279.x ? float3(1.0f, 0.0f, 0.0f).x : float3(0.0f, 1.0f, 0.0f).x, _279.y ? float3(1.0f, 0.0f, 0.0f).y : float3(0.0f, 1.0f, 0.0f).y, _279.z ? float3(1.0f, 0.0f, 0.0f).z : float3(0.0f, 1.0f, 0.0f).z);
    float3 param_2 = cross(ref, up);
    float3 param_3 = float3(1.0f, 0.0f, 0.0f);
    float3 rt = safeDir(param_2, param_3);
    float3 fw = cross(up, rt);
    float tw = aSeed * 6.283185482025146484375f;
    float ct = cos(tw);
    float st = sin(tw);
    float2 pxz = float2((position.x * ct) - (position.z * st), (position.x * st) + (position.z * ct));
    float2 nxz = float2((normal.x * ct) - (normal.z * st), (normal.x * st) + (normal.z * ct));
    float L = aLen * s;
    float W = aWid * (0.3499999940395355224609375f + (0.64999997615814208984375f * s));
    float3 lp = float3(pxz.x * W, position.y * L, pxz.y * W);
    float3 param_4 = float3(pxz.x, position.y * 0.25f, pxz.y);
    float3 param_5 = float3(0.0f, 1.0f, 0.0f);
    lp += ((safeDir(param_4, param_5) * uInflate) * (0.60000002384185791015625f + (0.4000000059604644775390625f * s)));
    float3 wp = ((aOrg + (rt * lp.x)) + (up * lp.y)) + (fw * lp.z);
    float3 param_6 = float3(nxz.x * L, normal.y * W, nxz.y * L);
    float3 param_7 = float3(0.0f, 1.0f, 0.0f);
    float3 ln = safeDir(param_6, param_7);
    float3 param_8 = ((rt * ln.x) + (up * ln.y)) + (fw * ln.z);
    float3 param_9 = up;
    vN = safeDir(param_8, param_9);
    float4 world = mul(float4(wp, 1.0f), modelMatrix);
    vW = world.xyz;
    vAlong = aAlong;
    vSeed = aSeed;
    gl_Position = mul(world, mul(viewMatrix, projectionMatrix));
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
    stage_output.vN = vN;
    stage_output.vW = vW;
    stage_output.vAlong = vAlong;
    stage_output.vSeed = vSeed;
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
    float uSpan;
    float uGrowDur;
    float uOvershoot;
    float uInflate;
    float uHasCollapse;
    float uCollapseStart;
    float uCollapseDur;
    float3 uTip;
    float3 uFace;
    float3 uEdge;
    float3 uCam;
    float uFresPow;
    float uGlintFreq;
    float uGlintSpeed;
    float uOpacity;
    float uFlat;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float vAlong;
static float4 avfxColor;
static float3 vN;
static float3 vW;
static float vSeed;

struct SPIRV_Cross_Input
{
    float3 vN : TEXCOORD0;
    float3 vW : TEXCOORD1;
    float vAlong : TEXCOORD2;
    float vSeed : TEXCOORD3;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

float3 safeDir(float3 v, float3 fallback)
{
    float l = length(v);
    float3 _445;
    if (l > 9.9999997473787516355514526367188e-06f)
    {
        _445 = v / l.xxx;
    }
    else
    {
        _445 = fallback;
    }
    return _445;
}

float safePow(float base, float e)
{
    return pow(max(base, 9.9999997473787516355514526367188e-06f), e);
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

void frag_main()
{
    if (uFlat > 0.5f)
    {
        float3 c = lerp(uEdge * 0.1599999964237213134765625f, uEdge * 0.550000011920928955078125f, smoothstep(0.0500000007450580596923828125f, 0.85000002384185791015625f, vAlong).xxx);
        avfxColor = float4(c * uOpacity, uOpacity);
        return;
    }
    float3 param = vN;
    float3 param_1 = float3(0.0f, 1.0f, 0.0f);
    float3 n = safeDir(param, param_1);
    float3 param_2 = uCam - vW;
    float3 param_3 = float3(0.0f, 0.0f, 1.0f);
    float3 v = safeDir(param_2, param_3);
    float ndv = abs(dot(n, v));
    float param_4 = 1.0f - ndv;
    float param_5 = uFresPow;
    float fres = safePow(param_4, param_5);
    float lam = 0.4199999868869781494140625f + (0.579999983310699462890625f * clamp((dot(n, float3(0.24603392183780670166015625f, 0.885722100734710693359375f, 0.3936542570590972900390625f)) * 0.5f) + 0.5f, 0.0f, 1.0f));
    float3 col = uFace * (0.300000011920928955078125f + (0.5f * lam));
    float tip = smoothstep(0.180000007152557373046875f, 0.920000016689300537109375f, vAlong);
    col = lerp(col, uTip * 1.2999999523162841796875f, (tip * 0.939999997615814208984375f).xxx);
    col *= lerp(1.0f, 0.550000011920928955078125f, tip);
    col = lerp(col, uEdge, ((fres * 0.300000011920928955078125f) * (1.0f - (tip * 0.550000011920928955078125f))).xxx);
    float gb = sin((((vAlong * uGlintFreq) - (uTime * uGlintSpeed)) + (vSeed * 6.283185482025146484375f)) * 3.1415927410125732421875f);
    float param_6 = max(gb, 0.0f);
    float param_7 = 22.0f;
    col += (((uEdge * safePow(param_6, param_7)) * (0.3499999940395355224609375f + (0.64999997615814208984375f * fres))) * 0.89999997615814208984375f);
    float3 param_8 = float3((vAlong * 9.0f) + (vSeed * 17.0f), (vSeed * 31.0f) + (vW.y * 4.0f), 1.7000000476837158203125f);
    float ice = 0.5f + (0.5f * fbm3(param_8));
    col *= ((0.87999999523162841796875f + (0.2599999904632568359375f * ice)) * (0.7200000286102294921875f + (0.560000002384185791015625f * frac((vSeed * 13.69999980926513671875f) + 2.099999904632568359375f))));
    float param_9 = 1.0f - ndv;
    float param_10 = 3.0f;
    col += ((uTip * safePow(param_9, param_10)) * 0.60000002384185791015625f);
    float a = clamp(0.800000011920928955078125f + (fres * 0.20000000298023223876953125f), 0.0f, 1.0f) * uOpacity;
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
    vAlong = stage_input.vAlong;
    vN = stage_input.vN;
    vW = stage_input.vW;
    vSeed = stage_input.vSeed;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }
