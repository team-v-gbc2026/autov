#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "AutoVPlayer.generated.h"
class UAutoVAsset;
class UTextureRenderTarget2D;
struct FAutoVScene;
class FAutoVWorldExtension;

/** Native 3D AVFX player, with reference-target and deferred-world rendering modes. */
UCLASS(ClassGroup=(AutoV),meta=(BlueprintSpawnableComponent))
class AUTOVRUNTIME_API UAutoVPlayer : public UActorComponent {
    GENERATED_BODY()
public:
    UAutoVPlayer();
    virtual ~UAutoVPlayer();
    UPROPERTY(EditAnywhere,BlueprintReadWrite,Category="Auto V") TObjectPtr<UAutoVAsset> Effect;
    UPROPERTY(VisibleAnywhere,BlueprintReadOnly,Transient,Category="Auto V") TObjectPtr<UTextureRenderTarget2D> Output;
    UPROPERTY(EditAnywhere,BlueprintReadWrite,Category="Auto V") bool Playing=true;
    /** Draw into the main scene with opaque depth testing instead of the reference output. */
    UPROPERTY(EditAnywhere,BlueprintReadWrite,Category="Auto V") bool RenderInWorld=false;
    UPROPERTY(EditAnywhere,BlueprintReadWrite,Category="Auto V") bool Looping=true;
    UPROPERTY(EditAnywhere,BlueprintReadWrite,Category="Auto V") float Time=0;
    UPROPERTY(EditAnywhere,BlueprintReadWrite,Category="Auto V") float OrbitDegrees=0;
    UPROPERTY(EditAnywhere,BlueprintReadWrite,Category="Auto V") float ElevationDegrees=0;
    UPROPERTY(EditAnywhere,BlueprintReadWrite,Category="Auto V") float Zoom=1;
    UPROPERTY(VisibleAnywhere,BlueprintReadOnly,Category="Auto V") float ReferenceTime=0;
    UFUNCTION(BlueprintCallable,Category="Auto V") bool LoadEffect(UAutoVAsset* Asset);
    UFUNCTION(BlueprintCallable,Category="Auto V") void Seek(float Seconds);
    UFUNCTION(BlueprintCallable,Category="Auto V") bool Capture(const FString& Filename);
    UFUNCTION(BlueprintCallable,Category="Auto V") void GetReferenceCamera(FVector& Position,FVector& Target,float& FieldOfView) const;
    virtual void BeginPlay() override;
    virtual void TickComponent(float DeltaTime,ELevelTick TickType,FActorComponentTickFunction* ThisTickFunction) override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    virtual void OnUnregister() override;
private:
    TSharedPtr<FAutoVScene,ESPMode::ThreadSafe> Scene;
    TSharedPtr<FAutoVWorldExtension,ESPMode::ThreadSafe> WorldExtension;
    void Render();
};
