#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "AutoVDemoMode.generated.h"
class UAutoVPlayer;
class ACameraActor;
class AStaticMeshActor;
UCLASS()
class AAutoVDemoHUD : public AHUD {
    GENERATED_BODY()
public:
    virtual void DrawHUD() override;
};
UCLASS()
class AAutoVDemoMode : public AGameModeBase {
    GENERATED_BODY()
public:
    AAutoVDemoMode();
    UPROPERTY() TObjectPtr<UAutoVPlayer> Player;
    UPROPERTY() TObjectPtr<ACameraActor> Camera;
    UPROPERTY() TObjectPtr<AStaticMeshActor> Occluder;
    virtual void StartPlay() override;
    virtual void Tick(float Delta) override;
private:
    int32 Case=0,Frames=0,CaptureIndex=0;
    FString CaptureDirectory;
    FString WorldTestDirectory;
    int32 WorldTestStep=0;
    FVector CameraBase,CameraTarget;
    float VerticalFov=30;
    bool SelectCase(int32 Index);
};
