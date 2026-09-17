#include "AutoVScene.h"
#include "GlobalShader.h"
#include "ShaderParameterUtils.h"
#include "PipelineStateCache.h"
#include "RHIStaticStates.h"
#include "RHICommandList.h"
#include "DataDrivenShaderPlatformInfo.h"
#include "CommonRenderResources.h"

// Each shader gets explicit typed bindings. int uniforms are converted in HLSL,
// and numeric arrays always occupy one float4 per element on every RHI.
#define AUTOV_KERNEL_CLASS(Name) \
class Name : public FGlobalShader { \
    DECLARE_SHADER_TYPE(Name,Global); \
    LAYOUT_FIELD(FShaderParameter,Uniforms); \
    LAYOUT_FIELD(FShaderResourceParameter,Attributes); LAYOUT_FIELD(FShaderResourceParameter,Mask); LAYOUT_FIELD(FShaderResourceParameter,Noise); LAYOUT_FIELD(FShaderResourceParameter,Sites); LAYOUT_FIELD(FShaderResourceParameter,Depth); \
    LAYOUT_FIELD(FShaderResourceParameter,AttributesSampler); LAYOUT_FIELD(FShaderResourceParameter,MaskSampler); LAYOUT_FIELD(FShaderResourceParameter,NoiseSampler); LAYOUT_FIELD(FShaderResourceParameter,SitesSampler); LAYOUT_FIELD(FShaderResourceParameter,DepthSampler); \
public: \
    Name() {} \
    Name(const ShaderMetaType::CompiledShaderInitializerType& I):FGlobalShader(I) { \
        Uniforms.Bind(I.ParameterMap,TEXT("AvfxUniforms")); \
        Attributes.Bind(I.ParameterMap,TEXT("avfxAttributes")); Mask.Bind(I.ParameterMap,TEXT("uMask")); Noise.Bind(I.ParameterMap,TEXT("uNoise")); Sites.Bind(I.ParameterMap,TEXT("uSites")); Depth.Bind(I.ParameterMap,TEXT("tDepth")); \
        AttributesSampler.Bind(I.ParameterMap,TEXT("sampleravfxAttributes")); MaskSampler.Bind(I.ParameterMap,TEXT("sampleruMask")); NoiseSampler.Bind(I.ParameterMap,TEXT("sampleruNoise")); SitesSampler.Bind(I.ParameterMap,TEXT("sampleruSites")); DepthSampler.Bind(I.ParameterMap,TEXT("samplertDepth")); \
    } \
    static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters& P) { return IsFeatureLevelSupported(P.Platform,ERHIFeatureLevel::SM5); } \
    void SetParameters(FRHIBatchedShaderParameters& P,const TArray<FVector4f>& U,FAutoVScene& Scene,const FAutoVDraw& Draw,int32 Geometry) const { \
        SetShaderValueArray(P,Uniforms,U.GetData(),U.Num()); \
        auto Tex=[&](const TCHAR* N) { const FString* Path=Draw.Textures.Find(N); return Scene.Textures.FindChecked(Path?*Path:TEXT("__white")).RHI; }; \
        auto Point=TStaticSamplerState<SF_Point,AM_Clamp,AM_Clamp,AM_Clamp>::GetRHI(); \
        auto Linear=TStaticSamplerState<SF_Bilinear,AM_Clamp,AM_Clamp,AM_Clamp>::GetRHI(); \
        auto Repeat=TStaticSamplerState<SF_Bilinear,AM_Wrap,AM_Wrap,AM_Wrap>::GetRHI(); \
        SetTextureParameter(P,Attributes,AttributesSampler,Point,Scene.Textures.FindChecked(FString::Printf(TEXT("attributes/%s-%d.bin"),*Draw.Id,Geometry)).RHI); \
        SetTextureParameter(P,Mask,MaskSampler,Linear,Tex(TEXT("uMask"))); SetTextureParameter(P,Noise,NoiseSampler,Repeat,Tex(TEXT("uNoise"))); \
        SetTextureParameter(P,Sites,SitesSampler,Point,Tex(TEXT("uSites"))); SetTextureParameter(P,Depth,DepthSampler,Point,Scene.Textures.FindChecked(TEXT("__white")).RHI); \
    } \
};
AUTOV_KERNEL_CLASS(FAutoVParticleVS)
AUTOV_KERNEL_CLASS(FAutoVParticlePS)
AUTOV_KERNEL_CLASS(FAutoVSurfaceVS)
AUTOV_KERNEL_CLASS(FAutoVSurfacePS)
IMPLEMENT_SHADER_TYPE(,FAutoVParticleVS,TEXT("/Plugin/AutoV/Private/particleVS.usf"),TEXT("avfxVertex"),SF_Vertex);
IMPLEMENT_SHADER_TYPE(,FAutoVParticlePS,TEXT("/Plugin/AutoV/Private/particlePS.usf"),TEXT("avfxFragment"),SF_Pixel);
IMPLEMENT_SHADER_TYPE(,FAutoVSurfaceVS,TEXT("/Plugin/AutoV/Private/surfaceVS.usf"),TEXT("avfxVertex"),SF_Vertex);
IMPLEMENT_SHADER_TYPE(,FAutoVSurfacePS,TEXT("/Plugin/AutoV/Private/surfacePS.usf"),TEXT("avfxFragment"),SF_Pixel);

