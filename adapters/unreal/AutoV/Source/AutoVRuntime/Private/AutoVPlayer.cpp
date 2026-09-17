#include "AutoVPlayer.h"
#include "AutoVAsset.h"
#include "AutoVScene.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Serialization/JsonSerializer.h"
#include "IImageWrapperModule.h"
#include "IImageWrapper.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "RenderingThread.h"

static TSharedPtr<FJsonObject> ParseAutoV(const FString& Text) { TSharedPtr<FJsonObject> R; FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text),R); return R; }
static FString Utf8AutoV(const TArray<uint8>& Bytes) { FUTF8ToTCHAR T(reinterpret_cast<const ANSICHAR*>(Bytes.GetData()),Bytes.Num()); return FString(T.Length(),T.Get()); }
static FVector3f VectorAutoV(const TArray<TSharedPtr<FJsonValue>>& A) { return FVector3f(A[0]->AsNumber(),A[1]->AsNumber(),A[2]->AsNumber()); }
static void FlattenAutoV(const TSharedPtr<FJsonValue>& V,TArray<float>& Out) { if(V->Type==EJson::Array) for(auto A:V->AsArray()) FlattenAutoV(A,Out); else if(V->Type==EJson::Boolean) Out.Add(V->AsBool()?1:0); else Out.Add(V->AsNumber()); }

