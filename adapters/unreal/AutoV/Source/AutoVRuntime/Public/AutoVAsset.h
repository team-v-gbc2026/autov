#pragma once
#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "AutoVAsset.generated.h"

/** Dependency bytes are cooked with the asset; playback never uses the source directory. */
USTRUCT()
struct FAutoVFile {
    GENERATED_BODY()
    UPROPERTY() FString Path;
    UPROPERTY() TArray<uint8> Bytes;
};

UCLASS(BlueprintType)
class AUTOVRUNTIME_API UAutoVAsset : public UDataAsset {
    GENERATED_BODY()
public:
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Auto V") FString EffectName;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Auto V") float Duration = 0;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Auto V") float FramesPerSecond = 0;
    UPROPERTY() FString Manifest;
    UPROPERTY() TArray<FAutoVFile> Files;
    const TArray<uint8>* FindFile(const FString& Path) const;
    /** Strict schema/resource checks shared by the factory and runtime. */
    bool Validate(FString& Error) const;
};
