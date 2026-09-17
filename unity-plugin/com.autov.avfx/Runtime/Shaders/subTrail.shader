Shader "autoV/Native/subTrail" { Properties { uTrail ("uTrail", 2D) = "white" {} avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend], One [_DstBlend]
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
    uniform float uSegments;
    uniform float uSpacing;
    uniform float uSpan;
    uniform float uTwinkleFreq;
    uniform float uTwinkleDepth;
    uniform int uHasAlphaSpawn;
    uniform float2 uSize;
    uniform int uEPathType;
    uniform float3 uEPathA;
    uniform float3 uEPathB;
    uniform float3 uEPathC;
    uniform float4 uEPathD;
    uniform float2 uEPathW;
    uniform float4 uCurveA[8];
    uniform int uCurveAN;
    uniform float uCurveAEase;
    uniform float4 uCurveB[8];
    uniform int uCurveBN;
    uniform float uCurveBEase;
    uniform float4 uCurveD[8];
    uniform int uCurveDN;
    uniform float uCurveDEase;
    uniform float4 uCurveE[8];
    uniform int uCurveEN;
    uniform float uCurveEEase;
    uniform float4 uCurveG[8];
    uniform int uCurveGN;
    uniform float uCurveGEase;
    uniform float4 uCurveH[8];
    uniform int uCurveHN;
    uniform float uCurveHEase;
    uniform float4 uCurveT[8];
    uniform int uCurveTN;
    uniform float uCurveTEase;
    uniform float uPeriod;
    uniform float uSpawnWindow;
    uniform float uSpawnDuration;
    uniform float uShapeLength;
    uniform float uShapeRadius;
    uniform float uShapeInner;
    uniform float uShapeAngle;
    uniform float uDrag;
    uniform float uCurl;
    uniform float uCurlFreq;
    uniform float uCurlSpeed;
    uniform float uFloorY;
    uniform float uFloorSoft;
    uniform float uAngle;
    uniform float uPlanarDrag;
    uniform float uVortexW;
    uniform float uVortexFalloff;
    uniform int uSpawnMode;
    uniform int uShapeType;
    uniform int uVelMode;
    uniform int uHasFloor;
    uniform int uSurfaceOnly;
    uniform int uSpeedN;
    uniform int uBurstN;
    uniform float3 uAxis;
    uniform float3 uDir;
    uniform float3 uGravity;
    uniform float3 uWind;
    uniform float3 uBias;
    uniform float3 uShapeSize;
    uniform float3 uVortexAxis;
    uniform float2 uLife;
    uniform float2 uSpeed;
    uniform float4 uSpeedKey[8];
    uniform float4 uBurstT[8];
    uniform float4 uBurstC[8];
    uniform float uInterior;
    uniform float uAngleJitter;
    uniform float uAngleBias;
    uniform float3 uFrontC;
    uniform float3 uFrontEx;
    uniform float3 uFrontEy;
    uniform float3 uFrontN;
    uniform float uFrontR;
    uniform float uFrontPh0;
    uniform float uFrontSweep;
    uniform float uFrontSpan;
    uniform float uFrontStart;
    uniform float uParentPeriod;
    uniform float uParentSpawnWindow;
    uniform float uParentSpawnDuration;
    uniform float uParentShapeLength;
    uniform float uParentShapeRadius;
    uniform float uParentShapeInner;
    uniform float uParentShapeAngle;
    uniform float uParentDrag;
    uniform float uParentCurl;
    uniform float uParentCurlFreq;
    uniform float uParentCurlSpeed;
    uniform float uParentFloorY;
    uniform float uParentFloorSoft;
    uniform float uParentAngle;
    uniform float uParentPlanarDrag;
    uniform float uParentVortexW;
    uniform float uParentVortexFalloff;
    uniform int uParentSpawnMode;
    uniform int uParentShapeType;
    uniform int uParentVelMode;
    uniform int uParentHasFloor;
    uniform int uParentSurfaceOnly;
    uniform int uParentSpeedN;
    uniform int uParentBurstN;
    uniform float3 uParentAxis;
    uniform float3 uParentDir;
    uniform float3 uParentGravity;
    uniform float3 uParentWind;
    uniform float3 uParentBias;
    uniform float3 uParentShapeSize;
    uniform float3 uParentVortexAxis;
    uniform float2 uParentLife;
    uniform float2 uParentSpeed;
    uniform float4 uParentSpeedKey[8];
    uniform float4 uParentBurstT[8];
    uniform float4 uParentBurstC[8];
    uniform float uParentInterior;
    uniform float uParentAngleJitter;
    uniform float uParentAngleBias;
    uniform float uParentTimeShift;
    uniform float uInherit;
    uniform float uPathT0;
    uniform float uPathDt;
    uniform int uSubMode;
    uniform float2 uSubOffset;
    uniform float4 uParentPath[8];
    uniform int uHasTrail;
    uniform int uBlendMode;
    uniform float uOpacity;
    uniform float uFlicker;
    uniform float uTrailRampMode;
    uniform float4 uRamp[6];
    uniform float4 uRampT[6];
    uniform int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;
Texture2D<float4> uTrail;
SamplerState sampleruTrail;

static float4 gl_Position;
static float vAlpha;
static float vU;
static float2 vUv;
static float3 vWp;
static float avfxVertexIndex;
static float3 vSeed;
static float3 position;
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
    float vU : TEXCOORD1;
    float vAlpha : TEXCOORD2;
    float3 vSeed : TEXCOORD3;
    float3 vWp : TEXCOORD4;
    float4 gl_Position : SV_Position;
};

static float4 aSeed;
static float4 aExtra;
static float4 aExtra2;
static float aIndex;
static float4 aPSeed;
static float4 aPExtra;
static float4 aPExtra2;
static float3 aSrcPos;
static float3 aSrcDir;
static float4 aEvent;

float selfLife(float4 s)
{
    return lerp(uLife.x, uLife.y, s.y);
}

float parentLife(float4 s)
{
    return lerp(uParentLife.x, uParentLife.y, s.y);
}

float parentBirth(float4 s, float t, float4 ev, float idx)
{
    float instance = s.x;
    float birth = instance * uParentSpawnWindow;
    if (uParentSpawnMode == 1)
    {
        float cycle = floor((t - birth) / max(uParentPeriod, 9.9999997473787516355514526367188e-05f));
        float absBirth = birth + (cycle * uParentPeriod);
        bool _2707 = absBirth < 0.0f;
        bool _2716;
        if (!_2707)
        {
            _2716 = absBirth > uParentSpawnDuration;
        }
        else
        {
            _2716 = _2707;
        }
        if (_2716)
        {
            return 1000000000.0f;
        }
        return absBirth;
    }
    if (uParentSpawnMode == 2)
    {
        float t0 = uParentBurstT[0].x;
        for (int i = 0; i < 8; i++)
        {
            if (i >= uParentBurstN)
            {
                break;
            }
            if (instance <= uParentBurstC[i].x)
            {
                t0 = uParentBurstT[i].x;
                break;
            }
        }
        return t0 + (frac((instance * 7.13000011444091796875f) + 0.37000000476837158203125f) * uParentSpawnWindow);
    }
    return birth;
}

