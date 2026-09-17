#include "AVFXEffect.h"
#include "AVFXRenderer.h"
#include "Components/SceneComponent.h"
#include "Engine/World.h"
#include "TextureResource.h"

AAVFXEffect::AAVFXEffect()
{
    PrimaryActorTick.bCanEverTick = true;
#if WITH_EDITORONLY_DATA
    bRunConstructionScriptOnDrag = true;
#endif
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("AVFX"));
}
void AAVFXEffect::SetEffect(UAVFXAsset* InEffect) { Effect=InEffect; Time=0; Publish(); }
void AAVFXEffect::Play() { bPlaying=true; if (!GetWorld()->IsGameWorld()) bEditorPreview=true; }
void AAVFXEffect::Pause() { bPlaying=false; bEditorPreview=false; PreviewTime=Time; }
void AAVFXEffect::Restart() { Seek(0); Play(); }
void AAVFXEffect::Seek(float Seconds)
{
    if (!FMath::IsFinite(Seconds)) return;
    Time=Effect ? FMath::Clamp(Seconds,0.f,float(Effect->Duration)) : 0;
    if (GetWorld() && !GetWorld()->IsGameWorld()) PreviewTime=Time;
    Publish();
}
void AAVFXEffect::OnConstruction(const FTransform& Transform)
{
    Super::OnConstruction(Transform);
    Time=PreviewTime;
    Publish();
}
void AAVFXEffect::BeginPlay() { Super::BeginPlay(); Time=0; bPlaying=bAutoplay; Publish(); }
void AAVFXEffect::EndPlay(const EEndPlayReason::Type Reason) { if(Extension) Extension->Submit(nullptr); Extension.Reset(); Super::EndPlay(Reason); }
void AAVFXEffect::Destroyed() { if(Extension) Extension->Submit(nullptr); Extension.Reset(); Super::Destroyed(); }
#if WITH_EDITOR
void AAVFXEffect::PostEditChangeProperty(FPropertyChangedEvent& Event)
{
    Super::PostEditChangeProperty(Event);
    if(!bEditorPreview) Time=PreviewTime;
    Publish();
}
#endif
void AAVFXEffect::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!Effect || Effect->Duration<=0) { Publish(); return; }
    const bool Editor=!GetWorld()->IsGameWorld();
    if (Editor ? bEditorPreview : bPlaying)
    {
        Time+=DeltaSeconds*FMath::Max(0.f,Speed);
        if(Time>=Effect->Duration)
        {
            if(Editor || bLoop) Time=FMath::Fmod(Time,float(Effect->Duration));
            else {Time=Effect->Duration; bPlaying=false; Finished.Broadcast();}
        }
    }
    else if(Editor) Time=FMath::Clamp(PreviewTime,0.f,float(Effect->Duration));
    Publish();
}
void AAVFXEffect::Publish()
{
    if(!GetWorld() || IsTemplate()) return;
    if(!Extension) Extension=FSceneViewExtensions::NewExtension<FAVFXViewExtension>();
    auto Frame=MakeShared<FAVFXFrame,ESPMode::ThreadSafe>();
    Frame->Scene=GetWorld()->Scene;
    bool bVisible=!IsHidden();
#if WITH_EDITOR
    if(!GetWorld()->IsGameWorld()) bVisible=bVisible&&!IsHiddenEd();
#endif
    if(Effect && Effect->AdapterVersion==1 && bVisible) for(const FAVFXDraw& Draw:Effect->Draws)
    {
        if(Time<Draw.Start || Time>=Draw.End || Draw.Samples.IsEmpty()) continue;
        int32 Low=0,High=Draw.Samples.Num()-1;
        while(Low<High) {int32 Mid=(Low+High+1)/2; if(Draw.Samples[Mid].Time<=Time) Low=Mid; else High=Mid-1;}
        const FAVFXSample& Sample=Draw.Samples[Low];
        if(!Sample.bVisible || !Effect->Meshes.IsValidIndex(Sample.Mesh) || Sample.Matrix.Num()!=16) continue;
        FAVFXRenderDraw Out;
        if(!GetAVFXLayout(Draw.Program,Out.Layout)) continue;
        if(Sample.Uniforms.Num()!=Out.Layout.Slots) continue;
        Out.Program=Draw.Program; Out.Blend=Draw.Blend; Out.Order=Draw.Order;
        for(int32 I=0;I<16;I++) Out.Model.M[I/4][I%4]=Sample.Matrix[I];
        // Return actor transform to source coordinates. Matrices use row vectors
        // on the CPU; uploaded rows are GLSL columns (SPIRV-Cross preserves this).
        Out.Model=Out.Model*AVFXSourceToUnreal()*GetActorTransform().ToMatrixWithScale()*AVFXSourceToUnreal().Inverse();
        for(const auto& V:Sample.Uniforms) Out.Uniforms.Add(FVector4f(V));
        if(const auto* Field=Out.Layout.Fields.Find(TEXT("uTime"))) Out.Uniforms[Field->Slot].X=Time-Draw.Start;
        const FAVFXMesh& Mesh=Effect->Meshes[Sample.Mesh];
        for(const auto& V:Mesh.Vertices) Out.Vertices.Add(FVector4f(V));
        for(const auto& V:Draw.Instances) Out.Instances.Add(FVector4f(V));
        Out.Indices=Mesh.Indices;
        for(const auto& Pair:Draw.Textures) if(Pair.Value && Pair.Value->GetResource())
        {
            Out.Textures.Add(Pair.Key,Pair.Value->GetResource()->TextureRHI);
            Out.Samplers.Add(Pair.Key,Pair.Value->GetResource()->SamplerStateRHI);
        }
        Frame->Draws.Add(MoveTemp(Out));
    }
    Frame->Draws.StableSort([](const auto& A,const auto& B){return A.Order<B.Order;});
    Extension->Submit(Frame);
}
