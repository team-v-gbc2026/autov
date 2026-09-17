#pragma once
#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Engine/Texture2D.h"
#include "AVFXAsset.generated.h"

USTRUCT()
struct FAVFXMesh
{
    GENERATED_BODY()
    // Three float4s per vertex: source position, normal, UV. Source meters/Y-up.
    UPROPERTY() TArray<FVector4> Vertices;
    UPROPERTY() TArray<uint32> Indices;
};

USTRUCT()
struct FAVFXSample
{
    GENERATED_BODY()
    UPROPERTY() double Time = 0;
    UPROPERTY() bool bVisible = true;
    UPROPERTY() int32 Mesh = 0;
    UPROPERTY() TArray<double> Matrix;
    UPROPERTY() TArray<FVector4> Uniforms;
};

USTRUCT()
struct FAVFXDraw
{
    GENERATED_BODY()
    UPROPERTY() FString Id;
    UPROPERTY() FString Program;
    UPROPERTY() FString Blend;
    UPROPERTY() int32 Order = 0;
    UPROPERTY() double Start = 0;
    UPROPERTY() double End = 0;
    UPROPERTY() TArray<FVector4> Instances;
    UPROPERTY() TArray<FAVFXSample> Samples;
    UPROPERTY() TMap<FName, TObjectPtr<UTexture2D>> Textures;
};

UCLASS(BlueprintType)
class AUTOVAVFX_API UAVFXAsset : public UDataAsset
{
    GENERATED_BODY()
public:
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="AVFX") FString EffectName;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="AVFX") double Duration = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="AVFX") FString SourceFile;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="AVFX") FString ImportNotes;
    UPROPERTY() int32 AdapterVersion = 1;
    UPROPERTY() TArray<FAVFXMesh> Meshes;
    UPROPERTY() TArray<FAVFXDraw> Draws;
};
