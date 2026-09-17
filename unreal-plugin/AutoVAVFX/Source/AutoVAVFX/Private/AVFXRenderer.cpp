#include "AVFXRenderer.h"
#include "GlobalShader.h"
#include "ShaderParameterStruct.h"
#include "RenderGraphBuilder.h"
#include "RenderGraphUtils.h"
#include "PipelineStateCache.h"
#include "RHIStaticStates.h"
#include "RenderUtils.h"
#include "SceneTexturesConfig.h"
#include "SceneManagement.h"
#include "Math/ScaleMatrix.h"
#include "PostProcess/PostProcessInputs.h"

BEGIN_SHADER_PARAMETER_STRUCT(FAVFXParameters, )
    SHADER_PARAMETER_RDG_BUFFER_SRV(ByteAddressBuffer, AVFXData)
    SHADER_PARAMETER_RDG_BUFFER_SRV(ByteAddressBuffer, AVFXVertices)
    SHADER_PARAMETER_RDG_BUFFER_SRV(ByteAddressBuffer, AVFXIndices)
    SHADER_PARAMETER_RDG_BUFFER_SRV(ByteAddressBuffer, AVFXInstances)
    SHADER_PARAMETER_TEXTURE(Texture2D, uTexture)
    SHADER_PARAMETER_TEXTURE(Texture2D, uNoise)
    SHADER_PARAMETER_TEXTURE(Texture2D, uAlphaTexture)
    SHADER_PARAMETER_TEXTURE(Texture2D, uMask)
    SHADER_PARAMETER_TEXTURE(Texture2D, uNormalMap)
    SHADER_PARAMETER_TEXTURE(Texture2D, uSites)
    SHADER_PARAMETER_TEXTURE(Texture2D, uTrail)
    SHADER_PARAMETER_RDG_TEXTURE(Texture2D, tDepth)
    SHADER_PARAMETER_SAMPLER(SamplerState, _uTexture_sampler)
    SHADER_PARAMETER_SAMPLER(SamplerState, _uNoise_sampler)
    SHADER_PARAMETER_SAMPLER(SamplerState, _uAlphaTexture_sampler)
    SHADER_PARAMETER_SAMPLER(SamplerState, _uMask_sampler)
    SHADER_PARAMETER_SAMPLER(SamplerState, _uNormalMap_sampler)
    SHADER_PARAMETER_SAMPLER(SamplerState, _uSites_sampler)
    SHADER_PARAMETER_SAMPLER(SamplerState, _uTrail_sampler)
    SHADER_PARAMETER_SAMPLER(SamplerState, _tDepth_sampler)
    RENDER_TARGET_BINDING_SLOTS()
END_SHADER_PARAMETER_STRUCT()

#define AVFX_SHADER_CLASS(Name) \
class Name : public FGlobalShader { \
    DECLARE_GLOBAL_SHADER(Name); SHADER_USE_PARAMETER_STRUCT(Name,FGlobalShader); \
    using FParameters=FAVFXParameters; \
    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& P) { return IsFeatureLevelSupported(P.Platform,ERHIFeatureLevel::SM5); } \
};
#include "Generated/Shaders.inl"

void FAVFXViewExtension::Submit(TSharedPtr<const FAVFXFrame,ESPMode::ThreadSafe> Frame)
{
    FScopeLock Lock(&Mutex); Current=MoveTemp(Frame);
}