UAutoVPlayer::UAutoVPlayer() { PrimaryComponentTick.bCanEverTick=true; }
UAutoVPlayer::~UAutoVPlayer() = default;
void UAutoVPlayer::BeginPlay() { Super::BeginPlay(); if(Effect) LoadEffect(Effect); }
void UAutoVPlayer::EndPlay(const EEndPlayReason::Type Reason) { FlushRenderingCommands(); Scene.Reset(); Super::EndPlay(Reason); }
bool UAutoVPlayer::LoadEffect(UAutoVAsset* Asset) {
    FString Error;
    if(!Asset || !Asset->Validate(Error)) { UE_LOG(LogTemp,Error,TEXT("AutoV load: %s"),*Error); return false; }
    FlushRenderingCommands();
    auto NewScene=MakeShared<FAutoVScene,ESPMode::ThreadSafe>(); auto Root=ParseAutoV(Asset->Manifest);
    NewScene->Duration=Root->GetNumberField(TEXT("duration")); NewScene->FPS=Root->GetNumberField(TEXT("fps"));
    auto Ref=Root->GetObjectField(TEXT("reference")); NewScene->ReferenceTime=Ref->GetNumberField(TEXT("time")); NewScene->Exposure=Ref->GetNumberField(TEXT("exposure"));
    NewScene->Background=FLinearColor(FColor::FromHex(Ref->GetStringField(TEXT("background"))));
    auto Camera=Root->GetObjectField(TEXT("camera")); NewScene->Position=VectorAutoV(Camera->GetArrayField(TEXT("position"))); NewScene->Target=VectorAutoV(Camera->GetArrayField(TEXT("target")));
    NewScene->Fov=Camera->GetNumberField(TEXT("fov")); NewScene->Aspect=Camera->GetNumberField(TEXT("aspect")); NewScene->Near=Camera->GetNumberField(TEXT("near")); NewScene->Far=Camera->GetNumberField(TEXT("far"));
    for(auto GValue:Root->GetArrayField(TEXT("geometries"))) {
        auto G=GValue->AsObject(); FAutoVGeometry Geo; Geo.Base=G->GetIntegerField(TEXT("baseGeometry"));
        if(Geo.Base<0) {
            const auto& P=G->GetArrayField(TEXT("positions")); const auto& N=G->GetArrayField(TEXT("normals")); const auto& UV=G->GetArrayField(TEXT("uv")); const auto& Rows=G->GetArrayField(TEXT("attributeIndex"));
            for(int32 I=0;I<P.Num()/3;++I) Geo.Vertices.Add({FVector3f(P[3*I]->AsNumber(),P[3*I+1]->AsNumber(),P[3*I+2]->AsNumber()),FVector3f(N[3*I]->AsNumber(),N[3*I+1]->AsNumber(),N[3*I+2]->AsNumber()),FVector2f(UV[2*I]->AsNumber(),UV[2*I+1]->AsNumber()),float(Rows[I]->AsNumber())});
            for(auto V:G->GetArrayField(TEXT("indices"))) Geo.Indices.Add(uint32(V->AsNumber()));
        }
        NewScene->Geometries.Add(MoveTemp(Geo));
    }
    auto& Images=FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
    for(const auto& File:Asset->Files) {
        if(File.Path.EndsWith(TEXT(".json"))) continue;
        FAutoVTexture Texture;
        if(File.Path.EndsWith(TEXT(".bin")) || File.Path.EndsWith(TEXT(".rgba32f"))) {
            FString MetaPath=File.Path.EndsWith(TEXT(".bin"))?File.Path.LeftChop(4)+TEXT(".json"):File.Path+TEXT(".json");
            auto InfoBytes=Asset->FindFile(MetaPath); if(!InfoBytes) return false;
            auto Info=ParseAutoV(Utf8AutoV(*InfoBytes)); if(!Info) return false;
            Texture.Width=Info->GetIntegerField(TEXT("width")); Texture.Height=Info->GetIntegerField(TEXT("height")); Texture.Float=true; Texture.Bytes=File.Bytes;
            if(Texture.Width<1 || Texture.Width>16384 || Texture.Height<1 || Texture.Height>16384 || int64(Texture.Width)*Texture.Height*16!=Texture.Bytes.Num()) { UE_LOG(LogTemp,Error,TEXT("AutoV: invalid float texture %s"),*File.Path); return false; }
        } else {
            auto Image=Images.CreateImageWrapper(EImageFormat::PNG); TArray64<uint8> Raw;
            if(!Image->SetCompressed(File.Bytes.GetData(),File.Bytes.Num()) || !Image->GetRaw(ERGBFormat::RGBA,8,Raw)) return false;
            Texture.Width=Image->GetWidth(); Texture.Height=Image->GetHeight();
            Texture.Bytes.SetNumUninitialized(Raw.Num());
            // PNG top-left rows -> source OpenGL texture convention. Data textures are never flipped.
            for(int32 Y=0;Y<Texture.Height;++Y) FMemory::Memcpy(Texture.Bytes.GetData()+Y*Texture.Width*4,Raw.GetData()+(Texture.Height-1-Y)*Texture.Width*4,Texture.Width*4);
        }
        NewScene->Textures.Add(File.Path,MoveTemp(Texture));
    }
    FAutoVTexture White; White.Bytes={255,255,255,255}; NewScene->Textures.Add(TEXT("__white"),MoveTemp(White));
    for(auto DValue:Root->GetArrayField(TEXT("draws"))) {
        auto D=DValue->AsObject(); FAutoVDraw Draw;
        Draw.Id=D->GetStringField(TEXT("id")); Draw.Program=D->GetStringField(TEXT("program")); Draw.Blend=D->GetStringField(TEXT("blend")); Draw.Side=D->GetStringField(TEXT("side")); Draw.Order=D->GetIntegerField(TEXT("order")); Draw.DepthTest=D->GetBoolField(TEXT("depthTest"));
        for(auto& Pair:D->GetObjectField(TEXT("textures"))->Values) Draw.Textures.Add(FString(Pair.Key),Pair.Value->AsString());
        auto Bindings=Draw.Program==TEXT("particle")?MakeArrayView(particleBindings):MakeArrayView(surfaceBindings);
        for(auto SValue:D->GetArrayField(TEXT("samples"))) {
            auto S=SValue->AsObject(); FAutoVSample Sample; Sample.Time=S->GetNumberField(TEXT("time")); Sample.Visible=S->GetBoolField(TEXT("visible")); Sample.DepthWrite=S->GetBoolField(TEXT("depthWrite")); Sample.Geometry=S->GetIntegerField(TEXT("geometry")); Sample.Uniforms.SetNumZeroed(512);
            auto U=S->GetObjectField(TEXT("uniforms"));
            for(auto& B:Bindings) {
                auto Value=U->Values.Find(B.Name); if(!Value) continue;
                TArray<float> Values; FlattenAutoV(*Value,Values); const int32 Components=FMath::Max(1,B.Components), Count=FMath::Max(1,B.Count);
                if(Values.Num()!=Components*Count) { UE_LOG(LogTemp,Error,TEXT("AutoV uniform shape mismatch: %s"),B.Name); return false; }
                for(int32 I=0;I<Count;++I) for(int32 C=0;C<Components && C<4;++C) Sample.Uniforms[B.Slot+I][C]=Values[I*Components+C];
            }
            const auto& M=S->GetArrayField(TEXT("matrix")); for(int32 I=0;I<16;++I) Sample.Uniforms[I/4][I%4]=M[I]->AsNumber();
            Draw.Samples.Add(MoveTemp(Sample));
        }
        NewScene->Draws.Add(MoveTemp(Draw));
    }
    NewScene->Draws.StableSort([](const FAutoVDraw& A,const FAutoVDraw& B){return A.Order<B.Order;});
    Effect=Asset; Scene=NewScene; Time=0; ReferenceTime=Scene->ReferenceTime;
    if(!Output) { Output=NewObject<UTextureRenderTarget2D>(this); Output->ClearColor=FLinearColor::Black; Output->InitCustomFormat(640,360,PF_B8G8R8A8,true); Output->UpdateResourceImmediate(true); }
    Render(); return true;
}
void UAutoVPlayer::TickComponent(float DeltaTime,ELevelTick TickType,FActorComponentTickFunction* F) {
    Super::TickComponent(DeltaTime,TickType,F); if(!Scene) return;
    if(Playing) Time+=DeltaTime;
    Time=Looping?FMath::Fmod(FMath::Max(0.f,Time),Scene->Duration):FMath::Clamp(Time,0.f,Scene->Duration); Render();
}
void UAutoVPlayer::Seek(float Seconds) { if(Scene) { Time=FMath::Clamp(Seconds,0.f,Scene->Duration); Render(); } }
void UAutoVPlayer::Render() {
    if(!Scene || !Output) return;
    auto Resource=Output->GameThread_GetRenderTargetResource(); auto Data=Scene; float T=Time,O=OrbitDegrees,E=ElevationDegrees,Z=FMath::Clamp(Zoom,.1f,10.f);
    ENQUEUE_RENDER_COMMAND(AutoVRender)([Resource,Data,T,O,E,Z](FRHICommandListImmediate& RHICmdList) { Data->Render(RHICmdList,Resource->GetRenderTargetTexture(),T,O,E,Z); });
}
bool UAutoVPlayer::Capture(const FString& Filename) {
    if(!Scene || !Output) return false; Render(); FlushRenderingCommands();
    TArray<FColor> Pixels; FReadSurfaceDataFlags Flags(RCM_UNorm); Flags.SetLinearToGamma(false);
    if(!Output->GameThread_GetRenderTargetResource()->ReadPixels(Pixels,Flags)) return false;
    auto& Images=FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper")); auto Image=Images.CreateImageWrapper(EImageFormat::PNG);
    if(!Image->SetRaw(Pixels.GetData(),Pixels.Num()*4,640,360,ERGBFormat::BGRA,8)) return false;
    IFileManager::Get().MakeDirectory(*FPaths::GetPath(Filename),true); return FFileHelper::SaveArrayToFile(Image->GetCompressed(),*Filename);
}
