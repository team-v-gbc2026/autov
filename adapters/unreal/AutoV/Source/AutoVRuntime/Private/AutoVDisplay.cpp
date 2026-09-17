#include "AutoVDisplay.h"
#include "Engine/Canvas.h"
#include "Engine/TextureRenderTarget2D.h"
#include "CanvasItem.h"
#include "BatchedElements.h"
#include "SimpleElementShaders.h"
#include "ShaderParameterStruct.h"
#include "ShaderParameterUtils.h"
#include "PipelineStateCache.h"
#include "RHIStaticStates.h"
#include "TextureResource.h"

class FAutoVDisplayPS : public FGlobalShader {
public:
    DECLARE_GLOBAL_SHADER(FAutoVDisplayPS);
    SHADER_USE_PARAMETER_STRUCT(FAutoVDisplayPS, FGlobalShader);
    BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
        SHADER_PARAMETER_TEXTURE(Texture2D, Source)
        SHADER_PARAMETER_SAMPLER(SamplerState, SourceSampler)
    END_SHADER_PARAMETER_STRUCT()
};
IMPLEMENT_GLOBAL_SHADER(FAutoVDisplayPS, "/Plugin/AutoV/Private/Display.usf", "DisplayPS", SF_Pixel);

class FAutoVDisplayParameters final : public FBatchedElementParameters {
public:
    void BindShaders(FRHICommandList& R, FGraphicsPipelineStateInitializer& Pipeline,
        ERHIFeatureLevel::Type FeatureLevel, const FMatrix& Transform,
        const float /*Gamma*/, const FMatrix& /*ColorWeights*/, const FTexture* Texture) override {
        TShaderMapRef<FSimpleElementVS> VS(GetGlobalShaderMap(FeatureLevel));
        TShaderMapRef<FAutoVDisplayPS> PS(GetGlobalShaderMap(FeatureLevel));
        Pipeline.BoundShaderState.VertexDeclarationRHI=GSimpleElementVertexDeclaration.VertexDeclarationRHI;
        Pipeline.BoundShaderState.VertexShaderRHI=VS.GetVertexShader();
        Pipeline.BoundShaderState.PixelShaderRHI=PS.GetPixelShader();
        Pipeline.PrimitiveType=PT_TriangleList;
        Pipeline.BlendState=TStaticBlendState<>::GetRHI();
        R.ApplyCachedRenderTargets(Pipeline);
        SetGraphicsPipelineState(R,Pipeline,0);
        SetShaderParametersLegacyVS(R,VS,Transform);
        FAutoVDisplayPS::FParameters Parameters{};
        Parameters.Source=Texture->TextureRHI;
        Parameters.SourceSampler=TStaticSamplerState<SF_Bilinear,AM_Clamp,AM_Clamp,AM_Clamp>::GetRHI();
        SetShaderParameters(R,PS,PS.GetPixelShader(),Parameters);
    }
};

void DrawAutoVReference(UCanvas* Canvas, UTextureRenderTarget2D* Texture,
    const FVector2D& Position, const FVector2D& Size) {
    if(!Canvas || !Texture || !Texture->GetResource()) return;
    FCanvasTileItem Item(Position,Texture->GetResource(),Size,FLinearColor::White);
    // Canvas retains the ref-counted parameters for its deferred render batch.
    TRefCountPtr<FAutoVDisplayParameters> Parameters=new FAutoVDisplayParameters;
    Item.BatchedElementParameters=Parameters.GetReference();
    Item.BlendMode=SE_BLEND_Opaque;
    Canvas->DrawItem(Item);
}
