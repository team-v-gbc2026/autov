#pragma once
#include "CoreMinimal.h"
#include "RHI.h"
#include "Dom/JsonObject.h"
struct FAutoVBinding { const TCHAR* Name; int32 Slot,Count,Components; };
#include "AutoVBindings.inl"
struct FAutoVVertex { FVector3f Position,Normal; FVector2f UV; float Row; };
struct FAutoVGeometry { TArray<FAutoVVertex> Vertices; TArray<uint32> Indices; int32 Base=-1; FBufferRHIRef VB,IB; };
struct FAutoVTexture { int32 Width=1,Height=1; bool Float=false; TArray<uint8> Bytes; FTextureRHIRef RHI; };
struct FAutoVSample { float Time=0; bool Visible=false,DepthWrite=false; int32 Geometry=0; TArray<FVector4f> Uniforms; };
struct FAutoVDraw { FString Id,Program,Blend,Side; int32 Order=0; bool DepthTest=true; TMap<FString,FString> Textures; TArray<FAutoVSample> Samples; };
struct FAutoVScene {
    float Duration=1,FPS=15,ReferenceTime=0,Exposure=1,Fov=30,Aspect=16.f/9,Near=.1f,Far=60;
    FLinearColor Background;
    FVector3f Position,Target;
    TArray<FAutoVDraw> Draws;
    TArray<FAutoVGeometry> Geometries;
    TMap<FString,FAutoVTexture> Textures;
    FTextureRHIRef LinearTarget,DepthTarget;
    FVertexDeclarationRHIRef Declaration;
    bool Initialized=false;
    void Init(FRHICommandListImmediate& RHICmdList);
    void Render(FRHICommandListImmediate& RHICmdList,FRHITexture* TargetTexture,float Time,float Orbit,float Elevation,float Zoom);
    void RenderWorld(FRHICommandListImmediate& R,float Time,const FMatrix44f& Actor,const FMatrix44f& View,const FMatrix44f& Projection,const FVector3f& Eye,float PreExposure);
};
