#pragma once
#include "CoreMinimal.h"

struct FAVFXField { int32 Slot; int32 Count; int32 Components; };
struct FAVFXLayout
{
    int32 Slots = 0;
    FString VertexHash, FragmentHash;
    TMap<FString, FAVFXField> Fields;
    TArray<FString> Attributes;
    TArray<int32> AttributeWidths;
};
AUTOVAVFX_API bool GetAVFXLayout(const FString& Program, FAVFXLayout& Layout);

// Source +Z forward / +Y up meters -> UE +X forward / +Z up centimeters.
AUTOVAVFX_API FMatrix AVFXSourceToUnreal();
