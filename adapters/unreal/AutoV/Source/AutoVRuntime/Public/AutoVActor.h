#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AutoVActor.generated.h"
class UAutoVPlayer;
/** Place an imported effect in a UE world. The actor transform uses UE centimetres. */
UCLASS()
class AUTOVRUNTIME_API AAutoVActor : public AActor {
    GENERATED_BODY()
public:
    AAutoVActor();
    UPROPERTY(VisibleAnywhere,BlueprintReadOnly,Category="Auto V") TObjectPtr<UAutoVPlayer> Player;
    virtual void OnConstruction(const FTransform& Transform) override;
};
