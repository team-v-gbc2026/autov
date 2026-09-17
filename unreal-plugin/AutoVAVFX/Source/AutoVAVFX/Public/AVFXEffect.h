#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AVFXAsset.h"
#include "AVFXEffect.generated.h"

class FAVFXViewExtension;
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FAVFXFinished);

UCLASS(BlueprintType, Blueprintable, meta=(DisplayName="AVFX Effect"))
class AUTOVAVFX_API AAVFXEffect : public AActor
{
    GENERATED_BODY()
public:
    AAVFXEffect();
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="AVFX") TObjectPtr<UAVFXAsset> Effect;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Playback") bool bAutoplay = true;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Playback") bool bLoop = true;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Playback", meta=(ClampMin="0", ClampMax="4")) float Speed = 1;
    UPROPERTY(EditAnywhere, Category="Editor Preview") bool bEditorPreview = false;
    UPROPERTY(EditAnywhere, Category="Editor Preview", meta=(ClampMin="0", ClampMax="12")) float PreviewTime = 1;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Playback") float Time = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Playback") bool bPlaying = false;
    UPROPERTY(BlueprintAssignable, Category="Playback") FAVFXFinished Finished;
    UFUNCTION(BlueprintCallable, Category="AVFX") void SetEffect(UAVFXAsset* InEffect);
    UFUNCTION(BlueprintCallable, Category="Playback", CallInEditor) void Play();
    UFUNCTION(BlueprintCallable, Category="Playback", CallInEditor) void Pause();
    UFUNCTION(BlueprintCallable, Category="Playback", CallInEditor) void Restart();
    UFUNCTION(BlueprintCallable, Category="Playback") void Seek(float Seconds);
    virtual void Tick(float DeltaSeconds) override;
    virtual bool ShouldTickIfViewportsOnly() const override { return true; }
    virtual void OnConstruction(const FTransform& Transform) override;
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    virtual void Destroyed() override;
#if WITH_EDITOR
    virtual void PostEditChangeProperty(FPropertyChangedEvent& Event) override;
#endif
private:
    TSharedPtr<FAVFXViewExtension, ESPMode::ThreadSafe> Extension;
    void Publish();
};
