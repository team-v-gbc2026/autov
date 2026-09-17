#pragma once
#include "CoreMinimal.h"
#include "SceneViewExtension.h"
#include "RHIResources.h"
#include "AVFXLayout.h"

struct FAVFXRenderDraw
{
    FAVFXLayout Layout;
    FString Program, Blend;
    int32 Order = 0;
    FMatrix Model = FMatrix::Identity;
    TArray<FVector4f> Uniforms, Vertices, Instances;
    TArray<uint32> Indices;
    TMap<FName, FTextureRHIRef> Textures;
    TMap<FName, FSamplerStateRHIRef> Samplers;
};
struct FAVFXFrame
{
    FSceneInterface* Scene = nullptr;
    TArray<FAVFXRenderDraw> Draws;
};
class FAVFXViewExtension : public FSceneViewExtensionBase
{
public:
    FAVFXViewExtension(const FAutoRegister& Register) : FSceneViewExtensionBase(Register) {}
    void Submit(TSharedPtr<const FAVFXFrame, ESPMode::ThreadSafe> Frame);
    virtual void SetupViewFamily(FSceneViewFamily&) override {}
    virtual void SetupView(FSceneViewFamily&, FSceneView&) override {}
    virtual void BeginRenderViewFamily(FSceneViewFamily&) override {}
    virtual void PrePostProcessPass_RenderThread(FRDGBuilder&, const FSceneView&, const FPostProcessingInputs&) override;
private:
    FCriticalSection Mutex;
    TSharedPtr<const FAVFXFrame, ESPMode::ThreadSafe> Current;
};