class FAutoVToneVS : public FGlobalShader {
    DECLARE_SHADER_TYPE(FAutoVToneVS,Global);
public:
    FAutoVToneVS() {} FAutoVToneVS(const ShaderMetaType::CompiledShaderInitializerType& I):FGlobalShader(I) {}
};
class FAutoVTonePS : public FGlobalShader {
    DECLARE_SHADER_TYPE(FAutoVTonePS,Global);
    LAYOUT_FIELD(FShaderParameter,Exposure);
    LAYOUT_FIELD(FShaderResourceParameter,Source);
    LAYOUT_FIELD(FShaderResourceParameter,SourceSampler);
public:
    FAutoVTonePS() {} FAutoVTonePS(const ShaderMetaType::CompiledShaderInitializerType& I):FGlobalShader(I) { Exposure.Bind(I.ParameterMap,TEXT("Exposure")); Source.Bind(I.ParameterMap,TEXT("Source")); SourceSampler.Bind(I.ParameterMap,TEXT("SourceSampler")); }
    void SetParameters(FRHIBatchedShaderParameters& P,FRHITexture* Texture,float Value) { SetShaderValue(P,Exposure,Value); SetTextureParameter(P,Source,SourceSampler,TStaticSamplerState<SF_Point,AM_Clamp,AM_Clamp,AM_Clamp>::GetRHI(),Texture); }
};
IMPLEMENT_SHADER_TYPE(,FAutoVToneVS,TEXT("/Plugin/AutoV/Private/Tone.usf"),TEXT("ToneVS"),SF_Vertex);
IMPLEMENT_SHADER_TYPE(,FAutoVTonePS,TEXT("/Plugin/AutoV/Private/Tone.usf"),TEXT("TonePS"),SF_Pixel);

void FAutoVScene::Init(FRHICommandListImmediate& R) {
    if(Initialized) return;
    FVertexDeclarationElementList Elements;
    Elements.Add(FVertexElement(0,STRUCT_OFFSET(FAutoVVertex,Position),VET_Float3,0,sizeof(FAutoVVertex)));
    Elements.Add(FVertexElement(0,STRUCT_OFFSET(FAutoVVertex,Normal),VET_Float3,1,sizeof(FAutoVVertex)));
    Elements.Add(FVertexElement(0,STRUCT_OFFSET(FAutoVVertex,UV),VET_Float2,2,sizeof(FAutoVVertex)));
    Elements.Add(FVertexElement(0,STRUCT_OFFSET(FAutoVVertex,Row),VET_Float1,3,sizeof(FAutoVVertex)));
    Declaration=RHICreateVertexDeclaration(Elements);
    for(auto& G:Geometries) if(G.Base<0 && !G.Vertices.IsEmpty() && !G.Indices.IsEmpty()) {
        auto VD=FRHIBufferCreateDesc::CreateVertex<FAutoVVertex>(TEXT("AutoV vertices"),G.Vertices.Num()).SetInitActionInitializer().DetermineInitialState();
        TRHIBufferInitializer<FAutoVVertex> V=R.CreateBufferInitializer(VD); FMemory::Memcpy(V.GetWritableData(),G.Vertices.GetData(),G.Vertices.Num()*sizeof(FAutoVVertex)); G.VB=V.Finalize();
        auto ID=FRHIBufferCreateDesc::CreateIndex<uint32>(TEXT("AutoV indices"),G.Indices.Num()).SetInitActionInitializer().DetermineInitialState();
        TRHIBufferInitializer<uint32> I=R.CreateBufferInitializer(ID); FMemory::Memcpy(I.GetWritableData(),G.Indices.GetData(),G.Indices.Num()*sizeof(uint32)); G.IB=I.Finalize();
    }
    for(auto& Pair:Textures) {
        auto& T=Pair.Value;
        auto Desc=FRHITextureCreateDesc::Create2D(TEXT("AutoV texture"),T.Width,T.Height,T.Float?PF_A32B32G32R32F:PF_R8G8B8A8).SetFlags(TexCreate_ShaderResource).SetInitActionInitializer();
        auto Initializer=R.CreateTextureInitializer(Desc); auto Sub=Initializer.GetTexture2DSubresource(0); int32 Stride=T.Width*(T.Float?16:4);
        for(int32 Y=0;Y<T.Height;++Y) FMemory::Memcpy(static_cast<uint8*>(Sub.Data)+Y*Sub.Stride,T.Bytes.GetData()+Y*Stride,Stride);
        T.RHI=Initializer.Finalize();
    }
    LinearTarget=R.CreateTexture(FRHITextureCreateDesc::Create2D(TEXT("AutoV linear HDR"),640,360,PF_FloatRGBA).SetFlags(TexCreate_RenderTargetable|TexCreate_ShaderResource).SetClearValue(FClearValueBinding(Background)).SetInitialState(ERHIAccess::SRVMask));
    DepthTarget=R.CreateTexture(FRHITextureCreateDesc::Create2D(TEXT("AutoV 3D depth"),640,360,PF_DepthStencil).SetFlags(TexCreate_DepthStencilTargetable).SetClearValue(FClearValueBinding(1.f,0)).SetInitialState(ERHIAccess::DSVWrite));
    Initialized=true;
}