template<class VS, class PS>
static void AVFXDrawPass(FRDGBuilder& Graph, const FSceneView& View, FAVFXParameters* P, const FAVFXRenderDraw& Draw)
{
    TShaderMapRef<VS> Vertex(GetGlobalShaderMap(View.GetFeatureLevel()));
    TShaderMapRef<PS> Pixel(GetGlobalShaderMap(View.GetFeatureLevel()));
    const FIntRect Rect=View.UnscaledViewRect;
    const FString Blend=Draw.Blend;
    const uint32 Triangles=Draw.Indices.Num()/(Draw.bLines?2:3), Instances=1;
    const bool bLines=Draw.bLines, bDepthTest=Draw.bDepthTest, bDepthWrite=Draw.bDepthWrite;
    const FString Side=Draw.Side;
    Graph.AddPass(RDG_EVENT_NAME("AutoV AVFX"),P,ERDGPassFlags::Raster,
        [P,Vertex,Pixel,Rect,Blend,Triangles,Instances,bLines,bDepthTest,bDepthWrite,Side](FRHICommandList& RHICmdList)
    {
        FGraphicsPipelineStateInitializer State;
        RHICmdList.ApplyCachedRenderTargets(State);
        State.BoundShaderState.VertexDeclarationRHI=GEmptyVertexDeclaration.VertexDeclarationRHI;
        State.BoundShaderState.VertexShaderRHI=Vertex.GetVertexShader();
        State.BoundShaderState.PixelShaderRHI=Pixel.GetPixelShader();
        State.PrimitiveType=bLines?PT_LineList:PT_TriangleList;
        State.RasterizerState=Side==TEXT("front")?TStaticRasterizerState<FM_Solid,CM_CW>::GetRHI():Side==TEXT("back")?TStaticRasterizerState<FM_Solid,CM_CCW>::GetRHI():TStaticRasterizerState<FM_Solid,CM_None>::GetRHI();
        State.DepthStencilState=bDepthTest?(bDepthWrite?TStaticDepthStencilState<true,CF_DepthNearOrEqual>::GetRHI():TStaticDepthStencilState<false,CF_DepthNearOrEqual>::GetRHI()):(bDepthWrite?TStaticDepthStencilState<true,CF_Always>::GetRHI():TStaticDepthStencilState<false,CF_Always>::GetRHI());
        if(Blend==TEXT("additive")) State.BlendState=TStaticBlendState<CW_RGBA,BO_Add,BF_SourceAlpha,BF_One,BO_Add,BF_One,BF_One>::GetRHI();
        else if(Blend==TEXT("premultiplied")) State.BlendState=TStaticBlendState<CW_RGBA,BO_Add,BF_One,BF_InverseSourceAlpha,BO_Add,BF_One,BF_InverseSourceAlpha>::GetRHI();
        else State.BlendState=TStaticBlendState<CW_RGBA,BO_Add,BF_SourceAlpha,BF_InverseSourceAlpha,BO_Add,BF_One,BF_InverseSourceAlpha>::GetRHI();
        SetGraphicsPipelineState(RHICmdList,State,0);
        RHICmdList.SetViewport(Rect.Min.X,Rect.Min.Y,0,Rect.Max.X,Rect.Max.Y,1);
        SetShaderParameters(RHICmdList,Vertex,Vertex.GetVertexShader(),*P);
        SetShaderParameters(RHICmdList,Pixel,Pixel.GetPixelShader(),*P);
        RHICmdList.DrawPrimitive(0,Triangles,Instances);
    });
}

