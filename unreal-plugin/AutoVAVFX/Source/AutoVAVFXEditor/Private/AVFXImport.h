#pragma once
#include "CoreMinimal.h"
class UAVFXAsset;
// Transactional: returns no asset on invalid archives. Does not extract files.
UAVFXAsset* ImportAVFX(TConstArrayView<uint8> Bytes, UObject* Parent, FName Name, EObjectFlags Flags, FString& Error);