template<typename VSClass,typename PSClass>
static void DrawAutoV(FRHICommandListImmediate& R,FAutoVScene& Scene,const FAutoVDraw& Draw,const FAutoVSample& Sample,FAutoVGeometry& G,const TArray<FVector4f>& U) {
    TShaderMapRef<VSClass> VS(GetGlobalShaderMap(GMaxRHIFeatureLevel)); TShaderMapRef<PSClass> PS(GetGlobalShaderMap(GMaxRHIFeatureLevel));
    FGraphicsPipelineStateInitializer P; R.ApplyCachedRenderTargets(P);
    P.BoundShaderState.VertexDeclarationRHI=Scene.Declaration; P.BoundShaderState.VertexShaderRHI=VS.GetVertexShader(); P.BoundShaderState.PixelShaderRHI=PS.GetPixelShader(); P.PrimitiveType=PT_TriangleList;
    P.RasterizerState=Draw.Side==TEXT("double")?TStaticRasterizerState<FM_Solid,CM_None>::GetRHI():Draw.Side==TEXT("front")?TStaticRasterizerState<FM_Solid,CM_CW>::GetRHI():TStaticRasterizerState<FM_Solid,CM_CCW>::GetRHI();
    if(Draw.DepthTest) P.DepthStencilState=Sample.DepthWrite?TStaticDepthStencilState<true,CF_LessEqual>::GetRHI():TStaticDepthStencilState<false,CF_LessEqual>::GetRHI();
    else P.DepthStencilState=Sample.DepthWrite?TStaticDepthStencilState<true,CF_Always>::GetRHI():TStaticDepthStencilState<false,CF_Always>::GetRHI();
    if(Draw.Blend==TEXT("additive")) P.BlendState=TStaticBlendState<CW_RGBA,BO_Add,BF_SourceAlpha,BF_One,BO_Add,BF_One,BF_One>::GetRHI();
    else if(Draw.Blend==TEXT("alpha")) P.BlendState=TStaticBlendState<CW_RGBA,BO_Add,BF_SourceAlpha,BF_InverseSourceAlpha,BO_Add,BF_One,BF_InverseSourceAlpha>::GetRHI();
    else P.BlendState=TStaticBlendState<CW_RGBA,BO_Add,BF_One,BF_InverseSourceAlpha,BO_Add,BF_One,BF_InverseSourceAlpha>::GetRHI();
    SetGraphicsPipelineState(R,P,0);
    SetShaderParametersLegacyVS(R,VS,U,Scene,Draw,Sample.Geometry); SetShaderParametersLegacyPS(R,PS,U,Scene,Draw,Sample.Geometry);
    R.SetStreamSource(0,G.VB,0); R.DrawIndexedPrimitive(G.IB,0,0,G.Vertices.Num(),0,G.Indices.Num()/3,1);
}

