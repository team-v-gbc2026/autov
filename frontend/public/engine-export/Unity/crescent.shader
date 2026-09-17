Shader "autoV/Native/crescent" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float3 uEx;
    float3 uEy;
    float3 uN;
    float uR;
    float uPh0;
    float uSweep;
    float uWmax;
    float uHead;
    float uTail;
    float uScale;
    float uRadOff;
    float uWiden;
    float uTime;
    float uSeed;
    float uPeakFrom;
    float uTipPower;
    float uRootFade;
    float uScreenSpace;
    float3 uC0;
    float3 uC1;
    float3 uC2;
    float3 uC3;
    float3 uStreakCol;
    float4 uI;
    float uAlpha;
    float uTear;
    float uErode;
    float uTipHot;
    float uStreakOn;
    float uStreakFreq;
    float uStreakPan;
    float uStreakI;
    float uStreakSeg;
    float uVorScale;
    float uSeamWidth;
    float uFrontWidth;
    float4 uBandT;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float avfxVertexIndex;
static float vWin;
static float vS;
static float vQ;
static float vTipD;
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
    float vS : TEXCOORD0;
    float vQ : TEXCOORD1;
    float vWin : TEXCOORD2;
    float vTipD : TEXCOORD3;
    float4 gl_Position : SV_Position;
};

static float aS;
static float aQ;

float crescentWidth(float s)
{
    float dt = uHead - s;
    float rise = pow(max(smoothstep(0.0f, uPeakFrom * 0.89999997615814208984375f, dt), 9.9999997473787516355514526367188e-05f), uTipPower);
    float fall = 1.0f - smoothstep(uPeakFrom, uPeakFrom * 2.599999904632568359375f, dt);
    float root = pow(max(smoothstep(0.0f, uRootFade, s - uTail), 9.9999997473787516355514526367188e-05f), 0.800000011920928955078125f);
    return ((uWmax * rise) * (0.14000000059604644775390625f + (0.86000001430511474609375f * fall))) * root;
}

float vorHash11(inout float p)
{
    p = frac(p * 0.103100001811981201171875f);
    p *= (p + 33.3300018310546875f);
    p *= (p + p);
    return frac(p);
}

float vorHash21(float2 p)
{
    float param = dot(p, float2(127.09999847412109375f, 311.70001220703125f));
    float _51 = vorHash11(param);
    return _51;
}

float vorNoise(float2 p)
{
    float2 i = floor(p);
    float2 f = frac(p);
    float2 param = i;
    float a = vorHash21(param);
    float2 param_1 = i + float2(1.0f, 0.0f);
    float b = vorHash21(param_1);
    float2 param_2 = i + float2(0.0f, 1.0f);
    float c = vorHash21(param_2);
    float2 param_3 = i + 1.0f.xx;
    float d = vorHash21(param_3);
    float2 u = (f * f) * (3.0f.xx - (f * 2.0f));
    return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y);
}

float vorFbm(float2 p)
{
    float2 param = p;
    float2 param_1 = (p * 2.0699999332427978515625f) + 11.30000019073486328125f.xx;
    float2 param_2 = (p * 4.110000133514404296875f) + 5.69999980926513671875f.xx;
    return ((0.550000011920928955078125f * vorNoise(param)) + (0.2800000011920928955078125f * vorNoise(param_1))) + (0.17000000178813934326171875f * vorNoise(param_2));
}