float safePow(float base, float e)
{
    return pow(max(base, 9.9999997473787516355514526367188e-06f), e);
}

float3 safeDir(float3 v, float3 fallback)
{
    float l = length(v);
    float3 _655;
    if (l > 9.9999997473787516355514526367188e-06f)
    {
        _655 = v / l.xxx;
    }
    else
    {
        _655 = fallback;
    }
    return _655;
}

float3 orthoOf(float3 a)
{
    float3 _678;
    if (abs(a.y) < 0.89999997615814208984375f)
    {
        _678 = cross(a, float3(0.0f, 1.0f, 0.0f));
    }
    else
    {
        _678 = cross(a, float3(1.0f, 0.0f, 0.0f));
    }
    float3 param = _678;
    float3 param_1 = float3(1.0f, 0.0f, 0.0f);
    return safeDir(param, param_1);
}

float3 parentOrigin(float4 s, float4 e, float4 e2, float3 srcPos, float4 ev, float idx)
{
    float ca = e.x * 6.283185482025146484375f;
    float cz = (e.y * 2.0f) - 1.0f;
    float cr = sqrt(max(0.0f, 1.0f - (cz * cz)));
    float3 unit = float3(cr * cos(ca), cz, cr * sin(ca));
    float _2809;
    if (uParentSurfaceOnly == 1)
    {
        _2809 = 1.0f;
    }
    else
    {
        float param = e.z;
        float param_1 = 0.5f;
        _2809 = safePow(param, param_1);
    }
    float fill = _2809;
    float3 sph = unit * fill;
    sph = lerp(sph, abs(sph), clamp(uParentBias, 0.0f.xxx, 1.0f.xxx));
    float3 param_2 = uParentAxis;
    float3 param_3 = float3(0.0f, 1.0f, 0.0f);
    float3 axis = safeDir(param_2, param_3);
    float3 param_4 = axis;
    float3 a1 = orthoOf(param_4);
    float3 a2 = cross(axis, a1);
    if (uParentShapeType == 0)
    {
        return 0.0f.xxx;
    }
    if (uParentShapeType == 1)
    {
        return sph * uParentShapeRadius;
    }
    if (uParentShapeType == 2)
    {
        return float3(sph.x, abs(sph.y), sph.z) * uParentShapeRadius;
    }
    if (uParentShapeType == 3)
    {
        float h = e.w * uParentShapeLength;
        float rr = uParentShapeRadius + (h * tan(min(uParentShapeAngle, 1.5f)));
        float param_5 = e.z;
        float param_6 = 0.5f;
        return (axis * h) + ((((a1 * cos(ca)) + (a2 * sin(ca))) * rr) * safePow(param_5, param_6));
    }
    if (uParentShapeType == 4)
    {
        return ((a1 * cos(ca)) + (a2 * sin(ca))) * uParentShapeRadius;
    }
    if (uParentShapeType == 5)
    {
        float param_7 = e.z;
        float param_8 = 0.5f;
        float rr_1 = lerp(uParentShapeInner, uParentShapeRadius, safePow(param_7, param_8));
        return ((a1 * cos(ca)) + (a2 * sin(ca))) * rr_1;
    }
    if (uParentShapeType == 6)
    {
        return (float3((e.x * 2.0f) - 1.0f, (e.y * 2.0f) - 1.0f, (e.z * 2.0f) - 1.0f) * uParentShapeSize) * 0.5f;
    }
    if (uParentShapeType == 11)
    {
        float2 H = float2(uParentShapeRadius, uParentShapeLength * 0.5f);
        float2 pt;
        float2 nrm;
        if (e.w < uParentInterior)
        {
            pt = float2((((e.x * 2.0f) - 1.0f) * H.x) * 0.87999999523162841796875f, (((e.y * 2.0f) - 1.0f) * H.y) * 0.89999997615814208984375f);
            nrm = normalize(pt + 9.9999997473787516355514526367188e-05f.xx);
        }
        else
        {
            float per = (2.0f * H.x) + (2.0f * H.y);
            float sgn = (e.z < 0.5f) ? (-1.0f) : 1.0f;
            float dd = e.x * per;
            if (dd < H.x)
            {
                pt = float2(dd, -H.y);
                nrm = float2(0.0f, -1.0f);
            }
            else
            {
                if (dd < (H.x + (2.0f * H.y)))
                {
                    pt = float2(H.x, (-H.y) + (dd - H.x));
                    nrm = float2(1.0f, 0.0f);
                }
                else
                {
                    pt = float2(H.x - ((dd - H.x) - (2.0f * H.y)), H.y);
                    nrm = float2(0.0f, 1.0f);
                }
            }
            pt.x *= sgn;
            nrm.x *= sgn;
            pt += ((nrm * (e.y - 0.300000011920928955078125f)) * uParentShapeInner);
        }
        return ((a1 * pt.x) + (a2 * pt.y)) + ((axis * (e.z - 0.5f)) * uParentShapeInner);
    }
    if (uParentShapeType == 13)
    {
        float bias = clamp(uParentAngleBias, -1.0f, 1.0f);
        float ang = (((idx * 6.283185482025146484375f) * (1.0f - (0.25f * abs(bias)))) + (bias * 1.5707962512969970703125f)) + ((e.x - 0.5f) * uParentAngleJitter);
        return ((a1 * cos(ang)) + (a2 * sin(ang))) * uParentShapeRadius;
    }
    if (uParentShapeType == 12)
    {
        float rr_2 = lerp(uParentShapeInner, uParentShapeRadius, sqrt(e.z));
        return ((a1 * cos(ca)) + (a2 * sin(ca))) * rr_2;
    }
    return (axis * (uParentShapeLength * e.w)) + (sph * uParentShapeRadius);
}

float3 parentDir(float4 s, float4 e, float4 e2, float3 origin, float3 srcDir)
{
    float3 param = uParentAxis;
    float3 param_1 = float3(0.0f, 1.0f, 0.0f);
    float3 axis = safeDir(param, param_1);
    float3 param_2 = uParentDir;
    float3 param_3 = float3(0.0f, 1.0f, 0.0f);
    float3 base = safeDir(param_2, param_3);
    float3 param_4 = origin;
    float3 param_5 = axis;
    float3 radial = safeDir(param_4, param_5);
    if (uParentVelMode == 0)
    {
        float3 param_6 = origin;
        float3 param_7 = radial;
        return safeDir(param_6, param_7);
    }
    if (uParentVelMode == 1)
    {
        return base;
    }
    if (uParentVelMode == 2)
    {
        float3 param_8 = cross(axis, radial);
        float3 param_9 = base;
        return safeDir(param_8, param_9);
    }
    float3 param_10 = base;
    float3 t1 = orthoOf(param_10);
    float3 t2 = cross(base, t1);
    float ph = s.z * 6.283185482025146484375f;
    float cone = s.w * uParentAngle;
    float3 param_11 = base + (((t1 * cos(ph)) + (t2 * sin(ph))) * cone);
    float3 param_12 = base;
    return safeDir(param_11, param_12);
}