void FAutoVScene::Render(FRHICommandListImmediate& R,FRHITexture* TargetTexture,float Time,float Orbit,float Elevation,float Zoom) {
    Init(R);
    FVector3f Offset=Position-Target; float A=FMath::DegreesToRadians(Orbit);
    Offset=FVector3f(Offset.X*FMath::Cos(A)+Offset.Z*FMath::Sin(A),Offset.Y,-Offset.X*FMath::Sin(A)+Offset.Z*FMath::Cos(A));
    FVector3f Right=FVector3f::CrossProduct(FVector3f(0,1,0),Offset).GetSafeNormal();
    Offset=FQuat4f(Right,FMath::DegreesToRadians(Elevation)).RotateVector(Offset)*Zoom;
    FVector3f Eye=Target+Offset,Z=Offset.GetSafeNormal(),X=FVector3f::CrossProduct(FVector3f(0,1,0),Z).GetSafeNormal(),Y=FVector3f::CrossProduct(Z,X);
    FMatrix44f View(FPlane4f(X.X,Y.X,Z.X,0),FPlane4f(X.Y,Y.Y,Z.Y,0),FPlane4f(X.Z,Y.Z,Z.Z,0),FPlane4f(-FVector3f::DotProduct(X,Eye),-FVector3f::DotProduct(Y,Eye),-FVector3f::DotProduct(Z,Eye),1));
    float F=1/FMath::Tan(FMath::DegreesToRadians(Fov)*.5f);
    FMatrix44f Projection(FPlane4f(F/Aspect,0,0,0),FPlane4f(0,F,0,0),FPlane4f(0,0,-(Far+Near)/(Far-Near),-1),FPlane4f(0,0,-2*Far*Near/(Far-Near),0));
    R.Transition(FRHITransitionInfo(LinearTarget,ERHIAccess::SRVMask,ERHIAccess::RTV));
    R.BeginRenderPass(FRHIRenderPassInfo(LinearTarget,ERenderTargetActions::Clear_Store,DepthTarget,EDepthStencilTargetActions::ClearDepthStencil_StoreDepthStencil),TEXT("AutoV 3D kernels"));
    R.SetViewport(0,0,0,640,360,1);
    for(auto& Draw:Draws) {
        auto& S=Draw.Samples[FMath::Clamp(FMath::FloorToInt(Time*FPS+1e-5f),0,Draw.Samples.Num()-1)]; if(!S.Visible) continue;
        int32 GI=S.Geometry; while(Geometries[GI].Base>=0) GI=Geometries[GI].Base;
        auto& G=Geometries[GI]; if(!G.VB || !G.IB) continue;
        auto U=S.Uniforms; FMatrix44f Model; FMemory::Memcpy(&Model,U.GetData(),sizeof(Model)); FMatrix44f MV=Model*View,Normal=MV.Inverse().GetTransposed();
        auto Put=[&](int Slot,const FMatrix44f& M,int Count) { for(int I=0;I<Count;++I) U[Slot+I]=FVector4f(M.M[I][0],M.M[I][1],M.M[I][2],M.M[I][3]); };
        Put(4,View,4); Put(8,Projection,4); Put(12,MV,4); Put(16,Normal,3); U[19]=FVector4f(Eye,0);
        auto Bindings=Draw.Program==TEXT("particle")?MakeArrayView(particleBindings):MakeArrayView(surfaceBindings);
        for(auto& B:Bindings) { if(FCString::Strcmp(B.Name,TEXT("uTime"))==0) U[B.Slot].X+=Time-S.Time; if(FCString::Strcmp(B.Name,TEXT("uCam"))==0) U[B.Slot]=FVector4f(Eye,0); }
        if(Draw.Program==TEXT("particle")) DrawAutoV<FAutoVParticleVS,FAutoVParticlePS>(R,*this,Draw,S,G,U); else DrawAutoV<FAutoVSurfaceVS,FAutoVSurfacePS>(R,*this,Draw,S,G,U);
    }
    R.EndRenderPass(); R.Transition(FRHITransitionInfo(LinearTarget,ERHIAccess::RTV,ERHIAccess::SRVMask));
    R.Transition(FRHITransitionInfo(TargetTexture,ERHIAccess::Unknown,ERHIAccess::RTV));
    R.BeginRenderPass(FRHIRenderPassInfo(TargetTexture,ERenderTargetActions::DontLoad_Store),TEXT("AutoV ACES and sRGB"));
    R.SetViewport(0,0,0,640,360,1);
    TShaderMapRef<FAutoVToneVS> VS(GetGlobalShaderMap(GMaxRHIFeatureLevel)); TShaderMapRef<FAutoVTonePS> PS(GetGlobalShaderMap(GMaxRHIFeatureLevel));
    FGraphicsPipelineStateInitializer P; R.ApplyCachedRenderTargets(P); P.BoundShaderState.VertexDeclarationRHI=GEmptyVertexDeclaration.VertexDeclarationRHI; P.BoundShaderState.VertexShaderRHI=VS.GetVertexShader(); P.BoundShaderState.PixelShaderRHI=PS.GetPixelShader(); P.PrimitiveType=PT_TriangleList;
    P.RasterizerState=TStaticRasterizerState<FM_Solid,CM_None>::GetRHI(); P.BlendState=TStaticBlendState<>::GetRHI(); P.DepthStencilState=TStaticDepthStencilState<false,CF_Always>::GetRHI(); SetGraphicsPipelineState(R,P,0);
    SetShaderParametersLegacyPS(R,PS,LinearTarget.GetReference(),Exposure); R.DrawPrimitive(0,1,1); R.EndRenderPass();
    R.Transition(FRHITransitionInfo(TargetTexture,ERHIAccess::RTV,ERHIAccess::SRVMask));
}
