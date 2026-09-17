#include "AutoVDemoMode.h"
#include "AutoVPlayer.h"
#include "AutoVActor.h"
#include "AutoVAsset.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/Canvas.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"
#include "Engine/World.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/DirectionalLight.h"
#include "UnrealClient.h"

AAutoVDemoMode::AAutoVDemoMode() { HUDClass=AAutoVDemoHUD::StaticClass(); DefaultPawnClass=nullptr; PrimaryActorTick.bCanEverTick=true; }
bool AAutoVDemoMode::SelectCase(int32 Index) {
    const TCHAR* Path=Index==0?TEXT("/Game/AutoV/Fire.Fire"):TEXT("/Game/AutoV/Shield.Shield");
    auto Asset=LoadObject<UAutoVAsset>(nullptr,Path); if(!Asset || !Player->LoadEffect(Asset)) { UE_LOG(LogTemp,Error,TEXT("AutoV demo failed to load %s"),Path); return false; }
    Case=Index; Player->OrbitDegrees=0; Player->ElevationDegrees=0; Player->Zoom=1;
    Player->GetReferenceCamera(CameraBase,CameraTarget,VerticalFov);
    if(Occluder) Occluder->SetActorLocation(FMath::Lerp(CameraTarget,CameraBase,.4f));
    return true;
}
void AAutoVDemoMode::StartPlay() {
    Super::StartPlay();
    auto EffectActor=GetWorld()->SpawnActor<AAutoVActor>(); Player=EffectActor->Player; Player->RenderInWorld=false;
    if(!SelectCase(0)) { FPlatformMisc::RequestExitWithStatus(false,1); return; }
    Camera=GetWorld()->SpawnActor<ACameraActor>();
    Occluder=GetWorld()->SpawnActor<AStaticMeshActor>();
    Occluder->GetStaticMeshComponent()->SetMobility(EComponentMobility::Movable);
    Occluder->GetStaticMeshComponent()->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cube.Cube")));
    Occluder->SetActorScale3D(FVector(.65,.65,3)); Occluder->SetActorLocation(FMath::Lerp(CameraTarget,CameraBase,.4f)); Occluder->SetActorHiddenInGame(true);
    auto Light=GetWorld()->SpawnActor<ADirectionalLight>(); Light->SetActorRotation(FRotator(-45,-30,0));
    auto PC=GetWorld()->GetFirstPlayerController(); if(PC) { PC->bShowMouseCursor=true; PC->SetInputMode(FInputModeGameAndUI()); PC->SetViewTarget(Camera); }
    FParse::Value(FCommandLine::Get(),TEXT("AutoVCapture="),CaptureDirectory);
    if(!CaptureDirectory.IsEmpty()) { Player->Playing=false; Player->Seek(Player->ReferenceTime); }
    FParse::Value(FCommandLine::Get(),TEXT("AutoVWorldTest="),WorldTestDirectory);
    if(!WorldTestDirectory.IsEmpty()) { Player->RenderInWorld=true; Player->Playing=false; Player->Seek(Player->ReferenceTime); }
}
void AAutoVDemoMode::Tick(float Delta) {
    Super::Tick(Delta); if(!Player) return;
    FVector Offset=CameraBase-CameraTarget;
    Offset=FQuat(FVector::UpVector,FMath::DegreesToRadians(-Player->OrbitDegrees)).RotateVector(Offset);
    FVector Right=FVector::CrossProduct(-Offset,FVector::UpVector).GetSafeNormal();
    Offset=FQuat(Right,FMath::DegreesToRadians(Player->ElevationDegrees)).RotateVector(Offset)*Player->Zoom;
    Camera->SetActorLocation(CameraTarget+Offset); Camera->SetActorRotation((-Offset).Rotation());
    Camera->GetCameraComponent()->SetFieldOfView(FMath::RadiansToDegrees(2*FMath::Atan(FMath::Tan(FMath::DegreesToRadians(VerticalFov)*.5f)*16.f/9)));
    if(!WorldTestDirectory.IsEmpty()) {
        if(++Frames<40) return; Frames=0;
        if(WorldTestStep==0) FScreenshotRequest::RequestScreenshot(FPaths::Combine(WorldTestDirectory,TEXT("world-clear.png")),false,false);
        else if(WorldTestStep==1) Occluder->SetActorHiddenInGame(false);
        else if(WorldTestStep==2) FScreenshotRequest::RequestScreenshot(FPaths::Combine(WorldTestDirectory,TEXT("world-occluded.png")),false,false);
        else if(WorldTestStep==3) { Occluder->SetActorHiddenInGame(true); SelectCase(1); Player->Playing=false; Player->Seek(Player->ReferenceTime); }
        else if(WorldTestStep==4) FScreenshotRequest::RequestScreenshot(FPaths::Combine(WorldTestDirectory,TEXT("world-shield.png")),false,false);
        else if(WorldTestStep==5) { FPlatformMisc::RequestExit(false); return; }
        ++WorldTestStep; return;
    }
    if(!CaptureDirectory.IsEmpty()) {
        if(++Frames<12) return; Frames=0;
        FString Name=Case==0?TEXT("fire-projectile"):TEXT("shield");
        FString File=FPaths::Combine(CaptureDirectory,Name,FString::Printf(TEXT("unreal-view-%d.png"),(CaptureIndex%3)*90));
        if(!Player->Capture(File)) { UE_LOG(LogTemp,Error,TEXT("AutoV capture failed: %s"),*File); FPlatformMisc::RequestExitWithStatus(false,2); return; }
        UE_LOG(LogTemp,Display,TEXT("AutoV captured %s at %.9f"),*File,Player->Time);
        ++CaptureIndex;
        if(CaptureIndex==6) { FPlatformMisc::RequestExit(false); return; }
        if(CaptureIndex==3 && !SelectCase(1)) { FPlatformMisc::RequestExitWithStatus(false,3); return; }
        Player->Playing=false; Player->OrbitDegrees=(CaptureIndex%3)*90; Player->Seek(Player->ReferenceTime); return;
    }
    auto PC=GetWorld()->GetFirstPlayerController(); if(!PC) return;
    if(PC->WasInputKeyJustPressed(EKeys::One)) SelectCase(0);
    if(PC->WasInputKeyJustPressed(EKeys::Two)) SelectCase(1);
    if(PC->WasInputKeyJustPressed(EKeys::SpaceBar)) Player->Playing=!Player->Playing;
    if(PC->WasInputKeyJustPressed(EKeys::R)) Player->Seek(0);
    if(PC->WasInputKeyJustPressed(EKeys::F)) { Player->Playing=false; Player->Seek(Player->ReferenceTime); }
    if(PC->WasInputKeyJustPressed(EKeys::V)) Player->RenderInWorld=!Player->RenderInWorld;
    if(PC->WasInputKeyJustPressed(EKeys::O)) Occluder->SetActorHiddenInGame(!Occluder->IsHidden());
    if(PC->WasInputKeyJustPressed(EKeys::MouseScrollUp)) Player->Zoom=FMath::Max(.15f,Player->Zoom*.9f);
    if(PC->WasInputKeyJustPressed(EKeys::MouseScrollDown)) Player->Zoom=FMath::Min(6.f,Player->Zoom*1.1f);
    if(PC->IsInputKeyDown(EKeys::LeftMouseButton)) { float X,Y; PC->GetInputMouseDelta(X,Y); Player->OrbitDegrees+=X*.4f; Player->ElevationDegrees=FMath::Clamp(Player->ElevationDegrees+Y*.3f,-60.f,60.f); }
}
void AAutoVDemoHUD::DrawHUD() {
    Super::DrawHUD(); auto Mode=Cast<AAutoVDemoMode>(GetWorld()->GetAuthGameMode()); if(!Mode || !Mode->Player || !Mode->Player->Output) return;
    float W=Canvas->SizeX,H=W*9/16; if(H>Canvas->SizeY) { H=Canvas->SizeY; W=H*16/9; }
    if(!Mode->Player->RenderInWorld) DrawTexture(Mode->Player->Output,(Canvas->SizeX-W)/2,(Canvas->SizeY-H)/2,W,H,0,0,1,1,FLinearColor::White,BLEND_Opaque);
    DrawText(TEXT("AUTO V | 1/2 Effect   Space Pause   Drag Orbit   Wheel Zoom   R Restart   F Reference   V World   O Occluder"),FLinearColor::White,16,16,nullptr,1);
    DrawText(FString::Printf(TEXT("%s  |  %.2fs  |  Native 3D reference renderer"),*Mode->Player->Effect->EffectName,Mode->Player->Time),FLinearColor::White,16,40,nullptr,1);
}