float parentSpeedI(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float acc = min(u, uParentSpeedKey[0].xy.x) * uParentSpeedKey[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uParentSpeedN)
        {
            break;
        }
        float a = uParentSpeedKey[i - 1].xy.x;
        float b = uParentSpeedKey[i].xy.x;
        float va = uParentSpeedKey[i - 1].xy.y;
        float vb = uParentSpeedKey[i].xy.y;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        acc += (((b - a) * f) * (va + (((vb - va) * f) * 0.5f)));
        if (i == (uParentSpeedN - 1))
        {
            acc += (max(u - b, 0.0f) * vb);
        }
    }
    return acc;
}

float parentSpeedAt(inout float u)
{
    if (uParentSpeedN < 2)
    {
        return 1.0f;
    }
    u = clamp(u, 0.0f, 1.0f);
    float v = uParentSpeedKey[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uParentSpeedN)
        {
            break;
        }
        float a = uParentSpeedKey[i - 1].xy.x;
        float b = uParentSpeedKey[i].xy.x;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        v = lerp(v, uParentSpeedKey[i].xy.y, step(a, u) * f);
    }
    return v;
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

float3 curl3(float3 p)
{
    float e = 0.100000001490116119384765625f;
    float3 dx = float3(e, 0.0f, 0.0f);
    float3 dy = float3(0.0f, e, 0.0f);
    float3 dz = float3(0.0f, 0.0f, e);
    float3 param = p + dy;
    float3 param_1 = p - dy;
    float dady = snoise(param) - snoise(param_1);
    float3 param_2 = p + dz;
    float3 param_3 = p - dz;
    float dadz = snoise(param_2) - snoise(param_3);
    float3 param_4 = (p + dx) + 31.3999996185302734375f.xxx;
    float3 param_5 = (p - dx) + 31.3999996185302734375f.xxx;
    float dbdx = snoise(param_4) - snoise(param_5);
    float3 param_6 = (p + dz) + 31.3999996185302734375f.xxx;
    float3 param_7 = (p - dz) + 31.3999996185302734375f.xxx;
    float dbdz = snoise(param_6) - snoise(param_7);
    float3 param_8 = (p + dx) - 17.200000762939453125f.xxx;
    float3 param_9 = (p - dx) - 17.200000762939453125f.xxx;
    float dcdx = snoise(param_8) - snoise(param_9);
    float3 param_10 = (p + dy) - 17.200000762939453125f.xxx;
    float3 param_11 = (p - dy) - 17.200000762939453125f.xxx;
    float dcdy = snoise(param_10) - snoise(param_11);
    return float3(dcdy - dbdz, dadz - dcdx, dbdx - dady) / (2.0f * e).xxx;
}

void parentTraj(float4 s, float4 e, float4 e2, float3 srcPos, float3 srcDir, float4 ev, float idx, float age, float life, float t, inout float3 pos, inout float3 vel)
{
    float4 param = s;
    float4 param_1 = e;
    float4 param_2 = e2;
    float3 param_3 = srcPos;
    float4 param_4 = ev;
    float param_5 = idx;
    float3 origin = parentOrigin(param, param_1, param_2, param_3, param_4, param_5);
    float4 param_6 = s;
    float4 param_7 = e;
    float4 param_8 = e2;
    float3 param_9 = origin;
    float3 param_10 = srcDir;
    float3 dir = parentDir(param_6, param_7, param_8, param_9, param_10);
    float a = max(age, 0.0f);
    float u = clamp(a / max(life, 9.9999997473787516355514526367188e-05f), 0.0f, 1.0f);
    if (uParentVelMode == 5)
    {
        float3 param_11 = uParentAxis;
        float3 param_12 = float3(0.0f, 1.0f, 0.0f);
        float3 ax = safeDir(param_11, param_12);
        float h = dot(origin, ax);
        float3 rad = origin - (ax * h);
        float r = max(length(rad), 9.9999997473787516355514526367188e-05f);
        float param_13 = r / max(uParentShapeRadius, 0.001000000047497451305389404296875f);
        float param_14 = -0.5f;
        float w = uParentSpeed.y * safePow(param_13, param_14);
        float ang = w * a;
        float c = cos(ang);
        float sn = sin(ang);
        float3 turned = (rad * c) + (cross(ax, rad) * sn);
        float bob = ((e2.w - 0.5f) * uParentSpeed.x) * sin((a * (0.60000002384185791015625f + (1.2000000476837158203125f * e2.x))) + (e.x * 6.283185482025146484375f));
        pos = turned + (ax * (h + bob));
        vel = cross(ax, turned) * w;
        if (uParentHasFloor == 1)
        {
            float dy = pos.y - uParentFloorY;
            pos.y = uParentFloorY + max(dy, dy * uParentFloorSoft);
        }
        return;
    }
    float v0 = lerp(uParentSpeed.x, uParentSpeed.y, e2.w);
    float d;
    float scale;
    if (uParentSpeedN > 1)
    {
        float param_15 = u;
        float _3635 = parentSpeedI(param_15);
        d = life * _3635;
        float param_16 = u;
        float _3640 = parentSpeedAt(param_16);
        scale = _3640;
    }
    else
    {
        float _3646;
        if (uParentDrag < 0.001000000047497451305389404296875f)
        {
            _3646 = a;
        }
        else
        {
            _3646 = (1.0f - exp((-uParentDrag) * a)) / uParentDrag;
        }
        d = _3646;
        scale = exp((-uParentDrag) * a);
    }
    pos = ((origin + ((dir * v0) * d)) + (((uParentGravity * 0.5f) * a) * a)) + (uParentWind * a);
    vel = (((dir * v0) * scale) + (uParentGravity * a)) + uParentWind;
    if (uParentPlanarDrag > 0.0f)
    {
        float dp = (1.0f - exp((-uParentPlanarDrag) * a)) / uParentPlanarDrag;
        float sp = exp((-uParentPlanarDrag) * a);
        float3 flat_ = (origin + ((dir * v0) * dp)) + (uParentWind * a);
        pos = float3(flat_.xz.x, pos.y, flat_.xz.y);
        float2 _3752 = (((dir * v0) * sp) + uParentWind).xz;
        vel = float3(_3752.x, vel.y, _3752.y);
    }
    if (abs(uParentVortexW) > 9.9999997473787516355514526367188e-06f)
    {
        float3 param_17 = uParentVortexAxis;
        float3 param_18 = float3(0.0f, 1.0f, 0.0f);
        float3 ax_1 = safeDir(param_17, param_18);
        float h_1 = dot(pos, ax_1);
        float3 rad_1 = pos - (ax_1 * h_1);
        float r_1 = length(rad_1);
        if (r_1 > 9.9999997473787516355514526367188e-06f)
        {
            float w_1 = uParentVortexW / (1.0f + (uParentVortexFalloff * r_1));
            float ang_1 = w_1 * a;
            float c_1 = cos(ang_1);
            float sn_1 = sin(ang_1);
            pos = ((ax_1 * h_1) + (rad_1 * c_1)) + (cross(ax_1, rad_1) * sn_1);
            vel = (vel * c_1) + (cross(ax_1, vel) * sn_1);
        }
    }
    if (uParentCurl > 0.0f)
    {
        float3 param_19 = ((pos * uParentCurlFreq) + float3(0.0f, (-t) * uParentCurlSpeed, 0.0f)) + (e2.xyz * 3.0f);
        float3 c_2 = curl3(param_19);
        pos += (((c_2 * uParentCurl) * 1.0f) * a);
    }
    if (uParentHasFloor == 1)
    {
        float dy_1 = pos.y - uParentFloorY;
        pos.y = uParentFloorY + max(dy_1, dy_1 * uParentFloorSoft);
    }
}

