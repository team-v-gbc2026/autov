Shader "autoV/Native/subParticle" { Properties { uMask ("uMask", 2D) = "white" {} uNoise ("uNoise", 2D) = "white" {} tDepth ("tDepth", 2D) = "white" {} avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float uStretch;
    float uAtlasTiles;
    float uMotionBlur;
    float uFlipFps;
    float uSpan;
    float uTwinkleFreq;
    float uTwinkleDepth;
    int uRenderMode;
    int uHasAlphaSpawn;
    int uAtlasCols;
    int uAtlasRows;
    int uFlipMode;
    int uAnchorHead;
    float2 uSize;
    float2 uRot;
    float2 uRotInit;
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
    float uParentPeriod;
    float uParentSpawnWindow;
    float uParentSpawnDuration;
    float uParentShapeLength;
    float uParentShapeRadius;
    float uParentShapeInner;
    float uParentShapeAngle;
    float uParentDrag;
    float uParentCurl;
    float uParentCurlFreq;
    float uParentCurlSpeed;
    float uParentFloorY;
    float uParentFloorSoft;
    float uParentAngle;
    float uParentPlanarDrag;
    float uParentVortexW;
    float uParentVortexFalloff;
    int uParentSpawnMode;
    int uParentShapeType;
    int uParentVelMode;
    int uParentHasFloor;
    int uParentSurfaceOnly;
    int uParentSpeedN;
    int uParentBurstN;
    float3 uParentAxis;
    float3 uParentDir;
    float3 uParentGravity;
    float3 uParentWind;
    float3 uParentBias;
    float3 uParentShapeSize;
    float3 uParentVortexAxis;
    float2 uParentLife;
    float2 uParentSpeed;
    float4 uParentSpeedKey[8];
    float4 uParentBurstT[8];
    float4 uParentBurstC[8];
    float uParentInterior;
    float uParentAngleJitter;
    float uParentAngleBias;
    float uParentTimeShift;
    float uInherit;
    float uPathT0;
    float uPathDt;
    int uSubMode;
    float2 uSubOffset;
    float4 uParentPath[8];
    int uHasMask;
    int uHasNoise;
    int uUseErosion;
    int uBlendMode;
    int uProcedural;
    float uDistort;
    float uErodeSoft;
    float uEdgeW;
    float uEdgeI;
    float uOpacity;
    float uMaskRot;
    float uRampKeyMode;
    float uGroundY;
    float uHeightSpan;
    float uFlicker;
    float uRampBlendMode;
    float uRampBlendWeight;
    float2 uNoiseScale;
    float2 uNoisePan;
    float2 uMaskScale;
    float2 uMaskPan;
    float2 uDistortPan;
    float3 uEdgeCol;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;
    float4 uCurveC[8];
    int uCurveCN;
    float uCurveCEase;
    float2 uResolution;
    float uNear;
    float uFar;
    float uSoft;
    float4 uProcParams;
    float4 uStripeA[3];
    float4 uStripeB[3];
    int uStripeN;
    float3 uSymFill;
    float3 uSymOutline;
    float3 uSymHigh;
    float3 uSymInk;
    float3 uSymHot;
    float uSymHotI;
    float uSymHotA;
    float uScreenPitch;
    float uScreenOn;
    float uScreenWorld;
    float3 uScreenCol;
    int uSmokeLit;
    int uSmokeCard;
    float uSmokeAmbient;
    float3 uSmokeRight;
    float3 uSmokeUp;
    float3 uSmokeForward;
    float4 uSmokeLights[8];


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;
Texture2D<float4> uMask;
SamplerState sampleruMask;
Texture2D<float4> uNoise;
SamplerState sampleruNoise;
Texture2D<float4> tDepth;
SamplerState samplertDepth;

static float4 gl_Position;
static float vAlpha;
static float vU;
static float vRot;
static float2 vTile;
static float3 vWp;
static float avfxVertexIndex;
static float2 vUv;
static float2 uv;
static float3 vSeed;
static float3 position;
static float2 vNextTile;
static float vFrameMix;
static float3 normal;

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
    float2 vNextTile : TEXCOORD6;
    float vFrameMix : TEXCOORD7;
    float3 vWp : TEXCOORD8;
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

float mod(float x, float y)
{
    return x - y * floor(x / y);
}

float2 mod(float2 x, float2 y)
{
    return x - y * floor(x / y);
}

float3 mod(float3 x, float3 y)
{
    return x - y * floor(x / y);
}

float4 mod(float4 x, float4 y)
{
    return x - y * floor(x / y);
}

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
        bool _2719 = absBirth < 0.0f;
        bool _2728;
        if (!_2719)
        {
            _2728 = absBirth > uParentSpawnDuration;
        }
        else
        {
            _2728 = _2719;
        }
        if (_2728)
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
    float3 _674;
    if (l > 9.9999997473787516355514526367188e-06f)
    {
        _674 = v / l.xxx;
    }
    else
    {
        _674 = fallback;
    }
    return _674;
}

float3 orthoOf(float3 a)
{
    float3 _697;
    if (abs(a.y) < 0.89999997615814208984375f)
    {
        _697 = cross(a, float3(0.0f, 1.0f, 0.0f));
    }
    else
    {
        _697 = cross(a, float3(1.0f, 0.0f, 0.0f));
    }
    float3 param = _697;
    float3 param_1 = float3(1.0f, 0.0f, 0.0f);
    return safeDir(param, param_1);
}

float3 parentOrigin(float4 s, float4 e, float4 e2, float3 srcPos, float4 ev, float idx)
{
    float ca = e.x * 6.283185482025146484375f;
    float cz = (e.y * 2.0f) - 1.0f;
    float cr = sqrt(max(0.0f, 1.0f - (cz * cz)));
    float3 unit = float3(cr * cos(ca), cz, cr * sin(ca));
    float _2821;
    if (uParentSurfaceOnly == 1)
    {
        _2821 = 1.0f;
    }
    else
    {
        float param = e.z;
        float param_1 = 0.5f;
        _2821 = safePow(param, param_1);
    }
    float fill = _2821;
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
        float _3647 = parentSpeedI(param_15);
        d = life * _3647;
        float param_16 = u;
        float _3652 = parentSpeedAt(param_16);
        scale = _3652;
    }
    else
    {
        float _3658;
        if (uParentDrag < 0.001000000047497451305389404296875f)
        {
            _3658 = a;
        }
        else
        {
            _3658 = (1.0f - exp((-uParentDrag) * a)) / uParentDrag;
        }
        d = _3658;
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
        float2 _3764 = (((dir * v0) * sp) + uParentWind).xz;
        vel = float3(_3764.x, vel.y, _3764.y);
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
    vRot = 0.0f;
    vTile = 0.0f.xx;
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
    float3 _856;
    if (l > 9.9999999747524270787835121154785e-07f)
    {
        _856 = d / l.xxx;
    }
    else
    {
        _856 = float3(0.0f, 0.0f, 1.0f);
    }
    return _856;
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
    float _1323;
    if (uSurfaceOnly == 1)
    {
        _1323 = 1.0f;
    }
    else
    {
        float param = e.z;
        float param_1 = 0.5f;
        _1323 = safePow(param, param_1);
    }
    float fill = _1323;
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
    bool _1942 = uShapeType == 9;
    bool _1949;
    if (_1942)
    {
        _1949 = uVelMode == 0;
    }
    else
    {
        _1949 = _1942;
    }
    if (_1949)
    {
        float3 param_6 = srcDir;
        float3 param_7 = base;
        return safeDir(param_6, param_7);
    }
    bool _1960 = uSpawnMode == 5;
    bool _1966;
    if (_1960)
    {
        _1966 = uVelMode == 0;
    }
    else
    {
        _1966 = _1960;
    }
    if (_1966)
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
        float _2258 = selfSpeedAt(param_11);
        float ru = clamp(_2258 - lag, 0.0f, 1.0f);
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
        float _2424 = selfSpeedI(param_18);
        d = life * _2424;
        float param_19 = u;
        float _2429 = selfSpeedAt(param_19);
        scale = _2429;
    }
    else
    {
        float _2435;
        if (uDrag < 0.001000000047497451305389404296875f)
        {
            _2435 = a;
        }
        else
        {
            _2435 = (1.0f - exp((-uDrag) * a)) / uDrag;
        }
        d = _2435;
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
        float2 _2541 = (((dir * v0) * sp) + uWind).xz;
        vel = float3(_2541.x, vel.y, _2541.y);
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
        float _2649 = curveE(param_23);
        pos += (((c_2 * uCurl) * _2649) * a);
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

float flipFrame(float life, float age, float tiles, int mode, float fps)
{
    float frame = 0.0f;
    if (mode == 1)
    {
        frame = clamp(life, 0.0f, 1.0f) * max(tiles - 1.0f, 0.0f);
    }
    else
    {
        if (mode == 2)
        {
            frame = mod(max(age, 0.0f) * fps, tiles);
        }
    }
    return frame;
}

float2 tileOffset(float frame, float cols, float rows)
{
    return float2(mod(floor(frame), cols) / cols, floor(floor(frame) / cols) / rows);
}

float nextFlipFrame(float frame, float tiles, int mode)
{
    float next = min(floor(frame) + 1.0f, tiles - 1.0f);
    if (mode == 2)
    {
        next = mod(floor(frame) + 1.0f, tiles);
    }
    return next;
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
    vUv = uv;
    vSeed = aExtra2.xyz;
    float4 param = aSeed;
    float life = selfLife(param);
    float3 subOrigin = 0.0f.xxx;
    float3 subVel = 0.0f.xxx;
    bool dead = false;
    float4 param_1 = aPSeed;
    float pLife = parentLife(param_1);
    float r = frac(((aSeed.x * 13.36999988555908203125f) + (aSeed.w * 7.769999980926513671875f)) + 0.112999998033046722412109375f);
    float _4181;
    if (uSubMode == 1)
    {
        _4181 = pLife;
    }
    else
    {
        float _4189;
        if (uSubMode == 2)
        {
            _4189 = lerp(uSubOffset.x, uSubOffset.y, r);
        }
        else
        {
            _4189 = lerp(uSubOffset.x, uSubOffset.y, frac(aSeed.x * 3.0f));
        }
        _4181 = _4189;
    }
    float off = _4181;
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
    float4 param_19 = aSeed;
    float4 param_20 = aExtra;
    float4 param_21 = aExtra2;
    float3 param_22 = aSrcPos;
    float3 param_23 = aSrcDir;
    float4 param_24 = aEvent;
    float param_25 = aIndex;
    float param_26 = age;
    float param_27 = life;
    float param_28 = uTime;
    float3 param_29;
    float3 param_30;
    selfTraj(param_19, param_20, param_21, param_22, param_23, param_24, param_25, param_26, param_27, param_28, param_29, param_30);
    float3 pos = param_29;
    float3 vel = param_30;
    pos += (subOrigin + (subVel * age));
    vel += subVel;
    vWp = pos;
    float param_31 = u;
    float _4362 = curveA(param_31);
    float size = lerp(uSize.x, uSize.y, aExtra2.x) * _4362;
    float rot = lerp(uRotInit.x, uRotInit.y, aExtra2.y) + (lerp(uRot.x, uRot.y, aExtra2.z) * age);
    bool _4388 = uRenderMode == 4;
    bool _4394;
    if (_4388)
    {
        _4394 = uShapeType == 8;
    }
    else
    {
        _4394 = _4388;
    }
    float3 _4395;
    if (_4394)
    {
        float param_32 = aIndex;
        _4395 = pathTangentE(param_32);
    }
    else
    {
        _4395 = vel;
    }
    float3 heading = _4395;
    bool _4406 = uRenderMode == 2;
    bool _4413;
    if (!_4406)
    {
        _4413 = uRenderMode == 3;
    }
    else
    {
        _4413 = _4406;
    }
    float4 mv;
    if (_4413)
    {
        float c = cos(rot);
        float s = sin(rot);
        float2 q = mul(position.xy, float2x2(float2(c, -s), float2(s, c))) * size;
        float3 _4443;
        if (uRenderMode == 2)
        {
            _4443 = float3(q.x, 0.0f, q.y);
        }
        else
        {
            _4443 = float3(q.x, q.y, 0.0f);
        }
        float3 world = _4443;
        mv = mul(float4(pos + world, 1.0f), modelViewMatrix);
        rot = 0.0f;
    }
    else
    {
        mv = mul(float4(pos, 1.0f), modelViewMatrix);
        float3 sv3 = mul(float4(heading, 0.0f), modelViewMatrix).xyz;
        float2 sv = float2(sv3.x, sv3.y);
        float svl = length(sv);
        float2 along = float2(0.0f, 1.0f);
        float2 across = float2(1.0f, 0.0f);
        float stretch = 1.0f;
        bool _4503 = uRenderMode == 1;
        bool _4510;
        if (!_4503)
        {
            _4510 = uRenderMode == 4;
        }
        else
        {
            _4510 = _4503;
        }
        if (_4510 && (svl > 9.9999997473787516355514526367188e-05f))
        {
            along = sv / svl.xx;
            across = float2(along.y, -along.x);
            rot = 0.0f;
            float _4529;
            if (uRenderMode == 4)
            {
                _4529 = 1.0f + uStretch;
            }
            else
            {
                _4529 = 1.0f + ((uStretch * (1.0f + (2.0f * uMotionBlur))) * svl);
            }
            stretch = _4529;
        }
        float _4552;
        if (uAnchorHead == 1)
        {
            _4552 = ((-0.5f) * size) * stretch;
        }
        else
        {
            _4552 = 0.0f;
        }
        float anchorShift = _4552;
        float2 off_1 = ((across * position.x) * size) + (along * (((position.y * size) * stretch) + anchorShift));
        if ((uMotionBlur > 0.0f) && (svl > 9.9999997473787516355514526367188e-05f))
        {
            float2 vdir = sv / svl.xx;
            off_1 += ((((vdir * dot(off_1, vdir)) * uMotionBlur) * min(svl, 8.0f)) * 0.25f);
        }
        float2 _4610 = mv.xy + off_1;
        mv = float4(_4610.x, _4610.y, mv.z, mv.w);
    }
    vRot = rot;
    gl_Position = mul(mv, projectionMatrix);
    float param_33 = u;
    float _4621 = curveB(param_33);
    vAlpha = _4621 * smoothstep(0.0f, 0.02999999932944774627685546875f, age);
    if (uHasAlphaSpawn == 1)
    {
        float param_34 = aExtra.w;
        float _4635 = curveD(param_34);
        vAlpha *= _4635;
    }
    if (uTwinkleDepth > 0.0f)
    {
        float param_35 = abs(sin((uTime * uTwinkleFreq) + (aExtra2.y * 19.700000762939453125f)));
        float param_36 = 1.5f;
        vAlpha *= lerp(1.0f, safePow(param_35, param_36), uTwinkleDepth);
    }
    float cols = float(max(uAtlasCols, 1));
    float rows = float(max(uAtlasRows, 1));
    float tiles = max(uAtlasTiles, 1.0f);
    float ti = floor((aExtra.z * tiles) * 0.99989998340606689453125f);
    float frame = ti;
    if (uFlipMode > 0)
    {
        float param_37 = u;
        float param_38 = age;
        float param_39 = tiles;
        int param_40 = uFlipMode;
        float param_41 = uFlipFps;
        frame = flipFrame(param_37, param_38, param_39, param_40, param_41);
    }
    float param_42 = frame;
    float param_43 = cols;
    float param_44 = rows;
    vTile = tileOffset(param_42, param_43, param_44);
    vNextTile = vTile;
    vFrameMix = 0.0f;
    if (uFlipMode > 0)
    {
        float param_45 = frame;
        float param_46 = tiles;
        int param_47 = uFlipMode;
        float param_48 = nextFlipFrame(param_45, param_46, param_47);
        float param_49 = cols;
        float param_50 = rows;
        vNextTile = tileOffset(param_48, param_49, param_50);
        vFrameMix = frac(frame);
    }
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
    stage_output.vAlpha = vAlpha;
    stage_output.vU = vU;
    stage_output.vRot = vRot;
    stage_output.vTile = vTile;
    stage_output.vWp = vWp;
    stage_output.vUv = vUv;
    stage_output.vSeed = vSeed;
    stage_output.vNextTile = vNextTile;
    stage_output.vFrameMix = vFrameMix;
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
    float uStretch;
    float uAtlasTiles;
    float uMotionBlur;
    float uFlipFps;
    float uSpan;
    float uTwinkleFreq;
    float uTwinkleDepth;
    int uRenderMode;
    int uHasAlphaSpawn;
    int uAtlasCols;
    int uAtlasRows;
    int uFlipMode;
    int uAnchorHead;
    float2 uSize;
    float2 uRot;
    float2 uRotInit;
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
    float uParentPeriod;
    float uParentSpawnWindow;
    float uParentSpawnDuration;
    float uParentShapeLength;
    float uParentShapeRadius;
    float uParentShapeInner;
    float uParentShapeAngle;
    float uParentDrag;
    float uParentCurl;
    float uParentCurlFreq;
    float uParentCurlSpeed;
    float uParentFloorY;
    float uParentFloorSoft;
    float uParentAngle;
    float uParentPlanarDrag;
    float uParentVortexW;
    float uParentVortexFalloff;
    int uParentSpawnMode;
    int uParentShapeType;
    int uParentVelMode;
    int uParentHasFloor;
    int uParentSurfaceOnly;
    int uParentSpeedN;
    int uParentBurstN;
    float3 uParentAxis;
    float3 uParentDir;
    float3 uParentGravity;
    float3 uParentWind;
    float3 uParentBias;
    float3 uParentShapeSize;
    float3 uParentVortexAxis;
    float2 uParentLife;
    float2 uParentSpeed;
    float4 uParentSpeedKey[8];
    float4 uParentBurstT[8];
    float4 uParentBurstC[8];
    float uParentInterior;
    float uParentAngleJitter;
    float uParentAngleBias;
    float uParentTimeShift;
    float uInherit;
    float uPathT0;
    float uPathDt;
    int uSubMode;
    float2 uSubOffset;
    float4 uParentPath[8];
    int uHasMask;
    int uHasNoise;
    int uUseErosion;
    int uBlendMode;
    int uProcedural;
    float uDistort;
    float uErodeSoft;
    float uEdgeW;
    float uEdgeI;
    float uOpacity;
    float uMaskRot;
    float uRampKeyMode;
    float uGroundY;
    float uHeightSpan;
    float uFlicker;
    float uRampBlendMode;
    float uRampBlendWeight;
    float2 uNoiseScale;
    float2 uNoisePan;
    float2 uMaskScale;
    float2 uMaskPan;
    float2 uDistortPan;
    float3 uEdgeCol;
    float4 uRamp[6];
    float4 uRampT[6];
    int uRampN;
    float4 uCurveC[8];
    int uCurveCN;
    float uCurveCEase;
    float2 uResolution;
    float uNear;
    float uFar;
    float uSoft;
    float4 uProcParams;
    float4 uStripeA[3];
    float4 uStripeB[3];
    int uStripeN;
    float3 uSymFill;
    float3 uSymOutline;
    float3 uSymHigh;
    float3 uSymInk;
    float3 uSymHot;
    float uSymHotI;
    float uSymHotA;
    float uScreenPitch;
    float uScreenOn;
    float uScreenWorld;
    float3 uScreenCol;
    int uSmokeLit;
    int uSmokeCard;
    float uSmokeAmbient;
    float3 uSmokeRight;
    float3 uSmokeUp;
    float3 uSmokeForward;
    float4 uSmokeLights[8];


Texture2D<float4> tDepth;
SamplerState samplertDepth;
Texture2D<float4> uNoise;
SamplerState sampleruNoise;
Texture2D<float4> uMask;
SamplerState sampleruMask;
Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_FragCoord;
static float2 vUv;
static float3 vWp;
static float vU;
static float vAlpha;
static float3 vSeed;
static float4 avfxColor;
static float vRot;
static float2 vTile;
static float vFrameMix;
static float2 vNextTile;

struct SPIRV_Cross_Input
{
    float2 vUv : TEXCOORD0;
    float vU : TEXCOORD1;
    float vAlpha : TEXCOORD2;
    float vRot : TEXCOORD3;
    float3 vSeed : TEXCOORD4;
    float2 vTile : TEXCOORD5;
    float2 vNextTile : TEXCOORD6;
    float vFrameMix : TEXCOORD7;
    float3 vWp : TEXCOORD8;
    float4 gl_FragCoord : SV_Position;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

float mod(float x, float y)
{
    return x - y * floor(x / y);
}

float2 mod(float2 x, float2 y)
{
    return x - y * floor(x / y);
}

float3 mod(float3 x, float3 y)
{
    return x - y * floor(x / y);
}

float4 mod(float4 x, float4 y)
{
    return x - y * floor(x / y);
}

float symStar(inout float2 p, float r, float rf, float points)
{
    float m = max(points, 3.0f);
    float an = 3.1415927410125732421875f / m;
    float en = 3.1415927410125732421875f / lerp(3.0f, m, clamp(rf, 0.0f, 1.0f));
    float2 acs = float2(cos(an), sin(an));
    float2 ecs = float2(cos(en), sin(en));
    float bn = mod(atan2(p.x, p.y), 2.0f * an) - an;
    p = float2(cos(bn), abs(sin(bn))) * length(p);
    p -= (acs * r);
    p += (ecs * clamp(-dot(p, ecs), 0.0f, (r * acs.y) / ecs.y));
    return length(p) * sign(p.x);
}

float symC(float2 p, float r)
{
    return length(p) - r;
}

float symE(float2 p, float2 r)
{
    return (length(p / r) - 1.0f) * min(r.x, r.y);
}

float symHeart(inout float2 p)
{
    p.x = abs(p.x);
    if ((p.y + p.x) > 1.0f)
    {
        return sqrt(dot(p - float2(0.25f, 0.75f), p - float2(0.25f, 0.75f))) - 0.3535533845424652099609375f;
    }
    float2 a = p - float2(0.0f, 1.0f);
    float2 b = p - (0.5f * max(p.x + p.y, 0.0f)).xx;
    return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
}

float procHash21(float2 p)
{
    float3 q = frac(float3(p.xyx) * 0.103100001811981201171875f);
    q += dot(q, q.yzx + 33.3300018310546875f.xxx).xxx;
    return frac((q.x + q.y) * q.z);
}

float symSeg(float2 p, float2 a, float2 b)
{
    float2 pa = p - a;
    float2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0f, 1.0f);
    return length(pa - (ba * h));
}

void symbolShape(float2 p, float sd, int mode, inout float body, inout float ring, inout float ink, inout float high, inout float hot)
{
    float aa = (fwidth(p.x) * 1.39999997615814208984375f) + 0.0040000001899898052215576171875f;
    float ow = max(uProcParams.x, 0.0f);
    float d = 1000.0f;
    float dInk = 1000.0f;
    float dHot = 1000.0f;
    float dHigh = 1000.0f;
    if (mode == 21)
    {
        float2 param = p;
        float param_1 = 0.699999988079071044921875f;
        float param_2 = clamp(uProcParams.y, 0.100000001490116119384765625f, 0.89999997615814208984375f);
        float param_3 = max(uProcParams.x, 3.0f);
        float _2492 = symStar(param, param_1, param_2, param_3);
        d = _2492;
        float2 param_4 = p;
        float param_5 = 0.699999988079071044921875f * clamp(uProcParams.w, 0.0500000007450580596923828125f, 1.0f);
        float param_6 = clamp(uProcParams.y, 0.100000001490116119384765625f, 0.89999997615814208984375f);
        float param_7 = max(uProcParams.x, 3.0f);
        float _2508 = symStar(param_4, param_5, param_6, param_7);
        dHot = _2508;
        ow = max(uProcParams.z, 0.0f);
    }
    else
    {
        if (mode == 22)
        {
            float ear = clamp(uProcParams.z, 0.0500000007450580596923828125f, 0.60000002384185791015625f);
            float2 param_8 = p;
            float param_9 = 0.579999983310699462890625f;
            d = symC(param_8, param_9);
            float2 param_10 = p - float2(-0.439999997615814208984375f, 0.4600000083446502685546875f);
            float param_11 = ear;
            d = min(d, symC(param_10, param_11));
            float2 param_12 = p - float2(0.439999997615814208984375f, 0.4600000083446502685546875f);
            float param_13 = ear;
            d = min(d, symC(param_12, param_13));
            float expr = floor(frac(sd * 7.309999942779541015625f) * max(uProcParams.x, 1.0f));
            float2 el = p - float2(-0.23499999940395355224609375f, 0.115000002086162567138671875f);
            float2 er = p - float2(0.23499999940395355224609375f, 0.115000002086162567138671875f);
            float eye;
            if ((expr > 0.5f) && (expr < 1.5f))
            {
                float2 param_14 = el;
                float param_15 = 0.13500000536441802978515625f;
                float2 param_16 = er;
                float param_17 = 0.13500000536441802978515625f;
                eye = min(abs(symC(param_14, param_15)) - 0.0419999994337558746337890625f, abs(symC(param_16, param_17)) - 0.0419999994337558746337890625f);
                eye = max(eye, -(p.y - 0.085000000894069671630859375f));
            }
            else
            {
                float2 param_18 = el;
                float2 param_19 = float2(0.087999999523162841796875f, 0.115000002086162567138671875f);
                float2 param_20 = er;
                float2 param_21 = float2(0.087999999523162841796875f, 0.115000002086162567138671875f);
                eye = min(symE(param_18, param_19), symE(param_20, param_21));
            }
            float _2612;
            if (expr > 1.5f)
            {
                float2 param_22 = p - float2(0.0f, -0.185000002384185791015625f);
                float2 param_23 = float2(0.115000002086162567138671875f, 0.0949999988079071044921875f);
                _2612 = symE(param_22, param_23);
            }
            else
            {
                float2 param_24 = p - float2(0.0f, 0.119999997317790985107421875f);
                float param_25 = 0.300000011920928955078125f;
                _2612 = max(abs(symC(param_24, param_25)) - 0.0379999987781047821044921875f, -((-p.y) - 0.054999999701976776123046875f));
            }
            float mouth = _2612;
            dInk = min(eye, mouth);
            float2 param_26 = p - float2(-0.439999997615814208984375f, 0.4699999988079071044921875f);
            float param_27 = ear * 0.4900000095367431640625f;
            float2 param_28 = p - float2(0.439999997615814208984375f, 0.4699999988079071044921875f);
            float param_29 = ear * 0.4900000095367431640625f;
            float inner = min(symC(param_26, param_27), symC(param_28, param_29));
            float2 param_30 = p - float2(0.0f, -0.115000002086162567138671875f);
            float2 param_31 = float2(0.23499999940395355224609375f, 0.17499999701976776123046875f) * clamp(uProcParams.w, 0.100000001490116119384765625f, 2.0f);
            dHigh = min(inner, symE(param_30, param_31));
            ow = max(uProcParams.y, 0.0f);
        }
        else
        {
            if (mode == 23)
            {
                float2 param_32 = (p + float2(0.0f, 0.7799999713897705078125f)) / 1.5499999523162841796875f.xx;
                float _2696 = symHeart(param_32);
                d = _2696 * 1.5499999523162841796875f;
            }
            else
            {
                if (mode == 24)
                {
                    float bite = clamp(uProcParams.y, 0.0f, 1.0f);
                    float2 param_33 = p - float2(-0.0599999986588954925537109375f, 0.0199999995529651641845703125f);
                    float param_34 = 0.560000002384185791015625f;
                    float2 param_35 = p - float2(0.2599999904632568359375f + (bite * 0.20000000298023223876953125f), 0.23999999463558197021484375f);
                    float param_36 = 0.5f;
                    d = max(symC(param_33, param_34), -symC(param_35, param_36));
                }
                else
                {
                    if (mode == 25)
                    {
                        float lobes = max(uProcParams.x, 1.0f);
                        float rr = clamp(uProcParams.y, 0.0500000007450580596923828125f, 0.60000002384185791015625f);
                        for (int i = 0; i < 4; i++)
                        {
                            if (float(i) >= lobes)
                            {
                                break;
                            }
                            float f = float(i) + (sd * 13.0f);
                            float2 param_37 = float2(f, 1.0f);
                            float2 param_38 = float2(f + 3.099999904632568359375f, 2.0f);
                            float2 o = float2(procHash21(param_37) - 0.5f, procHash21(param_38) - 0.5f) * 0.7200000286102294921875f;
                            float2 param_39 = float2(f + 7.30000019073486328125f, 3.0f);
                            d = min(d, length(p - o) - (rr + (0.1599999964237213134765625f * procHash21(param_39))));
                        }
                        dHigh = (d + 0.1599999964237213134765625f) - (0.300000011920928955078125f * ((p.y * 0.5f) + 0.5f));
                        ow = 0.0f;
                    }
                    else
                    {
                        float w = max(uProcParams.x, 0.0199999995529651641845703125f) * (1.0f - (clamp(uProcParams.y, 0.0f, 0.89999997615814208984375f) * abs(p.y)));
                        float2 param_40 = p;
                        float2 param_41 = float2(-0.300000011920928955078125f, 0.86000001430511474609375f);
                        float2 param_42 = 0.1599999964237213134765625f.xx;
                        float seg = symSeg(param_40, param_41, param_42);
                        float2 param_43 = p;
                        float2 param_44 = 0.1599999964237213134765625f.xx;
                        float2 param_45 = float2(-0.1599999964237213134765625f, -0.0199999995529651641845703125f);
                        seg = min(seg, symSeg(param_43, param_44, param_45));
                        float2 param_46 = p;
                        float2 param_47 = float2(-0.1599999964237213134765625f, -0.0199999995529651641845703125f);
                        float2 param_48 = float2(0.300000011920928955078125f, -0.86000001430511474609375f);
                        seg = min(seg, symSeg(param_46, param_47, param_48));
                        d = seg - w;
                        ow = 0.0f;
                    }
                }
            }
        }
    }
    body = smoothstep(aa, -aa, d);
    float _2856;
    if (ow > 0.0f)
    {
        _2856 = max(smoothstep(aa, -aa, d - ow) - body, 0.0f);
    }
    else
    {
        _2856 = 0.0f;
    }
    ring = _2856;
    ink = smoothstep(aa, -aa, dInk) * body;
    high = smoothstep(aa, -aa, dHigh) * body;
    hot = smoothstep(aa, -aa, dHot) * body;
}

float linDepth(float z)
{
    float zn = (z * 2.0f) - 1.0f;
    return ((2.0f * uNear) * uFar) / max((uFar + uNear) - (zn * (uFar - uNear)), 9.9999997473787516355514526367188e-06f);
}

float softDepth()
{
    if (uSoft <= 0.0f)
    {
        return 1.0f;
    }
    float2 sc = gl_FragCoord.xy / max(uResolution, 1.0f.xx);
    float param = tDepth.Sample(samplertDepth, sc).x;
    float sd = linDepth(param);
    float param_1 = gl_FragCoord.z;
    float fd = linDepth(param_1);
    return clamp((sd - fd) / uSoft, 0.0f, 1.0f);
}

float screentoneAt(float2 uvp, float3 wp)
{
    if (uScreenOn < 0.5f)
    {
        return 0.0f;
    }
    float2 _2904;
    if (uScreenWorld > 0.5f)
    {
        _2904 = wp.xy;
    }
    else
    {
        _2904 = uvp;
    }
    float2 q = _2904;
    float2 g = frac(q / max(uScreenPitch, 0.001000000047497451305389404296875f).xx) - 0.5f.xx;
    return smoothstep(0.36000001430511474609375f, 0.23999999463558197021484375f, length(g));
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

float hexCells(float2 uv, float2 cell)
{
    float2 q = (uv * float2(24.0f, 12.0f)) * max(cell, 0.0199999995529651641845703125f.xx);
    float2 spacing = float2(1.7320499420166015625f, 3.0f);
    float2 h1 = mod(q, spacing) - (spacing * 0.5f);
    float2 h2 = mod(q - (spacing * 0.5f), spacing) - (spacing * 0.5f);
    bool2 _972 = (dot(h1, h1) < dot(h2, h2)).xx;
    float2 h = float2(_972.x ? h1.x : h2.x, _972.y ? h1.y : h2.y);
    float edge = abs(max(abs(h.x), (abs(h.x) * 0.5f) + (abs(h.y) * 0.86602497100830078125f)) - 0.86602497100830078125f);
    return 1.0f - smoothstep(0.0350000001490116119384765625f, 0.100000001490116119384765625f, edge);
}

float pointedShape(float2 p, float arms, float outerRadius, float innerRadius)
{
    float angle = atan2(p.y, p.x);
    float halfAngle = 3.1415927410125732421875f / arms;
    float q = abs(mod((angle - 1.57079601287841796875f) + halfAngle, halfAngle * 2.0f) - halfAngle);
    float2 outer = float2(outerRadius, 0.0f);
    float2 inner = float2(cos(halfAngle), sin(halfAngle)) * innerRadius;
    float2 ray = float2(cos(q), sin(q));
    float2 edge = inner - outer;
    float boundary = (outer.x * inner.y) / ((ray.x * edge.y) - (ray.y * edge.x));
    return 1.0f - smoothstep(boundary - 0.008000000379979610443115234375f, boundary + 0.008000000379979610443115234375f, length(p));
}

float safePow(float base, float e)
{
    return pow(max(base, 9.9999997473787516355514526367188e-06f), e);
}

float procNoise(float2 p)
{
    float2 i = floor(p);
    float2 f = frac(p);
    float2 param = i;
    float a = procHash21(param);
    float2 param_1 = i + float2(1.0f, 0.0f);
    float b = procHash21(param_1);
    float2 param_2 = i + float2(0.0f, 1.0f);
    float c = procHash21(param_2);
    float2 param_3 = i + 1.0f.xx;
    float d = procHash21(param_3);
    float2 u = (f * f) * (3.0f.xx - (f * 2.0f));
    return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y);
}

float proceduralShape(float2 p, float2 uv, float n, float t, float fres, float2 cell, float3 dims, int mode)
{
    if (mode == 3)
    {
        return 1.0f;
    }
    float disc = smoothstep(0.5f, 0.100000001490116119384765625f, length(p));
    if (mode == 1)
    {
        return clamp(disc * (0.449999988079071044921875f + (n * 1.10000002384185791015625f)), 0.0f, 1.0f);
    }
    if (mode == 2)
    {
        return clamp(disc * (0.60000002384185791015625f + (n * 0.800000011920928955078125f)), 0.0f, 1.0f);
    }
    float2 q = p * 2.0f;
    if (mode == 4)
    {
        float2 param = uv;
        float2 param_1 = cell;
        return clamp(0.100000001490116119384765625f + (0.89999997615814208984375f * hexCells(param, param_1)), 0.0f, 1.0f);
    }
    if (mode == 5)
    {
        float3 param_2 = float3((uv * float2(12.0f, 6.0f)) * max(cell, 0.0199999995529651641845703125f.xx), 1.0f);
        float field = 0.5f + (0.5f * snoise(param_2));
        float veins = 1.0f - smoothstep(0.01200000010430812835693359375f, 0.02999999932944774627685546875f, abs(field - 0.5f));
        return clamp((0.119999997317790985107421875f + ((0.550000011920928955078125f * fres) * fres)) + (0.800000011920928955078125f * veins), 0.0f, 1.0f);
    }
    if ((mode == 6) || (mode == 7))
    {
        float bend = sin((q.y * 2.7999999523162841796875f) - (t * 2.2000000476837158203125f)) * 0.119999997317790985107421875f;
        float waves = sin(((q.x + bend) * 9.5f) + (q.y * 0.699999988079071044921875f));
        float streak = smoothstep(0.7200000286102294921875f, 0.920000016689300537109375f, waves) * (0.64999997615814208984375f + (0.3499999940395355224609375f * sin((q.y * 2.0f) - (t * 2.0f))));
        float _1143;
        if (mode == 7)
        {
            _1143 = streak;
        }
        else
        {
            _1143 = 0.87999999523162841796875f + (0.119999997317790985107421875f * streak);
        }
        return clamp(_1143, 0.0f, 1.0f);
    }
    if (mode == 8)
    {
        float2 param_3 = q;
        float param_4 = 5.0f;
        float param_5 = 0.7799999713897705078125f;
        float param_6 = 0.310000002384185791015625f;
        return pointedShape(param_3, param_4, param_5, param_6);
    }
    if (mode == 9)
    {
        float2 param_7 = q;
        float param_8 = 4.0f;
        float param_9 = 0.89999997615814208984375f;
        float param_10 = 0.0900000035762786865234375f;
        return pointedShape(param_7, param_8, param_9, param_10);
    }
    if (mode == 10)
    {
        float edgeDistance = min((1.0f - abs(q.x)) * max(dims.x, 0.001000000047497451305389404296875f), ((1.0f - abs(q.y)) * max(dims.y, 0.001000000047497451305389404296875f)) * 0.5f);
        float border = 1.0f - smoothstep(max(dims.z, 0.001000000047497451305389404296875f) * 0.64999997615814208984375f, max(dims.z, 0.001000000047497451305389404296875f) * 1.14999997615814208984375f, edgeDistance);
        return clamp((border * 0.800000011920928955078125f) + ((0.07999999821186065673828125f + (0.2199999988079071044921875f * n)) * (1.0f - border)), 0.0f, 1.0f);
    }
    if (mode == 12)
    {
        float c = 0.928664624691009521484375f;
        float sn = 0.370920479297637939453125f;
        float2 g = float2((q.x * c) - (q.y * sn), (q.x * sn) + (q.y * c));
        float r = length(g);
        float param_11 = max(0.0f, 1.0f - r);
        float param_12 = 6.0f;
        float core = safePow(param_11, param_12);
        float param_13 = max(0.0f, 1.0f - abs(g.x));
        float param_14 = 2.0f;
        float param_15 = max(0.0f, 1.0f - (abs(g.y) * 7.0f));
        float param_16 = 2.5f;
        float ax = safePow(param_13, param_14) * safePow(param_15, param_16);
        float param_17 = max(0.0f, 1.0f - abs(g.y));
        float param_18 = 2.0f;
        float param_19 = max(0.0f, 1.0f - (abs(g.x) * 7.0f));
        float param_20 = 2.5f;
        float ay = safePow(param_17, param_18) * safePow(param_19, param_20);
        return clamp(((core * 1.2000000476837158203125f) + ax) + ay, 0.0f, 2.0f);
    }
    if (mode == 13)
    {
        float param_21 = max(0.0f, 1.0f - length(q));
        float param_22 = 2.599999904632568359375f;
        return safePow(param_21, param_22);
    }
    if (mode == 14)
    {
        float R = max(uProcParams.x, 0.0199999995529651641845703125f);
        float hw = max(uProcParams.y, 0.00200000009499490261077880859375f);
        float amp = uProcParams.z;
        float d = length(q);
        float ang = atan2(q.y, q.x);
        float m = 0.0f;
        for (int i = 0; i < 3; i++)
        {
            float fi = float(i);
            float spin = ((uProcParams.w * t) * (1.0f + (fi * 0.3499999940395355224609375f))) + (fi * 2.0899999141693115234375f);
            float wob = amp * ((sin((ang * (4.0f + fi)) + spin) * 0.60000002384185791015625f) + (sin((ang * (7.0f + (fi * 2.0f))) - (spin * 0.699999988079071044921875f)) * 0.4000000059604644775390625f));
            float r_1 = (R * ((1.0f + (fi * 0.0350000001490116119384765625f)) - 0.0350000001490116119384765625f)) + wob;
            float g_1 = (d - r_1) / hw;
            m += (exp((-g_1) * g_1) * (1.0f - (fi * 0.2199999988079071044921875f)));
        }
        float sector = floor((((ang + 3.1415927410125732421875f) / 6.283185482025146484375f) * 9.0f) + ((uProcParams.w * t) * 0.5f));
        float ga = (d - (R * 1.15999996662139892578125f)) / (hw * 1.39999997615814208984375f);
        float2 param_23 = float2(sector, 3.7000000476837158203125f);
        float param_24 = abs(sin((ang * 9.0f) + ((uProcParams.w * t) * 0.5f)));
        float param_25 = 6.0f;
        float arc = ((step(0.62000000476837158203125f, procHash21(param_23)) * exp((-ga) * ga)) * safePow(param_24, param_25)) * smoothstep(0.0f, 0.0040000001899898052215576171875f, amp);
        return clamp(m + (arc * 0.89999997615814208984375f), 0.0f, 2.0f);
    }
    if (mode == 15)
    {
        float R_1 = max(uProcParams.x, 0.0199999995529651641845703125f);
        float soft = max(uProcParams.w, 0.0199999995529651641845703125f);
        float d_1 = length(q);
        float ang_1 = atan2(q.y, q.x);
        float pulse = 0.7200000286102294921875f + (0.2800000011920928955078125f * sin(uProcParams.y * t));
        float fill = smoothstep(R_1 + soft, R_1 * (1.0f - soft), d_1) * pulse;
        float2 param_26 = float2(ang_1 * 2.400000095367431640625f, (d_1 * 5.0f) - (t * 0.699999988079071044921875f));
        fill *= lerp(1.0f, 0.550000011920928955078125f + (0.449999988079071044921875f * procNoise(param_26)), clamp(uProcParams.z, 0.0f, 1.0f));
        return clamp(fill, 0.0f, 1.0f);
    }
    if (mode == 16)
    {
        float r_2 = length(q);
        float ang_2 = atan2(q.y, q.x);
        float ta = (ang_2 / 6.283185482025146484375f) + 0.5f;
        float rings = 0.0f;
        float nr = max(uProcParams.x, 1.0f);
        for (int i_1 = 0; i_1 < 6; i_1++)
        {
            if (float(i_1) >= nr)
            {
                break;
            }
            float rr = 0.98500001430511474609375f - (float(i_1) * 0.2150000035762786865234375f);
            rings += ((1.0f - smoothstep(0.0f, 0.0074999998323619365692138671875f, abs(r_2 - rr))) * 1.14999997615814208984375f);
            rings += ((1.0f - smoothstep(0.0f, 0.00449999980628490447998046875f, abs((r_2 - rr) + 0.02999999932944774627685546875f))) * 0.550000011920928955078125f);
        }
        float cells = max(uProcParams.y, 1.0f);
        float ci = floor(ta * cells);
        float cf = frac(ta * cells);
        float glyph = 0.0f;
        for (int k = 0; k < 3; k++)
        {
            float2 param_27 = float2((ci * 3.7000000476837158203125f) + (float(k) * 11.30000019073486328125f), 1.0f);
            float hk = procHash21(param_27);
            float2 param_28 = float2((ci * 5.099999904632568359375f) + (float(k) * 7.900000095367431640625f), 2.0f);
            float rr_1 = 0.805000007152557373046875f + (0.13500000536441802978515625f * procHash21(param_28));
            float2 param_29 = float2((ci * 2.2999999523162841796875f) + (float(k) * 19.1000003814697265625f), 3.0f);
            float ln = 0.1599999964237213134765625f + (0.2800000011920928955078125f * procHash21(param_29));
            float2 param_30 = float2((ci * 9.69999980926513671875f) + (float(k) * 3.099999904632568359375f), 4.0f);
            float th = 0.0054999999701976776123046875f + (0.0054999999701976776123046875f * procHash21(param_30));
            glyph += ((step(0.300000011920928955078125f, hk) * (1.0f - smoothstep(0.0f, th, abs(r_2 - rr_1)))) * smoothstep(ln, ln * 0.550000011920928955078125f, abs(cf - 0.5f)));
        }
        float spokes = max(uProcParams.z, 1.0f);
        float spoke = (step(0.5f, 1.0f - (abs(frac(ta * spokes) - 0.5f) * 9.0f)) * smoothstep(0.0f, 0.0199999995529651641845703125f, r_2 - 0.795000016689300537109375f)) * smoothstep(0.954999983310699462890625f, 0.939999997615814208984375f, r_2);
        glyph += (max(spoke, 0.0f) * 0.699999988079071044921875f);
        float ci2 = floor((ta * cells) * 0.62000000476837158203125f);
        float cf2 = frac((ta * cells) * 0.62000000476837158203125f);
        float2 param_31 = float2(ci2 * 8.30000019073486328125f, 5.0f);
        float r2 = 0.660000026226043701171875f + (0.070000000298023223876953125f * procHash21(param_31));
        float2 param_32 = float2((ci2 * 2.7000000476837158203125f) + 5.5f, 6.0f);
        glyph += (((step(0.4199999868869781494140625f, procHash21(param_32)) * (1.0f - smoothstep(0.0f, 0.006000000052154064178466796875f, abs(r_2 - r2)))) * smoothstep(0.300000011920928955078125f, 0.1599999964237213134765625f, abs(cf2 - 0.5f))) * 0.800000011920928955078125f);
        float2 param_33 = float2((ta * 7.0f) + (t * 0.10999999940395355224609375f), (r_2 * 3.2000000476837158203125f) - (t * 0.180000007152557373046875f));
        float m1 = procNoise(param_33);
        float2 param_34 = float2((ta * 4.0f) - (t * 0.070000000298023223876953125f), (r_2 * 5.400000095367431640625f) + (t * 0.0900000035762786865234375f));
        float m2 = procNoise(param_34);
        float param_35 = clamp(((m1 * 0.7200000286102294921875f) + (m2 * 0.60000002384185791015625f)) - 0.2599999904632568359375f, 0.0f, 1.0f);
        float param_36 = 1.5f;
        float mist = (safePow(param_35, param_36) * smoothstep(0.800000011920928955078125f, 0.100000001490116119384765625f, r_2)) + (0.3400000035762786865234375f * smoothstep(0.839999973773956298828125f, 0.100000001490116119384765625f, r_2));
        float gold = (1.0f - smoothstep(0.0f, 0.01600000075995922088623046875f, abs(r_2 - 1.0299999713897705078125f))) * clamp(uProcParams.w, 0.0f, 1.0f);
        return clamp((((rings * 1.25f) + (glyph * 1.0f)) + (mist * 0.7200000286102294921875f)) + gold, 0.0f, 1.60000002384185791015625f);
    }
    if (mode == 17)
    {
        float tight = max(uProcParams.x, 1.0f);
        float aniso = max(uProcParams.y, 0.0500000007450580596923828125f);
        float spikes = max(uProcParams.z, 1.0f);
        float fall = max(uProcParams.w, 0.0500000007450580596923828125f);
        float2 qa = float2(q.x * aniso, q.y);
        float r_3 = length(qa);
        float rr_2 = length(q);
        float core_1 = exp(((-r_3) * r_3) * tight);
        float mid = exp((((-r_3) * r_3) * tight) * 0.17000000178813934326171875f) * 0.439999997615814208984375f;
        float wide = exp((((-r_3) * r_3) * tight) * 0.0599999986588954925537109375f) * 0.119999997317790985107421875f;
        float hstr = (exp(((-qa.y) * qa.y) * 230.0f) * exp((-abs(qa.x)) * 2.400000095367431640625f)) * 0.439999997615814208984375f;
        float vstr = (exp(((-qa.x) * qa.x) * 330.0f) * exp((-abs(qa.y)) * 1.7000000476837158203125f)) * 0.37999999523162841796875f;
        float ang_3 = atan2(q.y, q.x);
        float param_37 = max(0.0f, cos((ang_3 * spikes) + 0.4000000059604644775390625f));
        float param_38 = 16.0f;
        float spk = (safePow(param_37, param_38) * exp((-rr_2) * fall)) * 0.1599999964237213134765625f;
        float2 param_39 = float2(ang_3 * 2.2999999523162841796875f, t * 3.099999904632568359375f);
        float flick = 0.89999997615814208984375f + (0.14000000059604644775390625f * procNoise(param_39));
        float a = ((((((core_1 * 1.35000002384185791015625f) + mid) + wide) + hstr) + vstr) + spk) * flick;
        return clamp(a * (1.0f - smoothstep(0.62000000476837158203125f, 1.0f, rr_2)), 0.0f, 4.0f);
    }
    if (mode == 18)
    {
        float n_1 = max(uProcParams.x, 1.0f);
        float jit = clamp(uProcParams.y, 0.0f, 1.0f);
        float sharp = clamp(uProcParams.w, 0.0f, 1.0f);
        float r_4 = length(q);
        float ang_4 = atan2(q.y, q.x) + (uProcParams.z * t);
        float ta_1 = ((ang_4 / 6.283185482025146484375f) + 0.5f) * n_1;
        float idx = floor(ta_1);
        float2 param_40 = float2(idx, 3.099999904632568359375f);
        float len = lerp(1.0f - jit, 1.0f, procHash21(param_40));
        float f = abs(frac(ta_1) - 0.5f) * 2.0f;
        float param_41 = max(0.0f, 1.0f - f);
        float param_42 = lerp(2.0f, 24.0f, sharp);
        float ray = safePow(param_41, param_42);
        float fade = 1.0f - smoothstep(0.0f, max(len, 0.0199999995529651641845703125f), r_4);
        return clamp(((ray * fade) * fade) * (1.0f - smoothstep(0.898999989032745361328125f, 1.0f, r_4)), 0.0f, 2.0f);
    }
    if (mode == 20)
    {
        float u = uv.y;
        float v = (uv.x - 0.5f) * 2.0f;
        float w = lerp(0.300000011920928955078125f, 1.0f, smoothstep(0.0f, 0.62000000476837158203125f, u)) * (1.0f - smoothstep(0.86000001430511474609375f, 1.0f, u));
        float dd = abs(v) / max(w, 0.001000000047497451305389404296875f);
        float param_43 = max(0.0f, 1.0f - dd);
        float param_44 = 2.2000000476837158203125f;
        float body = safePow(param_43, param_44);
        float param_45 = max(0.0f, 1.0f - (dd * max(uProcParams.z, 1.0f)));
        float param_46 = 5.0f;
        float core_2 = safePow(param_45, param_46) * smoothstep(0.20000000298023223876953125f, 0.800000011920928955078125f, u);
        float param_47 = max(0.0f, 1.0f - length(float2((u - 0.800000011920928955078125f) * 2.099999904632568359375f, v * 1.0499999523162841796875f)));
        float param_48 = max(uProcParams.w, 0.5f);
        float halo = safePow(param_47, param_48);
        float param_49 = max(0.0f, 1.0f - (dd * 1.39999997615814208984375f));
        float param_50 = 3.0f;
        float dash = ((step(0.62000000476837158203125f, frac((u * max(uProcParams.x, 0.0f)) - (t * uProcParams.y))) * safePow(param_49, param_50)) * smoothstep(0.0f, 0.3499999940395355224609375f, u)) * (1.0f - smoothstep(0.550000011920928955078125f, 0.85000002384185791015625f, u));
        return clamp((((body * 0.800000011920928955078125f) + core_2) + (halo * 1.10000002384185791015625f)) + (dash * 0.699999988079071044921875f), 0.0f, 2.0f);
    }
    if (mode == 11)
    {
        float edge = 0.4799999892711639404296875f + (0.0350000001490116119384765625f * sin((q.y * 18.0f) - (t * 10.0f)));
        float side = 1.0f - smoothstep(edge - 0.02500000037252902984619140625f, edge + 0.02500000037252902984619140625f, abs(q.x));
        float ends = 1.0f - smoothstep(0.939999997615814208984375f, 1.0f, abs(q.y));
        return clamp(side * ends, 0.0f, 1.0f);
    }
    return disc;
}

float curveC(inout float u)
{
    u = clamp(u, 0.0f, 1.0f);
    float v = uCurveC[0].xy.y;
    for (int i = 1; i < 8; i++)
    {
        if (i >= uCurveCN)
        {
            break;
        }
        float a = uCurveC[i - 1].xy.x;
        float b = uCurveC[i].xy.x;
        float f = clamp((u - a) / max(b - a, 9.9999997473787516355514526367188e-06f), 0.0f, 1.0f);
        f = lerp(f, (f * f) * (3.0f - (2.0f * f)), uCurveCEase);
        v = lerp(v, uCurveC[i].xy.y, step(a, u) * f);
    }
    return v;
}

float particleRampKey(float mode)
{
    if (mode > 4.5f)
    {
        return clamp(vUv.y, 0.0f, 1.0f);
    }
    if (mode > 3.5f)
    {
        return clamp(length((vUv - 0.5f.xx) * 2.0f), 0.0f, 1.0f);
    }
    if (mode > 2.5f)
    {
        return clamp((vWp.y - uGroundY) / max(uHeightSpan, 0.001000000047497451305389404296875f), 0.0f, 1.0f);
    }
    return clamp(vU, 0.0f, 1.0f);
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

float3 smokeNormal(float2 uv)
{
    float2 xy = (uv * 2.0f) - 1.0f.xx;
    float z = sqrt(max(0.0f, 1.0f - dot(xy, xy)));
    return normalize(((uSmokeRight * xy.x) + (uSmokeUp * xy.y)) + (uSmokeForward * max(z, 0.00999999977648258209228515625f)));
}

float3 smokeLighting(float3 normal, float3 world)
{
    float3 light = uSmokeAmbient.xxx;
    for (int i = 0; i < 4; i++)
    {
        float3 delta = uSmokeLights[i].xyz - world;
        float d = length(delta);
        float3 direction = delta / max(d, 0.001000000047497451305389404296875f).xxx;
        float wrap = clamp((dot(normal, direction) + 0.5f) / 1.5f, 0.0f, 1.0f);
        float rangeFade = 1.0f - smoothstep(uSmokeLights[i].w * 0.75f, uSmokeLights[i].w, d);
        float attenuation = rangeFade / max(pow(max(d, 0.25f), uSmokeLights[i + 4].w), 1.0f);
        light += ((uSmokeLights[i + 4].xyz * wrap) * attenuation);
    }
    return light;
}

void frag_main()
{
    if (vAlpha <= 0.0f)
    {
        discard;
    }
    if (uProcedural >= 21)
    {
        float2 sp = (vUv - 0.5f.xx) * 2.0f;
        float2 param = sp;
        float param_1 = vSeed.x;
        int param_2 = uProcedural;
        float param_3;
        float param_4;
        float param_5;
        float param_6;
        float param_7;
        symbolShape(param, param_1, param_2, param_3, param_4, param_5, param_6, param_7);
        float body = param_3;
        float ring = param_4;
        float ink = param_5;
        float high = param_6;
        float hot = param_7;
        float a = ((((body + ring) * vAlpha) * uOpacity) * uFlicker) * softDepth();
        if (((body + ring) < 0.0040000001899898052215576171875f) || (a < 0.0030000000260770320892333984375f))
        {
            discard;
        }
        float2 param_8 = vUv;
        float3 param_9 = vWp;
        float tone = screentoneAt(param_8, param_9) * body;
        float3 col = lerp(uSymFill, uScreenCol, (tone * 0.550000011920928955078125f).xxx);
        col = lerp(col, uSymHigh, (high * 0.85000002384185791015625f).xxx);
        col = lerp(col, uSymHot, (hot * uSymHotA).xxx);
        col = lerp(col, uSymOutline, ring.xxx);
        col = lerp(col, uSymInk, ink.xxx);
        col *= (1.0f + ((hot * uSymHotA) * uSymHotI));
        if (uBlendMode == 1)
        {
            avfxColor = float4(col, clamp(a, 0.0f, 1.0f));
        }
        else
        {
            avfxColor = float4(col * a, clamp(a, 0.0f, 1.0f));
        }
        return;
    }
    float rot = vRot + uMaskRot;
    float2 p = vUv - 0.5f.xx;
    float c = cos(rot);
    float s = sin(rot);
    p = mul(p, float2x2(float2(c, -s), float2(s, c)));
    float2 uvp = p + 0.5f.xx;
    float n = 0.5f;
    bool _3284 = uUseErosion == 1;
    bool _3293;
    if (!_3284)
    {
        _3293 = abs(uDistort) > 0.0f;
    }
    else
    {
        _3293 = _3284;
    }
    bool _3314;
    if (!_3293)
    {
        bool _3300 = uHasMask == 0;
        bool _3313;
        if (_3300)
        {
            bool _3305 = uProcedural == 1;
            bool _3312;
            if (!_3305)
            {
                _3312 = uProcedural == 2;
            }
            else
            {
                _3312 = _3305;
            }
            _3313 = _3312;
        }
        else
        {
            _3313 = _3300;
        }
        _3314 = _3313;
    }
    else
    {
        _3314 = _3293;
    }
    bool needsNoise = _3314;
    bool _3322;
    if (needsNoise)
    {
        _3322 = uHasNoise == 1;
    }
    else
    {
        _3322 = needsNoise;
    }
    if (_3322)
    {
        float2 nuv = ((uvp * uNoiseScale) + (uNoisePan * uTime)) + (vSeed.xy * 7.0f);
        float n1 = uNoise.Sample(sampleruNoise, nuv).x;
        float n2 = uNoise.Sample(sampleruNoise, ((nuv * 1.7000000476837158203125f) + float2(0.300000011920928955078125f, 0.100000001490116119384765625f)) - ((uNoisePan * uTime) * 0.60000002384185791015625f)).x;
        n = (n1 * 0.64999997615814208984375f) + (n2 * 0.3499999940395355224609375f);
    }
    else
    {
        if (needsNoise)
        {
            float3 param_10 = float3(((uvp * uNoiseScale) * 2.0f) + (uNoisePan * uTime), vSeed.x * 17.0f);
            n = 0.5f + (0.5f * fbm3(param_10));
        }
    }
    float nd = n;
    float2 dp = uDistortPan * uTime;
    bool _3406 = abs(uDistort) > 0.0f;
    bool _3413;
    if (_3406)
    {
        _3413 = dot(dp, dp) > 0.0f;
    }
    else
    {
        _3413 = _3406;
    }
    if (_3413)
    {
        if (uHasNoise == 1)
        {
            nd = uNoise.Sample(sampleruNoise, (((uvp * uNoiseScale) + (uNoisePan * uTime)) + dp) + (vSeed.xy * 7.0f)).x;
        }
        else
        {
            float3 param_11 = float3((((uvp * uNoiseScale) * 2.0f) + (uNoisePan * uTime)) + dp, vSeed.x * 17.0f);
            nd = 0.5f + (0.5f * fbm3(param_11));
        }
    }
    float2 duv = uvp + (((nd - 0.5f) * uDistort) * (0.4000000059604644775390625f + vU)).xx;
    float inside = ((step(0.0f, duv.x) * step(duv.x, 1.0f)) * step(0.0f, duv.y)) * step(duv.y, 1.0f);
    float2 muv = (duv * uMaskScale) + uMaskPan;
    float2 auv = float2(muv.x / float(max(uAtlasCols, 1)), muv.y / float(max(uAtlasRows, 1))) + vTile;
    float shape;
    if (uHasMask == 1)
    {
        float4 m = uMask.Sample(sampleruMask, auv);
        shape = m.w * max(m.x, max(m.y, m.z));
        if (vFrameMix > 0.0f)
        {
            float4 next = uMask.Sample(sampleruMask, (auv - vTile) + vNextTile);
            shape = lerp(shape, next.w * max(next.x, max(next.y, next.z)), vFrameMix);
        }
    }
    else
    {
        float2 param_12 = p;
        float2 param_13 = uvp;
        float param_14 = n;
        float param_15 = uTime;
        float param_16 = 0.0f;
        float2 param_17 = uMaskScale;
        float3 param_18 = float3(1.0f, 1.0f, 0.100000001490116119384765625f);
        int param_19 = uProcedural;
        shape = proceduralShape(param_12, param_13, param_14, param_15, param_16, param_17, param_18, param_19);
    }
    shape *= inside;
    float er = shape;
    float edge = 0.0f;
    if (uUseErosion == 1)
    {
        float param_20 = vU;
        float _3605 = curveC(param_20);
        float th = _3605;
        float field = shape * (0.3499999940395355224609375f + (n * 0.89999997615814208984375f));
        er = smoothstep(th, th + uErodeSoft, field);
        edge = smoothstep(th - uEdgeW, th + (uErodeSoft * 0.5f), field) - er;
    }
    float param_21 = uRampKeyMode;
    float key = particleRampKey(param_21);
    if (uRampBlendWeight > 0.0f)
    {
        float param_22 = uRampBlendMode;
        key = lerp(key, particleRampKey(param_22), uRampBlendWeight);
    }
    float param_23 = key;
    float3 _3658 = rampColor(param_23);
    float3 col_1 = _3658;
    if (uSmokeLit == 1)
    {
        float2 param_24 = vUv;
        float3 param_25 = smokeNormal(param_24);
        float3 param_26 = vWp;
        col_1 *= smokeLighting(param_25, param_26);
    }
    col_1 += (((uEdgeCol * uEdgeI) * edge) * shape);
    float a_1 = (((er * vAlpha) * uOpacity) * uFlicker) * softDepth();
    if (a_1 < 0.00200000009499490261077880859375f)
    {
        discard;
    }
    if (uBlendMode == 1)
    {
        avfxColor = float4(col_1, a_1);
    }
    else
    {
        avfxColor = float4(col_1 * a_1, a_1);
    }
}

SPIRV_Cross_Output avfxFragment(SPIRV_Cross_Input stage_input)
{
    gl_FragCoord = stage_input.gl_FragCoord;
    gl_FragCoord.w = 1.0 / gl_FragCoord.w;
    vUv = stage_input.vUv;
    vWp = stage_input.vWp;
    vU = stage_input.vU;
    vAlpha = stage_input.vAlpha;
    vSeed = stage_input.vSeed;
    vRot = stage_input.vRot;
    vTile = stage_input.vTile;
    vFrameMix = stage_input.vFrameMix;
    vNextTile = stage_input.vNextTile;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }