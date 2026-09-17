#include "AVFXActorFactory.h"
#include "AVFXEffect.h"
#include "AssetRegistry/AssetData.h"

UAVFXActorFactory::UAVFXActorFactory()
{
    DisplayName=NSLOCTEXT("AutoVAVFX","ActorName","AVFX Effect");
    NewActorClass=AAVFXEffect::StaticClass();
}
bool UAVFXActorFactory::CanCreateActorFrom(const FAssetData& Data,FText& Error)
{
    if(Data.IsValid() && Data.GetClass() && Data.GetClass()->IsChildOf(UAVFXAsset::StaticClass()))return true;
    Error=NSLOCTEXT("AutoVAVFX","NotAVFX","Choose an imported AVFX effect asset.");return false;
}
void UAVFXActorFactory::PostSpawnActor(UObject* Asset,AActor* Actor)
{
    if(auto* Effect=Cast<AAVFXEffect>(Actor))Effect->SetEffect(Cast<UAVFXAsset>(Asset));
}
UObject* UAVFXActorFactory::GetAssetFromActorInstance(AActor* Actor)
{
    const auto* Effect=Cast<AAVFXEffect>(Actor);return Effect?Effect->Effect.Get():nullptr;
}
