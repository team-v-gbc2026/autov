Shader "autoV/Native/splash" { Properties { avfxAttributes ("avfxAttributes", 2D) = "white" {} _Cull ("Cull", Float)=0 _SrcBlend ("Source blend", Float)=5 _DstBlend ("Destination blend", Float)=1 _ZWrite ("Depth write", Float)=0 _ZTest ("Depth test", Float)=4 } SubShader { Tags { "Queue"="Transparent" "RenderType"="Transparent" } Pass { Cull [_Cull] ZWrite [_ZWrite] ZTest [_ZTest] Blend [_SrcBlend] [_DstBlend]
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
    float2 uSliverScale;
    float3 uSliverOffset;
    float uSliverRoll;
    float3 uCol;
    float3 uDark;
    float uOpacity;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float4 gl_Position;
static float2 vUv;
static float2 uv;
static float3 position;
static float3 normal;
static float avfxVertexIndex;

struct SPIRV_Cross_Input {
    float3 position : POSITION;
    float3 normal : NORMAL;
    float2 uv : TEXCOORD0;
    float avfxVertexIndex : TEXCOORD1;
};

struct SPIRV_Cross_Output
{
    float2 vUv : TEXCOORD0;
    float4 gl_Position : SV_Position;
};

void vert_main()
{
    vUv = uv;
    float3 centre = mul(float4(0.0f, 0.0f, 0.0f, 1.0f), modelMatrix).xyz;
    float3 right = float3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
    float3 up = float3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);
    float3 fwd = cross(right, up);
    float2 q = float2(position.x * uSliverScale.x, position.y * uSliverScale.y);
    float c = cos(uSliverRoll);
    float s = sin(uSliverRoll);
    q = float2((q.x * c) - (q.y * s), (q.x * s) + (q.y * c));
    float2 o = float2(uSliverOffset.x, uSliverOffset.y);
    float3 world = ((centre + (right * (q.x + o.x))) + (up * (q.y + o.y))) + (fwd * uSliverOffset.z);
    gl_Position = mul(float4(world, 1.0f), mul(viewMatrix, projectionMatrix));
}

SPIRV_Cross_Output avfxVertex(SPIRV_Cross_Input stage_input)
{
    uv = stage_input.uv;
    position = stage_input.position;
    normal = stage_input.normal;
    avfxVertexIndex = stage_input.avfxVertexIndex;
    vert_main();
    SPIRV_Cross_Output stage_output;
    stage_output.gl_Position = gl_Position;
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
    float2 uSliverScale;
    float3 uSliverOffset;
    float uSliverRoll;
    float3 uCol;
    float3 uDark;
    float uOpacity;
    int uBlendMode;


Texture2D<float4> avfxAttributes;
SamplerState sampleravfxAttributes;

static float2 vUv;
static float4 avfxColor;

struct SPIRV_Cross_Input
{
    float2 vUv : TEXCOORD0;
};

struct SPIRV_Cross_Output
{
    float4 avfxColor : SV_Target;
};

void frag_main()
{
    float3 c = lerp(uDark, uCol, smoothstep(0.0f, 0.550000011920928955078125f, vUv.y).xxx);
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
    vUv = stage_input.vUv;
    frag_main();
    SPIRV_Cross_Output stage_output;
    stage_output.avfxColor = avfxColor;
    return stage_output;
}

#endif
ENDHLSL
} } }