float3 parentPathAt(float t)
{
    float x = clamp((t - uPathT0) / max(uPathDt, 9.9999997473787516355514526367188e-05f), 0.0f, 7.0f);
    float i0 = floor(x);
    float f = x - i0;
    float3 a = 0.0f.xxx;
    float3 b = 0.0f.xxx;
    for (int i = 0; i < 8; i++)
    {
        float fi = float(i);
        a += (uParentPath[i].xyz * step(abs(fi - i0), 0.5f));
        b += (uParentPath[i].xyz * step(abs(fi - min(i0 + 1.0f, 7.0f)), 0.5f));
    }
    return lerp(a, b, f.xxx);
}

void kill()
{
    gl_Position = float4(2.0f, 2.0f, 2.0f, 1.0f);
    vAlpha = 0.0f;
    vU = 0.0f;
    vUv = 0.0f.xx;
    vWp = 0.0f.xxx;
}

float3 frontPoint(float sArc)
{
    float ph = uFrontPh0 + (sArc * uFrontSweep);
    return uFrontC + (((uFrontEx * cos(ph)) + (uFrontEy * sin(ph))) * uFrontR);
}

float3 pathPointE(float u)
{
    if (uEPathType == 1)
    {
        float m = 1.0f - u;
        return ((uEPathA * (m * m)) + (uEPathB * ((2.0f * m) * u))) + (uEPathC * (u * u));
    }
    float th = ((6.283185482025146484375f * uEPathD.z) * u) + uEPathD.w;
    float r = uEPathD.x + (uEPathW.x * sin(uEPathW.y * th));
    float y = (uEPathA.y + (uEPathD.y * u)) + ((uEPathW.x * 0.5f) * sin(((uEPathW.y * th) * 2.0f) + 1.2999999523162841796875f));
    return float3(uEPathA.x + (cos(th) * r), y, uEPathA.z + (sin(th) * r));
}

float3 pathTangentE(float u)
{
    float param = u + 0.001000000047497451305389404296875f;
    float param_1 = u - 0.001000000047497451305389404296875f;
    float3 d = pathPointE(param) - pathPointE(param_1);
    float l = length(d);
    float3 _835;
    if (l > 9.9999999747524270787835121154785e-07f)
    {
        _835 = d / l.xxx;
    }
    else
    {
        _835 = float3(0.0f, 0.0f, 1.0f);
    }
    return _835;
}

float3 pathSideE(float u)
{
    float param = u;
    return normalize(cross(pathTangentE(param), float3(0.0f, 1.0f, 0.0f)) + float3(9.9999997473787516355514526367188e-06f, 0.0f, 0.0f));
}

float3 pathUpE(float u)
{
    float param = u;
    float param_1 = u;
    return normalize(cross(pathSideE(param), pathTangentE(param_1)));
}

