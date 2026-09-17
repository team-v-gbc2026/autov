#pragma once
#include "SceneViewExtension.h"
#include "AutoVScene.h"
class FAutoVWorldExtension : public FSceneViewExtensionBase {
public:
    FAutoVWorldExtension(const FAutoRegister& Register):FSceneViewExtensionBase(Register) {}
    virtual void SetupViewFamily(FSceneViewFamily&) override {}
    virtual void SetupView(FSceneViewFamily&,FSceneView&) override {}
    virtual void BeginRenderViewFamily(FSceneViewFamily&) override {}
    virtual void PrePostProcessPass_RenderThread(FRDGBuilder& GraphBuilder,const FSceneView& View,const FPostProcessingInputs& Inputs) override;
    // These fields are read/written only on the render thread.
    TSharedPtr<FAutoVScene,ESPMode::ThreadSafe> Data;
    FSceneInterface* WorldScene=nullptr;
    FMatrix44f Actor=FMatrix44f::Identity;
    float Time=0;
    bool Enabled=false;
};
