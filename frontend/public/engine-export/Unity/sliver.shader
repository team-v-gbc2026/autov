Shader "autoV/Native/sliver" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float uSliverCurve;
    float uSliverTaper;
    float uSliverJag;
    float uSecondary;
    float uRetractOn;
    float uRetractStart;
    float uRetractEnd;
    float uRetractTip;
    float uSecLength;
    float uTwinkleFreq;
    float uTwinkleDepth;
    int uHasAlphaSpawn;
    float2 uSliverLen;
    float2 uSliverWide;
    float2 uSecAlong;
    float2 uSize;
    int uEPathType;
    float3 uEPathA;
    float3 uEPathB;
    float3 uEPathC;
    float4 uEPathD;
    float2 uEPathW;
    float4 uCurveA[8];
    int uCurveAN;
    float uCurveAEase;
    float4 uCurveB[8];
    int uCurveBN;
    float uCurveBEase;
    float4 uCurveD[8];
    int uCurveDN;
    float uCurveDEase;
    float4 uCurveE[8];
    int uCurveEN;
    float uCurveEEase;
    float4 uCurveH[8];
    int uCurveHN;
    float uCurveHEase;
    float4 uCurveT[8];
    int uCurveTN;
    float uCurveTEase;
    float uPeriod;
    float uSpawnWindow;
    float uSpawnDuration;
    float uShapeLength;
    float uShapeRadius;
    float uShapeInner;
    float uShapeAngle;
    float uDrag;
    float uCurl;
    float uCurlFreq;
    float uCurlSpeed;
    float uFloorY;
    float uFloorSoft;
    float uAngle;
    float uPlanarDrag;
    float uVortexW;
    float uVortexFalloff;
    int uSpawnMode;
    int uShapeType;
    int uVelMode;
    int uHasFloor;
    int uSurfaceOnly;
    int uSpeedN;
    int uBurstN;
    float3 uAxis;
    float3 uDir;
    float3 uGravity;
    float3 uWind;
    float3 uBias;
    float3 uShapeSize;
    float3 uVortexAxis;
    float2 uLife;
    float2 uSpeed;
    float4 uSpeedKey[8];
    float4 uBurstT[8];
    float4 uBurstC[8];
    float uInterior;
    float uAngleJitter;
    float uAngleBias;
    float3 uFrontC;
    float3 uFrontEx;
    float3 uFrontEy;
    float3 uFrontN;
    float uFrontR;
    float uFrontPh0;
    float uFrontSweep;
    float uFrontSpan;
    float uFrontStart;
    float uOpacity;
    float uFlicker;
    int uBlendMode;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float vAlpha;
static float vU;
static float vRot;
static float2 vTile;
static float3 vWp;
static float avfxVertexIndex;
static float3 vSeed;
static float3 position;
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
    float vU : TEXCOORD1;
    float vAlpha : TEXCOORD2;
    float vRot : TEXCOORD3;
    float3 vSeed : TEXCOORD4;
    float2 vTile : TEXCOORD5;
    float3 vWp : TEXCOORD6;
    float4 gl_Position : SV_Position;
};

static float4 aSeed;
static float4 aExtra;
static float4 aExtra2;
static float aIndex;
static float3 aSrcPos;
static float3 aSrcDir;
static float4 aEvent;
static float aSub;

float selfLife(float4 s)
{
    return lerp(uLife.x, uLife.y, s.y);
}

float curveTInverse(float y)
{
    float last = uCurveT[0].xy.x;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uCurveTN)
        {
            break;
        }
        float2 a = uCurveT[i - 1].xy;
        float2 b = uCurveT[i].xy;
        last = b.x;
        bool _1236 = y <= b.y;
        bool _1245;
        if (!_1236)
        {
            _1245 = i == (uCurveTN - 1);
        }
        else
        {
            _1245 = _1236;
        }
        if (_1245)
        {
            float s = clamp((y - a.y) / max(b.y - a.y, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
            float f = lerp(s, 0.5f - sin(asin(clamp(1.0f - (2.0f * s), -1.0f, 1.0f)) / 3.0f), uCurveTEase);
            return a.x + ((b.x - a.x) * f);
        }
    }
    return last;
}

