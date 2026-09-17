#include "AutoVWorld.h"
#include "RenderGraphBuilder.h"
#include "RenderGraphUtils.h"
#include "PostProcess/PostProcessInputs.h"
#include "SceneRenderTargetParameters.h"
#include "FXRenderingUtils.h"
#include "SceneRendering.h"

BEGIN_SHADER_PARAMETER_STRUCT(FAutoVWorldPassParameters,)
    RENDER_TARGET_BINDING_SLOTS()
END_SHADER_PARAMETER_STRUCT()

void FAutoVWorldExtension::PrePostProcessPass_RenderThread(FRDGBuilder& GraphBuilder,const FSceneView& View,const FPostProcessingInputs& Inputs) {
    if(!Enabled || !Data || !Data->Initialized || !View.Family || View.Family->Scene!=WorldScene || !Inputs.SceneTextures) return;
    auto Parameters=GraphBuilder.AllocParameters<FAutoVWorldPassParameters>();
    Parameters->RenderTargets[0]=FRenderTargetBinding((*Inputs.SceneTextures)->SceneColorTexture,ERenderTargetLoadAction::ELoad);
    Parameters->RenderTargets.DepthStencil=FDepthStencilBinding((*Inputs.SceneTextures)->SceneDepthTexture,ERenderTargetLoadAction::ELoad,ERenderTargetLoadAction::ELoad,FExclusiveDepthStencil::DepthWrite_StencilNop);
    const FIntRect Rect=UE::FXRenderingUtils::GetRawViewRectUnsafe(View);
    auto Snapshot=Data; float T=Time,PreExposure=static_cast<const FViewInfo&>(View).PreExposure;
    FMatrix44f A=Actor,V(View.ViewMatrices.GetWorldToView()),P(View.ViewMatrices.GetViewToClip()); FVector3f Eye(View.ViewMatrices.GetViewOrigin());
    GraphBuilder.AddPass(RDG_EVENT_NAME("AutoV World 3D"),Parameters,ERDGPassFlags::Raster|ERDGPassFlags::NeverCull,
        [Snapshot,T,A,V,P,Eye,PreExposure,Rect](FRHICommandListImmediate& R) { R.SetViewport(Rect.Min.X,Rect.Min.Y,0,Rect.Max.X,Rect.Max.Y,1); Snapshot->RenderWorld(R,T,A,V,P,Eye,PreExposure); });
}