void FAVFXViewExtension::PrePostProcessPass_RenderThread(FRDGBuilder& Graph, const FSceneView& View, const FPostProcessingInputs& Inputs)
{
    TSharedPtr<const FAVFXFrame,ESPMode::ThreadSafe> Frame;
    {FScopeLock Lock(&Mutex); Frame=Current;}
    if(!Frame || Frame->Scene!=View.Family->Scene || !Inputs.SceneTextures || View.GetFeatureLevel()<ERHIFeatureLevel::SM5) return;
    const auto& Scene=Inputs.SceneTextures->GetParameters();
    const auto Color=Scene->SceneColorTexture, Depth=Scene->SceneDepthTexture;
    if(!Color || !Depth) return;
    for(const auto& Draw:Frame->Draws)
    {
        if(Draw.Vertices.IsEmpty() || Draw.Indices.IsEmpty() || Draw.Instances.IsEmpty()) continue;
        auto Uniforms=Draw.Uniforms;
        auto Vector=[&](const TCHAR* Name,const FVector4f& Value){if(const auto* F=Draw.Layout.Fields.Find(Name)) Uniforms[F->Slot]=Value;};
        auto Matrix=[&](const TCHAR* Name,const FMatrix& Value){if(const auto* F=Draw.Layout.Fields.Find(Name)) for(int32 I=0;I<4;I++) Uniforms[F->Slot+I]=FVector4f(Value.M[I][0],Value.M[I][1],Value.M[I][2],Value.M[I][3]);};
        // Source camera coordinates are X right/Y up/-Z forward in meters.
        // UE view coordinates are X right/Y up/+Z forward in centimeters.
        const FMatrix FlipScale=FScaleMatrix(FVector(.01,.01,-.01));
        const FMatrix SourceView=AVFXSourceToUnreal()*View.ViewMatrices.GetViewMatrix()*FlipScale;
        const FMatrix Projection=FlipScale.Inverse()*View.ViewMatrices.GetProjectionMatrix();
        Matrix(TEXT("modelMatrix"),Draw.Model);
        Matrix(TEXT("viewMatrix"),SourceView);
        Matrix(TEXT("modelViewMatrix"),Draw.Model*SourceView);
        Matrix(TEXT("projectionMatrix"),Projection);
        Matrix(TEXT("avfxInvProjection"),View.ViewMatrices.GetInvProjectionMatrix());
        if(const auto* F=Draw.Layout.Fields.Find(TEXT("normalMatrix"))) {const FMatrix Normal=(Draw.Model*SourceView).Inverse().GetTransposed();for(int32 I=0;I<3;I++)Uniforms[F->Slot+I]=FVector4f(Normal.M[I][0],Normal.M[I][1],Normal.M[I][2],0);}
        const FVector Camera=AVFXSourceToUnreal().InverseTransformPosition(View.ViewMatrices.GetViewOrigin());
        Vector(TEXT("uCam"),FVector4f(FVector3f(Camera),0));
        Vector(TEXT("cameraPosition"),FVector4f(FVector3f(Camera),0));
        Vector(TEXT("uResolution"),FVector4f(Depth->Desc.Extent.X,Depth->Desc.Extent.Y,0,0));
        Vector(TEXT("avfxPreExposure"),FVector4f(View.State?View.State->GetPreExposure():1.f,0,0,0));
        const FMatrix Inv=SourceView.Inverse();
        Vector(TEXT("uSmokeRight"),FVector4f(FVector3f(Inv.GetScaledAxis(EAxis::X).GetSafeNormal()),0));
        Vector(TEXT("uSmokeUp"),FVector4f(FVector3f(Inv.GetScaledAxis(EAxis::Y).GetSafeNormal()),0));
        Vector(TEXT("uSmokeForward"),FVector4f(FVector3f(Inv.GetScaledAxis(EAxis::Z).GetSafeNormal()),0));
        auto* P=Graph.AllocParameters<FAVFXParameters>();
        P->AVFXData=Graph.CreateSRV(CreateByteAddressBuffer(Graph,TEXT("AVFX.Uniforms"),MoveTemp(Uniforms)),PF_R32_UINT);
        P->AVFXVertices=Graph.CreateSRV(CreateByteAddressBuffer(Graph,TEXT("AVFX.Vertices"),MakeArrayView(Draw.Vertices)),PF_R32_UINT);
        P->AVFXIndices=Graph.CreateSRV(CreateByteAddressBuffer(Graph,TEXT("AVFX.Indices"),MakeArrayView(Draw.Indices)),PF_R32_UINT);
        P->AVFXInstances=Graph.CreateSRV(CreateByteAddressBuffer(Graph,TEXT("AVFX.Instances"),MakeArrayView(Draw.Instances)),PF_R32_UINT);
        auto Texture=[&](FName Name)->FRHITexture* { const auto* T=Draw.Textures.Find(Name); return T && T->IsValid() ? T->GetReference() : GBlackTexture->TextureRHI.GetReference(); };
        auto Sampler=[&](FName Name)->FRHISamplerState* {const auto* S=Draw.Samplers.Find(Name);return S && S->IsValid()?S->GetReference():TStaticSamplerState<SF_Bilinear,AM_Clamp,AM_Clamp,AM_Clamp>::GetRHI();};
        #define AVFX_TEXTURE(Name) P->Name=Texture(TEXT(#Name)); P->_##Name##_sampler=Sampler(TEXT(#Name));
        AVFX_TEXTURE(uTexture) AVFX_TEXTURE(uNoise) AVFX_TEXTURE(uAlphaTexture)
        AVFX_TEXTURE(uMask) AVFX_TEXTURE(uNormalMap) AVFX_TEXTURE(uSites)
        AVFX_TEXTURE(uTrail)
        #undef AVFX_TEXTURE
        P->tDepth=Depth;
        P->_tDepth_sampler=TStaticSamplerState<SF_Point,AM_Clamp,AM_Clamp,AM_Clamp>::GetRHI();
        P->RenderTargets[0]=FRenderTargetBinding(Color,ERenderTargetLoadAction::ELoad);
        P->RenderTargets.DepthStencil=FDepthStencilBinding(Depth,ERenderTargetLoadAction::ELoad,ERenderTargetLoadAction::ELoad,Draw.bDepthWrite?FExclusiveDepthStencil::DepthWrite_StencilNop:FExclusiveDepthStencil::DepthRead_StencilNop);
        #include "Generated/Dispatch.inl"
    }
}