float curveHInverse(float y)
{
    float last = uCurveH[0].xy.x;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uCurveHN)
        {
            break;
        }
        float2 a = uCurveH[i - 1].xy;
        float2 b = uCurveH[i].xy;
        last = b.x;
        bool _1146 = y <= b.y;
        bool _1155;
        if (!_1146)
        {
            _1155 = i == (uCurveHN - 1);
        }
        else
        {
            _1155 = _1146;
        }
        if (_1155)
        {
            float s = clamp((y - a.y) / max(b.y - a.y, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
            float f = lerp(s, 0.5f - sin(asin(clamp(1.0f - (2.0f * s), -1.0f, 1.0f)) / 3.0f), uCurveHEase);
            return a.x + ((b.x - a.x) * f);
        }
    }
    return last;
}

float selfBirth(float4 s, float t, float4 ev, float idx)
{
    float instance = s.x;
    float birth = instance * uSpawnWindow;
    if (uSpawnMode == 1)
    {
        float cycle = floor((t - birth) / max(uPeriod, 9.9999997473787516355514526367188e-05f));
        float absBirth = birth + (cycle * uPeriod);
        bool _1393 = absBirth < 0.0f;
        bool _1402;
        if (!_1393)
        {
            _1402 = absBirth > uSpawnDuration;
        }
        else
        {
            _1402 = _1393;
        }
        if (_1402)
        {
            return 1000000000.0f;
        }
        return absBirth;
    }
    if (uSpawnMode == 2)
    {
        float t0 = uBurstT[0].x;
        for (int i = 0; i < 8; i++)
        {
            if (i >= uBurstN)
            {
                break;
            }
            if (instance <= uBurstC[i].x)
            {
                t0 = uBurstT[i].x;
                break;
            }
        }
        return t0 + (frac((instance * 7.13000011444091796875f) + 0.37000000476837158203125f) * uSpawnWindow);
    }
    if (uSpawnMode == 4)
    {
        return ev.w + (frac((instance * 7.13000011444091796875f) + 0.37000000476837158203125f) * uSpawnWindow);
    }
    if (uSpawnMode == 5)
    {
        float param = instance;
        return (curveTInverse(param) * uFrontSpan) + uFrontStart;
    }
    if (uSpawnMode == 3)
    {
        float param_1 = idx;
        return curveHInverse(param_1) * uSpan;
    }
    return birth;
}

void kill()
{
    gl_Position = float4(2.0f, 2.0f, 2.0f, 1.0f);
    vAlpha = 0.0f;
    vU = 0.0f;
    vRot = 0.0f;
    vTile = 0.0f.xx;
    vWp = 0.0f.xxx;
}

float safePow(float base, float e)
{
    return pow(max(base, 9.9999997473787516355514526367188e-06f), e);
}

float3 safeDir(float3 v, float3 fallback)
{
    float l = length(v);
    float3 _628;
    if (l > 9.9999997473787516355514526367188e-06f)
    {
        _628 = v / l.xxx;
    }
    else
    {
        _628 = fallback;
    }
    return _628;
}

float3 orthoOf(float3 a)
{
    float3 _651;
    if (abs(a.y) < 0.89999997615814208984375f)
    {
        _651 = cross(a, float3(0.0f, 1.0f, 0.0f));
    }
    else
    {
        _651 = cross(a, float3(1.0f, 0.0f, 0.0f));
    }
    float3 param = _651;
    float3 param_1 = float3(1.0f, 0.0f, 0.0f);
    return safeDir(param, param_1);
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
    float3 _803;
    if (l > 9.9999999747524270787835121154785e-07f)
    {
        _803 = d / l.xxx;
    }
    else
    {
        _803 = float3(0.0f, 0.0f, 1.0f);
    }
    return _803;
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
    float _1545;
    if (uSurfaceOnly == 1)
    {
        _1545 = 1.0f;
    }
    else
    {
        float param = e.z;
        float param_1 = 0.5f;
        _1545 = safePow(param, param_1);
    }
    float fill = _1545;
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
    bool _2157 = uShapeType == 9;
    bool _2164;
    if (_2157)
    {
        _2164 = uVelMode == 0;
    }
    else
    {
        _2164 = _2157;
    }
    if (_2164)
    {
        float3 param_6 = srcDir;
        float3 param_7 = base;
        return safeDir(param_6, param_7);
    }
    bool _2175 = uSpawnMode == 5;
    bool _2181;
    if (_2175)
    {
        _2181 = uVelMode == 0;
    }
    else
    {
        _2181 = _2175;
    }
    if (_2181)
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
        float _2473 = selfSpeedAt(param_11);
        float ru = clamp(_2473 - lag, 0.0f, 1.0f);
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
        float _2639 = selfSpeedI(param_18);
        d = life * _2639;
        float param_19 = u;
        float _2644 = selfSpeedAt(param_19);
        scale = _2644;
    }
    else
    {
        float _2650;
        if (uDrag < 0.001000000047497451305389404296875f)
        {
            _2650 = a;
        }
        else
        {
            _2650 = (1.0f - exp((-uDrag) * a)) / uDrag;
        }
        d = _2650;
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
        float2 _2756 = (((dir * v0) * sp) + uWind).xz;
        vel = float3(_2756.x, vel.y, _2756.y);
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
        float _2864 = curveE(param_23);
        pos += (((c_2 * uCurl) * _2864) * a);
    }
    if (uHasFloor == 1)
    {
        float dy_2 = pos.y - uFloorY;
        pos.y = uFloorY + max(dy_2, dy_2 * uFloorSoft);
    }
}

float slvHash(inout float p)
{
    p = frac(p * 0.103100001811981201171875f);
    p *= (p + 33.3300018310546875f);
    p *= (p + p);
    return frac(p);
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

float slvEdge(float t, float base, float h0, float h1, float h2)
{
    float teeth = 2.0f + floor(h0 * 3.0f);
    float depth = uSliverJag * (0.3400000035762786865234375f + (0.300000011920928955078125f * h1));
    return base * (1.0f - (depth * frac((t * teeth) + h2)));
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
    aSeed = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 8) + 0) % 1024, ((int(avfxVertexIndex) * 8) + 0) / 1024), 0));
    aExtra = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 8) + 1) % 1024, ((int(avfxVertexIndex) * 8) + 1) / 1024), 0));
    aExtra2 = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 8) + 2) % 1024, ((int(avfxVertexIndex) * 8) + 2) / 1024), 0));
    aIndex = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 8) + 3) % 1024, ((int(avfxVertexIndex) * 8) + 3) / 1024), 0)).x;
    aSrcPos = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 8) + 4) % 1024, ((int(avfxVertexIndex) * 8) + 4) / 1024), 0)).xyz;
    aSrcDir = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 8) + 5) % 1024, ((int(avfxVertexIndex) * 8) + 5) / 1024), 0)).xyz;
    aEvent = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 8) + 6) % 1024, ((int(avfxVertexIndex) * 8) + 6) / 1024), 0));
    aSub = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 8) + 7) % 1024, ((int(avfxVertexIndex) * 8) + 7) / 1024), 0)).x;
    vSeed = aExtra2.xyz;
    vRot = 0.0f;
    vTile = 0.0f.xx;
    float4 param = aSeed;
    float life = selfLife(param);
    float3 subOrigin = 0.0f.xxx;
    float3 subVel = 0.0f.xxx;
    bool dead = false;
    float4 param_1 = aSeed;
    float param_2 = uTime;
    float4 param_3 = aEvent;
    float param_4 = aIndex;
    float birth = selfBirth(param_1, param_2, param_3, param_4);
    if (birth > 100000000.0f)
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
    float4 param_5 = aSeed;
    float4 param_6 = aExtra;
    float4 param_7 = aExtra2;
    float3 param_8 = aSrcPos;
    float3 param_9 = aSrcDir;
    float4 param_10 = aEvent;
    float param_11 = aIndex;
    float param_12 = age;
    float param_13 = life;
    float param_14 = uTime;
    float3 param_15;
    float3 param_16;
    selfTraj(param_5, param_6, param_7, param_8, param_9, param_10, param_11, param_12, param_13, param_14, param_15, param_16);
    float3 pos = param_15;
    float3 vel = param_16;
    vWp = pos;
    float hs = (aSeed.z * 7.30000019073486328125f) + (aSub * 2.1700000762939453125f);
    float param_17 = (hs * 1.7000000476837158203125f) + 0.89999997615814208984375f;
    float _3189 = slvHash(param_17);
    float param_18 = u;
    float _3193 = curveA(param_18);
    float L = lerp(uSliverLen.x, uSliverLen.y, _3189) * _3193;
    float param_19 = (hs * 3.099999904632568359375f) + 5.5f;
    float _3207 = slvHash(param_19);
    float W = lerp(uSliverWide.x, uSliverWide.y, _3207);
    float root = 0.0f;
    if (uRetractOn > 0.5f)
    {
        float eat = smoothstep(uRetractStart, uRetractEnd, u);
        if (uRetractTip > 0.5f)
        {
            L *= (1.0f - eat);
        }
        else
        {
            root = (L * eat) * 0.89999997615814208984375f;
            L *= (1.0f - eat);
        }
    }
    float s = clamp(position.x, 0.0f, 1.0f);
    float v = position.y;
    float4 mv = mul(float4(pos, 1.0f), modelViewMatrix);
    float3 sv3 = mul(float4(vel, 0.0f), modelViewMatrix).xyz;
    float2 _3276;
    if (length(sv3.xy) > 9.9999997473787516355514526367188e-06f)
    {
        _3276 = normalize(sv3.xy);
    }
    else
    {
        _3276 = float2(0.0f, 1.0f);
    }
    float2 along = _3276;
    float2 across = float2(-along.y, along.x);
    if (uSecondary > 0.5f)
    {
        float param_20 = (aSub * 5.30000019073486328125f) + (aSeed.w * 9.1000003814697265625f);
        float _3311 = slvHash(param_20);
        float at = lerp(uSecAlong.x, uSecAlong.y, _3311);
        root += (L * at);
        L *= uSecLength;
    }
    float param_21 = max(1.0f - s, 0.0f);
    float param_22 = uSliverTaper;
    float param_23 = smoothstep(0.0f, 0.2199999988079071044921875f, s);
    float param_24 = 0.60000002384185791015625f;
    float base = ((W * 0.5f) * safePow(param_21, param_22)) * safePow(param_23, param_24);
    float param_25 = hs * 2.2999999523162841796875f;
    float _3347 = slvHash(param_25);
    float param_26 = (hs * 4.69999980926513671875f) + 1.10000002384185791015625f;
    float _3354 = slvHash(param_26);
    float param_27 = (hs * 6.099999904632568359375f) + 3.2999999523162841796875f;
    float _3361 = slvHash(param_27);
    float param_28 = s;
    float param_29 = base;
    float param_30 = _3347;
    float param_31 = _3354;
    float param_32 = _3361;
    float left = slvEdge(param_28, param_29, param_30, param_31, param_32);
    float param_33 = (hs * 8.8999996185302734375f) + 2.7000000476837158203125f;
    float _3377 = slvHash(param_33);
    float param_34 = (hs * 11.30000019073486328125f) + 4.900000095367431640625f;
    float _3384 = slvHash(param_34);
    float param_35 = (hs * 13.69999980926513671875f) + 6.099999904632568359375f;
    float _3390 = slvHash(param_35);
    float param_36 = s;
    float param_37 = base;
    float param_38 = _3377;
    float param_39 = _3384;
    float param_40 = _3390;
    float right = slvEdge(param_36, param_37, param_38, param_39, param_40);
    float w = (v < 0.0f) ? left : right;
    float param_41 = (hs * 17.299999237060546875f) + 8.30000019073486328125f;
    float _3412 = slvHash(param_41);
    float bends = 2.0f + floor(_3412 * 2.0f);
    float param_42 = hs * 19.1000003814697265625f;
    float _3432 = slvHash(param_42);
    float param_43 = hs * 23.8999996185302734375f;
    float _3443 = slvHash(param_43);
    float bend = ((((uSliverCurve * L) * 0.119999997317790985107421875f) * sin(((s * 3.1415927410125732421875f) * bends) + (_3432 * 6.283185482025146484375f))) * s) * ((_3443 < 0.5f) ? (-1.0f) : 1.0f);
    float2 _3464 = mv.xy + ((along * (root + (s * L))) + (across * ((v * w) + bend)));
    mv = float4(_3464.x, _3464.y, mv.z, mv.w);
    gl_Position = mul(mv, projectionMatrix);
    vUv = float2((v * 0.5f) + 0.5f, s);
    float param_44 = u;
    float _3480 = curveB(param_44);
    vAlpha = _3480 * smoothstep(0.0f, 0.02999999932944774627685546875f, age);
    if (uHasAlphaSpawn == 1)
    {
        float param_45 = aExtra.w;
        float _3494 = curveD(param_45);
        vAlpha *= _3494;
    }
    if (uTwinkleDepth > 0.0f)
    {
        float param_46 = abs(sin((uTime * uTwinkleFreq) + (aExtra2.y * 19.700000762939453125f)));
        float param_47 = 1.5f;
        vAlpha *= lerp(1.0f, safePow(param_46, param_47), uTwinkleDepth);
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
    stage_output.vRot = vRot;
    stage_output.vTile = vTile;
    stage_output.vWp = vWp;
    stage_output.vSeed = vSeed;
    stage_output.vUv = vUv;
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
    float uSliverCurve;
    float uSliverTaper;
    float uSliverJag;
    float uSecondary;
    float uRetractOn;
    float uRetractStart;
    float uRetractEnd;
    float uRetractTip;
    float uSecLength;
    float uTwinkleFreq;
    float uTwinkleDepth;
    int uHasAlphaSpawn;
    float2 uSliverLen;
    float2 uSliverWide;
    float2 uSecAlong;
    float2 uSize;
    int uEPathType;
    float3 uEPathA;
    float3 uEPathB;
    float3 uEPathC;
    float4 uEPathD;
    float2 uEPathW;
    float4 uCurveA[8];
    int uCurveAN;
    float uCurveAEase;
    float4 uCurveB[8];
    int uCurveBN;
    float uCurveBEase;
    float4 uCurveD[8];
    int uCurveDN;
    float uCurveDEase;
    float4 uCurveE[8];
    int uCurveEN;
    float uCurveEEase;
    float4 uCurveH[8];
    int uCurveHN;
    float uCurveHEase;
    float4 uCurveT[8];
    int uCurveTN;
    float uCurveTEase;
    float uPeriod;
    float uSpawnWindow;
    float uSpawnDuration;
    float uShapeLength;
    float uShapeRadius;
    float uShapeInner;
    float uShapeAngle;
    float uDrag;
    float uCurl;
    float uCurlFreq;
    float uCurlSpeed;
    float uFloorY;
    float uFloorSoft;
    float uAngle;
    float uPlanarDrag;
    float uVortexW;
    float uVortexFalloff;
    int uSpawnMode;
    int uShapeType;
    int uVelMode;
    int uHasFloor;
    int uSurfaceOnly;
    int uSpeedN;
    int uBurstN;
    float3 uAxis;
    float3 uDir;
    float3 uGravity;
    float3 uWind;
    float3 uBias;
    float3 uShapeSize;
    float3 uVortexAxis;
    float2 uLife;
    float2 uSpeed;
    float4 uSpeedKey[8];
    float4 uBurstT[8];
    float4 uBurstC[8];
    float uInterior;
    float uAngleJitter;
    float uAngleBias;
    float3 uFrontC;
    float3 uFrontEx;
    float3 uFrontEy;
    float3 uFrontN;
    float uFrontR;
    float uFrontPh0;
    float uFrontSweep;
    float uFrontSpan;
    float uFrontStart;
    float uOpacity;
    float uFlicker;
    int uBlendMode;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float vAlpha;
static float2 vUv;
static float4 avfxColor;
static float vU;
static float vRot;
static float3 vSeed;
static float2 vTile;
static float3 vWp;

struct SPIRV_Cross_Input
{
    float2 vUv : TEXCOORD0;
    float vU : TEXCOORD1;
    float vAlpha : TEXCOORD2;
    float vRot : TEXCOORD3;
    float3 vSeed : TEXCOORD4;
    float2 vTile : TEXCOORD5;
    float3 vWp : TEXCOORD6;
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
    float param = smoothstep(0.0500000007450580596923828125f, 0.75f, vUv.y);
    float3 _125 = rampColor(param);
    float3 col = _125;
    float a = (vAlpha * uOpacity) * uFlicker;
    a *= (1.0f - (smoothstep(0.7200000286102294921875f, 1.0f, vUv.y) * 0.550000011920928955078125f));
    a *= (smoothstep(0.0f, 0.300000011920928955078125f, vUv.x) * smoothstep(1.0f, 0.699999988079071044921875f, vUv.x));
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
    vRot = stage_input.vRot;
    vSeed = stage_input.vSeed;
    vTile = stage_input.vTile;
    vWp = stage_input.vWp;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }