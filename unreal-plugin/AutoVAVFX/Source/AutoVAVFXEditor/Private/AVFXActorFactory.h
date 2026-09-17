#pragma once
#include "CoreMinimal.h"
#include "ActorFactories/ActorFactory.h"
#include "AVFXActorFactory.generated.h"

UCLASS()
class UAVFXActorFactory : public UActorFactory
{
    GENERATED_BODY()
public:
    UAVFXActorFactory();
    virtual bool CanCreateActorFrom(const FAssetData& Data,FText& Error) override;
    virtual UObject* GetAssetFromActorInstance(AActor* Actor) override;
protected:
    virtual void PostSpawnActor(UObject* Asset,AActor* Actor) override;
};
