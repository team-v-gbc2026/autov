#pragma once
#include "CoreMinimal.h"
#include "Factories/Factory.h"
#include "Commandlets/Commandlet.h"
#include "AutoVFactory.generated.h"
UCLASS()
class UAutoVFactory : public UFactory {
    GENERATED_BODY()
public:
    UAutoVFactory();
    virtual bool FactoryCanImport(const FString& Filename) override;
    virtual UObject* FactoryCreateFile(UClass* Class,UObject* Parent,FName Name,EObjectFlags Flags,const FString& Filename,const TCHAR* Parms,FFeedbackContext* Warn,bool& Canceled) override;
};
UCLASS()
class UAutoVImportCommandlet : public UCommandlet {
    GENERATED_BODY()
public:
    UAutoVImportCommandlet();
    virtual int32 Main(const FString& Params) override;
};