void vert_main()
{
    aS = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 2) + 0) % 1024, ((int(avfxVertexIndex) * 2) + 0) / 1024), 0)).x;
    aQ = avfxAttributes.Load(int3(int2(((int(avfxVertexIndex) * 2) + 1) % 1024, ((int(avfxVertexIndex) * 2) + 1) / 1024), 0)).x;
    float ph = uPh0 + (aS * uSweep);
    float3 rad = (uEx * cos(ph)) + (uEy * sin(ph));
    float param = aS;
    float w = crescentWidth(param) * uScale;
    float2 param_1 = float2((aS * 7.0f) - (uTime * 1.10000002384185791015625f), uSeed);
    float flut = vorFbm(param_1) - 0.5f;
    w *= ((1.0f + (uWiden * (0.550000011920928955078125f + (1.5f * flut)))) + (0.14000000059604644775390625f * flut));
    float3 ctr = mul(float4(rad * uR, 1.0f), modelMatrix).xyz;
    float3 tang = normalize(mul(normalize(((-uEx) * sin(ph)) + (uEy * cos(ph))), float3x3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz)));
    float3 nrm = normalize(mul(uN, float3x3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz)));
    float3 across;
    if (uScreenSpace > 0.5f)
    {
        float3 view = normalize(cameraPosition - ctr);
        across = normalize(cross(tang, view));
        float3 wr = normalize(mul(rad, float3x3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz)));
        across *= sign(dot(across, wr));
    }
    else
    {
        across = normalize(mul(rad, float3x3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz)));
    }
    float off = ((0.5f - aQ) * w) + uRadOff;
    float3 p = ctr + (across * off);
    vWin = smoothstep(uTail, uTail + 0.0350000001490116119384765625f, aS) * (1.0f - smoothstep(uHead - 0.01200000010430812835693359375f, uHead, aS));
    vS = aS;
    vQ = aQ;
    vTipD = clamp((uHead - aS) / max(uPeakFrom * 0.75f, 0.001000000047497451305389404296875f), 0.0f, 1.0f);
    gl_Position = mul(float4(p, 1.0f), mul(viewMatrix, projectionMatrix));
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
    stage_output.vWin = vWin;
    stage_output.vS = vS;
    stage_output.vQ = vQ;
    stage_output.vTipD = vTipD;
    return stage_output;
}

#else

    row_major float4x4 modelMatrix;
    row_major float4x4 viewMatrix;
    row_major float4x4 projectionMatrix;
    row_major float4x4 modelViewMatrix;
    row_major float3x3 normalMatrix;
    float3 cameraPosition;
    float3 uEx;
    float3 uEy;
    float3 uN;
    float uR;
    float uPh0;
    float uSweep;
    float uWmax;
    float uHead;
    float uTail;
    float uScale;
    float uRadOff;
    float uWiden;
    float uTime;
    float uSeed;
    float uPeakFrom;
    float uTipPower;
    float uRootFade;
    float uScreenSpace;
    float3 uC0;
    float3 uC1;
    float3 uC2;
    float3 uC3;
    float3 uStreakCol;
    float4 uI;
    float uAlpha;
    float uTear;
    float uErode;
    float uTipHot;
    float uStreakOn;
    float uStreakFreq;
    float uStreakPan;
    float uStreakI;
    float uStreakSeg;
    float uVorScale;
    float uSeamWidth;
    float uFrontWidth;
    float4 uBandT;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float vWin;
static float vS;
static float vQ;
static float vTipD;
static float4 avfxColor;

struct SPIRV_Cross_Input
{
    float vS : TEXCOORD0;
    float vQ : TEXCOORD1;
    float vWin : TEXCOORD2;
    float vTipD : TEXCOORD3;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

float vorHash11(inout float p)
{
    p = frac(p * 0.103100001811981201171875f);
    p *= (p + 33.3300018310546875f);
    p *= (p + p);
    return frac(p);
}

float vorHash21(float2 p)
{
    float param = dot(p, float2(127.09999847412109375f, 311.70001220703125f));
    float _57 = vorHash11(param);
    return _57;
}

float2 voronoi2(float2 p)
{
    float2 ip = floor(p);
    float2 fp = frac(p);
    float d1 = 8.0f;
    float d2 = 8.0f;
    float id = 0.0f;
    for (int y = -1; y <= 1; y++)
    {
        for (int x = -1; x <= 1; x++)
        {
            float2 g = float2(float(x), float(y));
            float2 param = ip + g;
            float2 param_1 = (ip + g) + float2(37.700000762939453125f, 11.30000019073486328125f);
            float2 o = float2(vorHash21(param), vorHash21(param_1));
            float2 r = (g + o) - fp;
            float d = dot(r, r);
            if (d < d1)
            {
                d2 = d1;
                d1 = d;
                float2 param_2 = (ip + g) + float2(7.099999904632568359375f, 3.900000095367431640625f);
                id = vorHash21(param_2);
            }
            else
            {
                if (d < d2)
                {
                    d2 = d;
                }
            }
        }
    }
    return float2(id, sqrt(d2) - sqrt(d1));
}

float vorNoise(float2 p)
{
    float2 i = floor(p);
    float2 f = frac(p);
    float2 param = i;
    float a = vorHash21(param);
    float2 param_1 = i + float2(1.0f, 0.0f);
    float b = vorHash21(param_1);
    float2 param_2 = i + float2(0.0f, 1.0f);
    float c = vorHash21(param_2);
    float2 param_3 = i + 1.0f.xx;
    float d = vorHash21(param_3);
    float2 u = (f * f) * (3.0f.xx - (f * 2.0f));
    return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y);
}