float3 selfOrigin(float4 s, float4 e, float4 e2, float3 srcPos, float4 ev, float idx)
{
    float ca = e.x * 6.283185482025146484375f;
    float cz = (e.y * 2.0f) - 1.0f;
    float cr = sqrt(max(0.0f, 1.0f - (cz * cz)));
    float3 unit = float3(cr * cos(ca), cz, cr * sin(ca));
    float _1310;
    if (uSurfaceOnly == 1)
    {
        _1310 = 1.0f;
    }
    else
    {
        float param = e.z;
        float param_1 = 0.5f;
        _1310 = safePow(param, param_1);
    }
    float fill = _1310;
    float3 sph = unit * fill;
    sph = lerp(sph, abs(sph), clamp(uBias, 0.0f.xxx, 1.0f.xxx));
    float3 param_2 = uAxis;
    float3 param_3 = float3(0.0f, 1.0f, 0.0f);
    float3 axis = safeDir(param_2, param_3);
    float3 param_4 = axis;
    float3 a1 = orthoOf(param_4);
    float3 a2 = cross(axis, a1);
    if (uShapeType == 0)
    {
        return 0.0f.xxx;
    }
    if (uShapeType == 1)
    {
        return sph * uShapeRadius;
    }
    if (uShapeType == 2)
    {
        return float3(sph.x, abs(sph.y), sph.z) * uShapeRadius;
    }
    if (uShapeType == 3)
    {
        float h = e.w * uShapeLength;
        float rr = uShapeRadius + (h * tan(min(uShapeAngle, 1.5f)));
        float param_5 = e.z;
        float param_6 = 0.5f;
        return (axis * h) + ((((a1 * cos(ca)) + (a2 * sin(ca))) * rr) * safePow(param_5, param_6));
    }
    if (uShapeType == 4)
    {
        return ((a1 * cos(ca)) + (a2 * sin(ca))) * uShapeRadius;
    }
    if (uShapeType == 5)
    {
        float param_7 = e.z;
        float param_8 = 0.5f;
        float rr_1 = lerp(uShapeInner, uShapeRadius, safePow(param_7, param_8));
        return ((a1 * cos(ca)) + (a2 * sin(ca))) * rr_1;
    }
    if (uShapeType == 6)
    {
        return (float3((e.x * 2.0f) - 1.0f, (e.y * 2.0f) - 1.0f, (e.z * 2.0f) - 1.0f) * uShapeSize) * 0.5f;
    }
    if (uShapeType == 11)
    {
        float2 H = float2(uShapeRadius, uShapeLength * 0.5f);
        float2 pt;
        float2 nrm;
        if (e.w < uInterior)
        {
            pt = float2((((e.x * 2.0f) - 1.0f) * H.x) * 0.87999999523162841796875f, (((e.y * 2.0f) - 1.0f) * H.y) * 0.89999997615814208984375f);
            nrm = normalize(pt + 9.9999997473787516355514526367188e-05f.xx);
        }
        else
        {
            float per = (2.0f * H.x) + (2.0f * H.y);
            float sgn = (e.z < 0.5f) ? (-1.0f) : 1.0f;
            float dd = e.x * per;
            if (dd < H.x)
            {
                pt = float2(dd, -H.y);
                nrm = float2(0.0f, -1.0f);
            }
            else
            {
                if (dd < (H.x + (2.0f * H.y)))
                {
                    pt = float2(H.x, (-H.y) + (dd - H.x));
                    nrm = float2(1.0f, 0.0f);
                }
                else
                {
                    pt = float2(H.x - ((dd - H.x) - (2.0f * H.y)), H.y);
                    nrm = float2(0.0f, 1.0f);
                }
            }
            pt.x *= sgn;
            nrm.x *= sgn;
            pt += ((nrm * (e.y - 0.300000011920928955078125f)) * uShapeInner);
        }
        return ((a1 * pt.x) + (a2 * pt.y)) + ((axis * (e.z - 0.5f)) * uShapeInner);
    }
    if (uShapeType == 13)
    {
        float bias = clamp(uAngleBias, -1.0f, 1.0f);
        float ang = (((idx * 6.283185482025146484375f) * (1.0f - (0.25f * abs(bias)))) + (bias * 1.5707962512969970703125f)) + ((e.x - 0.5f) * uAngleJitter);
        return ((a1 * cos(ang)) + (a2 * sin(ang))) * uShapeRadius;
    }
    if (uShapeType == 12)
    {
        float rr_2 = lerp(uShapeInner, uShapeRadius, sqrt(e.z));
        return ((a1 * cos(ca)) + (a2 * sin(ca))) * rr_2;
    }
    if (uSpawnMode == 5)
    {
        float param_9 = s.x;
        return (frontPoint(param_9) + ((uFrontN * (e.z - 0.5f)) * uShapeRadius)) + ((sph * uShapeRadius) * 0.4000000059604644775390625f);
    }
    if (uShapeType == 8)
    {
        float param_10 = idx;
        float3 tg = pathTangentE(param_10);
        float param_11 = idx;
        float3 sd = pathSideE(param_11);
        float param_12 = idx;
        float3 upn = pathUpE(param_12);
        float param_13 = idx;
        return (pathPointE(param_13) + (((sd * (e.x - 0.5f)) * 2.0f) * uShapeRadius)) + (((upn * (e.y - 0.5f)) * 1.5f) * uShapeRadius);
    }
    if (uShapeType == 10)
    {
        float pu = frac((s.z * 7.309999942779541015625f) + (s.w * 3.1700000762939453125f));
        float param_14 = pu;
        float3 tg_1 = pathTangentE(param_14);
        float param_15 = pu;
        float3 sd_1 = pathSideE(param_15);
        float param_16 = pu;
        float3 upn_1 = pathUpE(param_16);
        float param_17 = pu;
        return ((pathPointE(param_17) + (((sd_1 * (e.x - 0.5f)) * 2.0f) * uShapeRadius)) + (((upn_1 * (e.y - 0.5f)) * 2.0f) * uShapeRadius)) + ((tg_1 * (e.z - 0.5f)) * uShapeRadius);
    }
    if (uSpawnMode == 4)
    {
        return ev.xyz + (sph * uShapeRadius);
    }
    if (uShapeType == 9)
    {
        return srcPos + (sph * uShapeRadius);
    }
    return (axis * (uShapeLength * e.w)) + (sph * uShapeRadius);
}

float3 frontTangent(float sArc)
{
    float ph = uFrontPh0 + (sArc * uFrontSweep);
    float3 param = ((-uFrontEx) * sin(ph)) + (uFrontEy * cos(ph));
    float3 param_1 = float3(1.0f, 0.0f, 0.0f);
    return safeDir(param, param_1);
}

float3 selfDir(float4 s, float4 e, float4 e2, float3 origin, float3 srcDir)
{
    float3 param = uAxis;
    float3 param_1 = float3(0.0f, 1.0f, 0.0f);
    float3 axis = safeDir(param, param_1);
    float3 param_2 = uDir;
    float3 param_3 = float3(0.0f, 1.0f, 0.0f);
    float3 base = safeDir(param_2, param_3);
    float3 param_4 = origin;
    float3 param_5 = axis;
    float3 radial = safeDir(param_4, param_5);
    bool _1930 = uShapeType == 9;
    bool _1937;
    if (_1930)
    {
        _1937 = uVelMode == 0;
    }
    else
    {
        _1937 = _1930;
    }
    if (_1937)
    {
        float3 param_6 = srcDir;
        float3 param_7 = base;
        return safeDir(param_6, param_7);
    }
    bool _1948 = uSpawnMode == 5;
    bool _1954;
    if (_1948)
    {
        _1954 = uVelMode == 0;
    }
    else
    {
        _1954 = _1948;
    }
    if (_1954)
    {
        float param_8 = s.x;
        float3 param_9 = -frontTangent(param_8);
        float3 param_10 = base;
        return safeDir(param_9, param_10);
    }
    if (uVelMode == 0)
    {
        float3 param_11 = origin;
        float3 param_12 = radial;
        return safeDir(param_11, param_12);
    }
    if (uVelMode == 1)
    {
        return base;
    }
    if (uVelMode == 2)
    {
        float3 param_13 = cross(axis, radial);
        float3 param_14 = base;
        return safeDir(param_13, param_14);
    }
    float3 param_15 = base;
    float3 t1 = orthoOf(param_15);
    float3 t2 = cross(base, t1);
    float ph = s.z * 6.283185482025146484375f;
    float cone = s.w * uAngle;
    float3 param_16 = base + (((t1 * cos(ph)) + (t2 * sin(ph))) * cone);
    float3 param_17 = base;
    return safeDir(param_16, param_17);
}

float selfSpeedAt(inout float u)
{
    if (uSpeedN < 2)
    {
        return 1.0f;
    }
    u = clamp(u, 0.0f, 1.0f);
    float v = uSpeedKey[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uSpeedN)
        {
            break;
        }
        float a = uSpeedKey[i - 1].xy.x;
        float b = uSpeedKey[i].xy.x;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        v = lerp(v, uSpeedKey[i].xy.y, step(a, u) * f);
    }
    return v;
}

float selfSpeedI(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float acc = min(u, uSpeedKey[0].xy.x) * uSpeedKey[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uSpeedN)
        {
            break;
        }
        float a = uSpeedKey[i - 1].xy.x;
        float b = uSpeedKey[i].xy.x;
        float va = uSpeedKey[i - 1].xy.y;
        float vb = uSpeedKey[i].xy.y;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        acc += (((b - a) * f) * (va + (((vb - va) * f) * 0.5f)));
        if (i == (uSpeedN - 1))
        {
            acc += (max(u - b, 0.0f) * vb);
        }
    }
    return acc;
}

float curveE(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float v = uCurveE[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uCurveEN)
        {
            break;
        }
        float a = uCurveE[i - 1].xy.x;
        float b = uCurveE[i].xy.x;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        f = lerp(f, (f * f) * (3.0f - (2.0f * f)), uCurveEEase);
        v = lerp(v, uCurveE[i].xy.y, step(a, u) * f);
    }
    return v;
}

void selfTraj(float4 s, float4 e, float4 e2, float3 srcPos, float3 srcDir, float4 ev, float idx, float age, float life, float t, inout float3 pos, inout float3 vel)
{
    float4 param = s;
    float4 param_1 = e;
    float4 param_2 = e2;
    float3 param_3 = srcPos;
    float4 param_4 = ev;
    float param_5 = idx;
    float3 origin = selfOrigin(param, param_1, param_2, param_3, param_4, param_5);
    float4 param_6 = s;
    float4 param_7 = e;
    float4 param_8 = e2;
    float3 param_9 = origin;
    float3 param_10 = srcDir;
    float3 dir = selfDir(param_6, param_7, param_8, param_9, param_10);
    float a = max(age, 0.0f);
    float u = clamp(a / max(life, 9.9999997473787516355514526367188e-05f), 0.0f, 1.0f);
    if (uVelMode == 4)
    {
        float lu = clamp(t / max(uSpan, 9.9999997473787516355514526367188e-05f), 0.0f, 1.0f);
        float lag = lerp(uSpeed.x, uSpeed.y, e2.w);
        float param_11 = lu;
        float _2246 = selfSpeedAt(param_11);
        float ru = clamp(_2246 - lag, 0.0f, 1.0f);
        float param_12 = ru;
        pos = pathPointE(param_12) + origin;
        float param_13 = ru;
        vel = pathTangentE(param_13);
        if (uHasFloor == 1)
        {
            float dy = pos.y - uFloorY;
            pos.y = uFloorY + max(dy, dy * uFloorSoft);
        }
        return;
    }
    if (uVelMode == 5)
    {
        float3 param_14 = uAxis;
        float3 param_15 = float3(0.0f, 1.0f, 0.0f);
        float3 ax = safeDir(param_14, param_15);
        float h = dot(origin, ax);
        float3 rad = origin - (ax * h);
        float r = max(length(rad), 9.9999997473787516355514526367188e-05f);
        float param_16 = r / max(uShapeRadius, 0.001000000047497451305389404296875f);
        float param_17 = -0.5f;
        float w = uSpeed.y * safePow(param_16, param_17);
        float ang = w * a;
        float c = cos(ang);
        float sn = sin(ang);
        float3 turned = (rad * c) + (cross(ax, rad) * sn);
        float bob = ((e2.w - 0.5f) * uSpeed.x) * sin((a * (0.60000002384185791015625f + (1.2000000476837158203125f * e2.x))) + (e.x * 6.283185482025146484375f));
        pos = turned + (ax * (h + bob));
        vel = cross(ax, turned) * w;
        if (uHasFloor == 1)
        {
            float dy_1 = pos.y - uFloorY;
            pos.y = uFloorY + max(dy_1, dy_1 * uFloorSoft);
        }
        return;
    }
    float v0 = lerp(uSpeed.x, uSpeed.y, e2.w);
    float d;
    float scale;
    if (uSpeedN > 1)
    {
        float param_18 = u;
        float _2412 = selfSpeedI(param_18);
        d = life * _2412;
        float param_19 = u;
        float _2417 = selfSpeedAt(param_19);
        scale = _2417;
    }
    else
    {
        float _2423;
        if (uDrag < 0.001000000047497451305389404296875f)
        {
            _2423 = a;
        }
        else
        {
            _2423 = (1.0f - exp((-uDrag) * a)) / uDrag;
        }
        d = _2423;
        scale = exp((-uDrag) * a);
    }
    pos = ((origin + ((dir * v0) * d)) + (((uGravity * 0.5f) * a) * a)) + (uWind * a);
    vel = (((dir * v0) * scale) + (uGravity * a)) + uWind;
    if (uPlanarDrag > 0.0f)
    {
        float dp = (1.0f - exp((-uPlanarDrag) * a)) / uPlanarDrag;
        float sp = exp((-uPlanarDrag) * a);
        float3 flat_ = (origin + ((dir * v0) * dp)) + (uWind * a);
        pos = float3(flat_.xz.x, pos.y, flat_.xz.y);
        float2 _2529 = (((dir * v0) * sp) + uWind).xz;
        vel = float3(_2529.x, vel.y, _2529.y);
    }
    if (abs(uVortexW) > 9.9999997473787516355514526367188e-06f)
    {
        float3 param_20 = uVortexAxis;
        float3 param_21 = float3(0.0f, 1.0f, 0.0f);
        float3 ax_1 = safeDir(param_20, param_21);
        float h_1 = dot(pos, ax_1);
        float3 rad_1 = pos - (ax_1 * h_1);
        float r_1 = length(rad_1);
        if (r_1 > 9.9999997473787516355514526367188e-06f)
        {
            float w_1 = uVortexW / (1.0f + (uVortexFalloff * r_1));
            float ang_1 = w_1 * a;
            float c_1 = cos(ang_1);
            float sn_1 = sin(ang_1);
            pos = ((ax_1 * h_1) + (rad_1 * c_1)) + (cross(ax_1, rad_1) * sn_1);
            vel = (vel * c_1) + (cross(ax_1, vel) * sn_1);
        }
    }
    if (uCurl > 0.0f)
    {
        float3 param_22 = ((pos * uCurlFreq) + float3(0.0f, (-t) * uCurlSpeed, 0.0f)) + (e2.xyz * 3.0f);
        float3 c_2 = curl3(param_22);
        float param_23 = u;
        float _2637 = curveE(param_23);
        pos += (((c_2 * uCurl) * _2637) * a);
    }
    if (uHasFloor == 1)
    {
        float dy_2 = pos.y - uFloorY;
        pos.y = uFloorY + max(dy_2, dy_2 * uFloorSoft);
    }
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

float curveG(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float v = uCurveG[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uCurveGN)
        {
            break;
        }
        float a = uCurveG[i - 1].xy.x;
        float b = uCurveG[i].xy.x;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        f = lerp(f, (f * f) * (3.0f - (2.0f * f)), uCurveGEase);
        v = lerp(v, uCurveG[i].xy.y, step(a, u) * f);
    }
    return v;
}

float curveB(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float v = uCurveB[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uCurveBN)
        {
            break;
        }
        float a = uCurveB[i - 1].xy.x;
        float b = uCurveB[i].xy.x;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        f = lerp(f, (f * f) * (3.0f - (2.0f * f)), uCurveBEase);
        v = lerp(v, uCurveB[i].xy.y, step(a, u) * f);
    }
    return v;
}

float curveD(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float v = uCurveD[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uCurveDN)
        {
            break;
        }
        float a = uCurveD[i - 1].xy.x;
        float b = uCurveD[i].xy.x;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        f = lerp(f, (f * f) * (3.0f - (2.0f * f)), uCurveDEase);
        v = lerp(v, uCurveD[i].xy.y, step(a, u) * f);
    }
    return v;
}

void vert_main()
{
    aSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 0) % 1024, ((int(avfxVertexIndex) * 10) + 0) / 1024), 0));
    aExtra = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 1) % 1024, ((int(avfxVertexIndex) * 10) + 1) / 1024), 0));
    aExtra2 = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 2) % 1024, ((int(avfxVertexIndex) * 10) + 2) / 1024), 0));
    aIndex = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 3) % 1024, ((int(avfxVertexIndex) * 10) + 3) / 1024), 0)).x;
    aPSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 4) % 1024, ((int(avfxVertexIndex) * 10) + 4) / 1024), 0));
    aPExtra = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 5) % 1024, ((int(avfxVertexIndex) * 10) + 5) / 1024), 0));
    aPExtra2 = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 6) % 1024, ((int(avfxVertexIndex) * 10) + 6) / 1024), 0));
    aSrcPos = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 7) % 1024, ((int(avfxVertexIndex) * 10) + 7) / 1024), 0)).xyz;
    aSrcDir = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 8) % 1024, ((int(avfxVertexIndex) * 10) + 8) / 1024), 0)).xyz;
    aEvent = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 10) + 9) % 1024, ((int(avfxVertexIndex) * 10) + 9) / 1024), 0));
    vSeed = aExtra2.xyz;
    float4 param = aSeed;
    float life = selfLife(param);
    float3 subOrigin = 0.0f.xxx;
    float3 subVel = 0.0f.xxx;
    bool dead = false;
    float4 param_1 = aPSeed;
    float pLife = parentLife(param_1);
    float r = frac(((aSeed.x * 13.36999988555908203125f) + (aSeed.w * 7.769999980926513671875f)) + 0.112999998033046722412109375f);
    float _4164;
    if (uSubMode == 1)
    {
        _4164 = pLife;
    }
    else
    {
        float _4172;
        if (uSubMode == 2)
        {
            _4172 = lerp(uSubOffset.x, uSubOffset.y, r);
        }
        else
        {
            _4172 = lerp(uSubOffset.x, uSubOffset.y, frac(aSeed.x * 3.0f));
        }
        _4164 = _4172;
    }
    float off = _4164;
    off = clamp(off, 0.0f, pLife);
    float pNow = uTime + uParentTimeShift;
    float4 param_2 = aPSeed;
    float param_3 = pNow - off;
    float4 param_4 = aEvent;
    float param_5 = aIndex;
    float pBirth = parentBirth(param_2, param_3, param_4, param_5);
    float4 param_6 = aPSeed;
    float4 param_7 = aPExtra;
    float4 param_8 = aPExtra2;
    float3 param_9 = aSrcPos;
    float3 param_10 = aSrcDir;
    float4 param_11 = aEvent;
    float param_12 = aIndex;
    float param_13 = off;
    float param_14 = pLife;
    float param_15 = pBirth + off;
    float3 param_16;
    float3 param_17;
    parentTraj(param_6, param_7, param_8, param_9, param_10, param_11, param_12, param_13, param_14, param_15, param_16, param_17);
    float3 ppos = param_16;
    float3 pvel = param_17;
    float birth = (pBirth + off) - uParentTimeShift;
    float param_18 = pBirth + off;
    subOrigin = ppos + parentPathAt(param_18);
    subVel = pvel * uInherit;
    if (pBirth > 100000000.0f)
    {
        dead = true;
    }
    float age = uTime - birth;
    if ((age < 0.0f) || (age >= life))
    {
        dead = true;
    }
    float u = clamp(age / max(life, 9.9999997473787516355514526367188e-05f), 0.0f, 1.0f);
    if (dead)
    {
        kill();
        return;
    }
    vU = u;
    float side = position.x;
    float k = position.y;
    float kn = clamp(k / max(uSegments - 1.0f, 1.0f), 0.0f, 1.0f);
    vUv = float2((side * 0.5f) + 0.5f, kn);
    float ageK = max(age - (k * uSpacing), 0.0f);
    float4 param_19 = aSeed;
    float4 param_20 = aExtra;
    float4 param_21 = aExtra2;
    float3 param_22 = aSrcPos;
    float3 param_23 = aSrcDir;
    float4 param_24 = aEvent;
    float param_25 = aIndex;
    float param_26 = ageK;
    float param_27 = life;
    float param_28 = uTime;
    float3 param_29;
    float3 param_30;
    selfTraj(param_19, param_20, param_21, param_22, param_23, param_24, param_25, param_26, param_27, param_28, param_29, param_30);
    float3 pos = param_29;
    float3 vel = param_30;
    pos += (subOrigin + (subVel * ageK));
    vel += subVel;
    vWp = pos;
    float4 mv = mul(float4(pos, 1.0f), modelViewMatrix);
    float3 sv3 = mul(float4(vel, 0.0f), modelViewMatrix).xyz;
    float2 sv = float2(sv3.x, sv3.y);
    float svl = length(sv);
    float2 _4395;
    if (svl > 9.9999997473787516355514526367188e-05f)
    {
        _4395 = float2(sv.y, -sv.x) / svl.xx;
    }
    else
    {
        _4395 = float2(1.0f, 0.0f);
    }
    float2 across = _4395;
    float param_31 = u;
    float _4419 = curveA(param_31);
    float param_32 = kn;
    float _4423 = curveG(param_32);
    float width = ((lerp(uSize.x, uSize.y, aExtra2.x) * _4419) * _4423) * 0.5f;
    float2 _4433 = mv.xy + ((across * side) * width);
    mv = float4(_4433.x, _4433.y, mv.z, mv.w);
    gl_Position = mul(mv, projectionMatrix);
    float param_33 = u;
    float _4443 = curveB(param_33);
    vAlpha = _4443 * smoothstep(0.0f, 0.02999999932944774627685546875f, age);
    if (uHasAlphaSpawn == 1)
    {
        float param_34 = aExtra.w;
        float _4456 = curveD(param_34);
        vAlpha *= _4456;
    }
    if (uTwinkleDepth > 0.0f)
    {
        float param_35 = abs(sin((uTime * uTwinkleFreq) + (aExtra2.y * 19.700000762939453125f)));
        float param_36 = 1.5f;
        vAlpha *= lerp(1.0f, safePow(param_35, param_36), uTwinkleDepth);
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
    stage_output.vAlpha = vAlpha;
    stage_output.vU = vU;
    stage_output.vUv = vUv;
    stage_output.vWp = vWp;
    stage_output.vSeed = vSeed;
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
    uniform float uSegments;
    uniform float uSpacing;
    uniform float uSpan;
    uniform float uTwinkleFreq;
    uniform float uTwinkleDepth;
    uniform int uHasAlphaSpawn;
    uniform float2 uSize;
    uniform int uEPathType;
    uniform float3 uEPathA;
    uniform float3 uEPathB;
    uniform float3 uEPathC;
    uniform float4 uEPathD;
    uniform float2 uEPathW;
    uniform float4 uCurveA[8];
    uniform int uCurveAN;
    uniform float uCurveAEase;
    uniform float4 uCurveB[8];
    uniform int uCurveBN;
    uniform float uCurveBEase;
    uniform float4 uCurveD[8];
    uniform int uCurveDN;
    uniform float uCurveDEase;
    uniform float4 uCurveE[8];
    uniform int uCurveEN;
    uniform float uCurveEEase;
    uniform float4 uCurveG[8];
    uniform int uCurveGN;
    uniform float uCurveGEase;
    uniform float4 uCurveH[8];
    uniform int uCurveHN;
    uniform float uCurveHEase;
    uniform float4 uCurveT[8];
    uniform int uCurveTN;
    uniform float uCurveTEase;
    uniform float uPeriod;
    uniform float uSpawnWindow;
    uniform float uSpawnDuration;
    uniform float uShapeLength;
    uniform float uShapeRadius;
    uniform float uShapeInner;
    uniform float uShapeAngle;
    uniform float uDrag;
    uniform float uCurl;
    uniform float uCurlFreq;
    uniform float uCurlSpeed;
    uniform float uFloorY;
    uniform float uFloorSoft;
    uniform float uAngle;
    uniform float uPlanarDrag;
    uniform float uVortexW;
    uniform float uVortexFalloff;
    uniform int uSpawnMode;
    uniform int uShapeType;
    uniform int uVelMode;
    uniform int uHasFloor;
    uniform int uSurfaceOnly;
    uniform int uSpeedN;
    uniform int uBurstN;
    uniform float3 uAxis;
    uniform float3 uDir;
    uniform float3 uGravity;
    uniform float3 uWind;
    uniform float3 uBias;
    uniform float3 uShapeSize;
    uniform float3 uVortexAxis;
    uniform float2 uLife;
    uniform float2 uSpeed;
    uniform float4 uSpeedKey[8];
    uniform float4 uBurstT[8];
    uniform float4 uBurstC[8];
    uniform float uInterior;
    uniform float uAngleJitter;
    uniform float uAngleBias;
    uniform float3 uFrontC;
    uniform float3 uFrontEx;
    uniform float3 uFrontEy;
    uniform float3 uFrontN;
    uniform float uFrontR;
    uniform float uFrontPh0;
    uniform float uFrontSweep;
    uniform float uFrontSpan;
    uniform float uFrontStart;
    uniform float uParentPeriod;
    uniform float uParentSpawnWindow;
    uniform float uParentSpawnDuration;
    uniform float uParentShapeLength;
    uniform float uParentShapeRadius;
    uniform float uParentShapeInner;
    uniform float uParentShapeAngle;
    uniform float uParentDrag;
    uniform float uParentCurl;
    uniform float uParentCurlFreq;
    uniform float uParentCurlSpeed;
    uniform float uParentFloorY;
    uniform float uParentFloorSoft;
    uniform float uParentAngle;
    uniform float uParentPlanarDrag;
    uniform float uParentVortexW;
    uniform float uParentVortexFalloff;
    uniform int uParentSpawnMode;
    uniform int uParentShapeType;
    uniform int uParentVelMode;
    uniform int uParentHasFloor;
    uniform int uParentSurfaceOnly;
    uniform int uParentSpeedN;
    uniform int uParentBurstN;
    uniform float3 uParentAxis;
    uniform float3 uParentDir;
    uniform float3 uParentGravity;
    uniform float3 uParentWind;
    uniform float3 uParentBias;
    uniform float3 uParentShapeSize;
    uniform float3 uParentVortexAxis;
    uniform float2 uParentLife;
    uniform float2 uParentSpeed;
    uniform float4 uParentSpeedKey[8];
    uniform float4 uParentBurstT[8];
    uniform float4 uParentBurstC[8];
    uniform float uParentInterior;
    uniform float uParentAngleJitter;
    uniform float uParentAngleBias;
    uniform float uParentTimeShift;
    uniform float uInherit;
    uniform float uPathT0;
    uniform float uPathDt;
    uniform int uSubMode;
    uniform float2 uSubOffset;
    uniform float4 uParentPath[8];
    uniform int uHasTrail;
    uniform int uBlendMode;
    uniform float uOpacity;
    uniform float uFlicker;
    uniform float uTrailRampMode;
    uniform float4 uRamp[6];
    uniform float4 uRampT[6];
    uniform int uRampN;


Texture2D<float4> uTrail;
SamplerState sampleruTrail;
Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float vAlpha;
static float2 vUv;
static float vU;
static float4 avfxColor;
static float3 vSeed;
static float3 vWp;

struct SPIRV_Cross_Input
{
    float2 vUv : TEXCOORD0;
    float vU : TEXCOORD1;
    float vAlpha : TEXCOORD2;
    float3 vSeed : TEXCOORD3;
    float3 vWp : TEXCOORD4;
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
    if (vAlpha <= 0.0f)
    {
        discard;
    }
    float shape;
    if (uHasTrail == 1)
    {
        float4 m = uTrail.Sample(sampleruTrail, vUv);
        shape = m.w * max(m.x, max(m.y, m.z));
    }
    else
    {
        shape = smoothstep(1.0f, 0.0f, abs((vUv.x * 2.0f) - 1.0f));
    }
    float _166;
    if (uTrailRampMode > 0.5f)
    {
        _166 = clamp(vUv.y, 0.0f, 1.0f);
    }
    else
    {
        _166 = vU;
    }
    float param = _166;
    float3 _177 = rampColor(param);
    float3 col = _177;
    float a = ((shape * vAlpha) * uOpacity) * uFlicker;
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
    vAlpha = stage_input.vAlpha;
    vUv = stage_input.vUv;
    vU = stage_input.vU;
    vSeed = stage_input.vSeed;
    vWp = stage_input.vWp;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }
