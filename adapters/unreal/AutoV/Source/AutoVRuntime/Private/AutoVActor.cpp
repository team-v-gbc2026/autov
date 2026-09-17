#include "AutoVActor.h"
#include "AutoVPlayer.h"
#include "Components/SceneComponent.h"
AAutoVActor::AAutoVActor() {
    RootComponent=CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
    Player=CreateDefaultSubobject<UAutoVPlayer>(TEXT("AutoVPlayer")); Player->RenderInWorld=true;
}
void AAutoVActor::OnConstruction(const FTransform& Transform) {
    Super::OnConstruction(Transform); if(Player->Effect && Player->IsRegistered()) Player->LoadEffect(Player->Effect);
}