float vorFbm(float2 p)
{
    float2 param = p;
    float2 param_1 = (p * 2.0699999332427978515625f) + 11.30000019073486328125f.xx;
    float2 param_2 = (p * 4.110000133514404296875f) + 5.69999980926513671875f.xx;
    return ((0.550000011920928955078125f * vorNoise(param)) + (0.2800000011920928955078125f * vorNoise(param_1))) + (0.17000000178813934326171875f * vorNoise(param_2));
}

float3 bandColor(float q)
{
    float3 c = uC0 * uI.x;
    c = lerp(c, uC1 * uI.y, smoothstep(uBandT.x, uBandT.y, q).xxx);
    c = lerp(c, uC2 * uI.z, smoothstep(uBandT.y, uBandT.z, q).xxx);
    c = lerp(c, uC3 * uI.w, smoothstep(uBandT.z, uBandT.w, q).xxx);
    return c;
}

void frag_main()
{
    if (vWin <= 0.001000000047497451305389404296875f)
    {
        discard;
    }
    float2 param = float2((vS * uVorScale) + (uTime * uStreakPan), ((vQ * uVorScale) * 0.60000002384185791015625f) + (uSeed * 3.099999904632568359375f));
    float2 cell = voronoi2(param);
    float streak = 1.0f;
    if (uStreakOn > 0.5f)
    {
        float2 param_1 = float2(((vS * uStreakFreq) * 3.2999999523162841796875f) + ((uTime * uStreakPan) * 1.60000002384185791015625f), (vQ * 7.0f) + uSeed);
        float lines = lerp(0.60000002384185791015625f, 1.4500000476837158203125f, vorFbm(param_1));
        float seam = 1.0f - smoothstep(0.0f, max(uSeamWidth, 0.001000000047497451305389404296875f), cell.y);
        streak = (lines * (0.7200000286102294921875f + (0.60000002384185791015625f * cell.x))) + ((0.3499999940395355224609375f * seam) * uStreakSeg);
        streak = lerp(1.0f, streak, clamp(uStreakI, 0.0f, 1.0f));
    }
    float front = clamp((vS - uTail) / max(0.100000001490116119384765625f, uFrontWidth), 0.0f, 1.0f);
    float th = uErode + (uTear * (1.0f - front));
    float2 param_2 = float2((vS * uVorScale) + (uSeed * 5.0f), (vQ * 2.099999904632568359375f) - (uTime * 0.60000002384185791015625f));
    float n = (0.4199999868869781494140625f * cell.x) + (0.579999983310699462890625f * vorFbm(param_2));
    float a = smoothstep(th, th + 0.1599999964237213134765625f, n);
    float edge = smoothstep(th - 0.0199999995529651641845703125f, th + 0.0900000035762786865234375f, n) * (1.0f - smoothstep(th + 0.0900000035762786865234375f, th + 0.2599999904632568359375f, n));
    float tip = pow(max(1.0f - vTipD, 9.9999997473787516355514526367188e-05f), 2.400000095367431640625f);
    float param_3 = vQ;
    float3 col = bandColor(param_3) * streak;
    col += ((uC0 * tip) * uTipHot);
    col += ((uStreakCol * edge) * uStreakI);
    float al = (((a * vWin) * uAlpha) * (0.86000001430511474609375f + (0.14000000059604644775390625f * (1.0f - vQ)))) * (0.7799999713897705078125f + (0.3499999940395355224609375f * streak));
    al = clamp(al, 0.0f, 1.0f);
    if (al < 0.0030000000260770320892333984375f)
    {
        discard;
    }
    if (uBlendMode == 1)
    {
        avfxColor = float4(col, al);
    }
    else
    {
        avfxColor = float4(col * al, al);
    }
}

SPIRV_Cross_Output avfxFragment(SPIRV_Cross_Input stage_input)
{
    vWin = stage_input.vWin;
    vS = stage_input.vS;
    vQ = stage_input.vQ;
    vTipD = stage_input.vTipD;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }