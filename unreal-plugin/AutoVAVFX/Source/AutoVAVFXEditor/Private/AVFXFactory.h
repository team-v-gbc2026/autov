#pragma once
#include "CoreMinimal.h"
#include "Factories/Factory.h"
#include "AVFXFactory.generated.h"

UCLASS()
class UAVFXFactory : public UFactory
{
    GENERATED_BODY()
public:
    UAVFXFactory();
    virtual UObject* FactoryCreateFile(UClass* Class, UObject* Parent, FName Name, EObjectFlags Flags,
        const FString& Filename, const TCHAR* Parms, FFeedbackContext* Warn, bool& bOutOperationCanceled) override;
};
