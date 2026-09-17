#include "AVFXImport.h"
#include "AVFXAsset.h"
#include "AVFXLayout.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAVFXCoordinatesTest,"AutoV.AVFX.CoordinatesAndABI",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAVFXCoordinatesTest::RunTest(const FString&)
{
    TestEqual(TEXT("Source forward becomes Unreal forward in cm"),AVFXSourceToUnreal().TransformPosition(FVector(0,0,1)),FVector4(100,0,0,1));
    TestEqual(TEXT("Source up becomes Unreal up"),AVFXSourceToUnreal().TransformPosition(FVector(0,1,0)),FVector4(0,0,100,1));
    FAVFXLayout Layout;
    TestTrue(TEXT("Particle ABI"),GetAVFXLayout(TEXT("particle"),Layout));
    TestTrue(TEXT("uTime exists"),Layout.Fields.Contains(TEXT("uTime")));
    TestFalse(TEXT("Unknown program rejected"),GetAVFXLayout(TEXT("subParticle"),Layout));
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FAVFXImportTest,"AutoV.AVFX.FireProjectileImport",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FAVFXImportTest::RunTest(const FString&)
{
    FString Path;
    if(!FParse::Value(FCommandLine::Get(),TEXT("AVFXFixture="),Path)) {AddError(TEXT("Pass -AVFXFixture=<absolute fire-projectile.avfx path>"));return false;}
    TArray<uint8> Data;
    if(!FFileHelper::LoadFileToArray(Data,*Path)){AddError(TEXT("Cannot load fixture"));return false;}
    FString Error;
    auto* Asset=ImportAVFX(Data,GetTransientPackage(),MakeUniqueObjectName(GetTransientPackage(),UAVFXAsset::StaticClass()),RF_Transient,Error);
    if(!TestNotNull(*Error,Asset))return false;
    TestEqual(TEXT("Eight fire projectile draws"),Asset->Draws.Num(),8);
    TestTrue(TEXT("Meshes imported"),Asset->Meshes.Num()>0);
    for(const auto& Draw:Asset->Draws)
    {
        TestTrue(TEXT("Samples and instance records present"),!Draw.Samples.IsEmpty()&&Draw.Instances.Num()%8==0);
        TestEqual(TEXT("Starts at zero"),Draw.Samples[0].Time,0.0);
        FAVFXLayout Layout;GetAVFXLayout(Draw.Program,Layout);
        TestEqual(TEXT("Packed shader ABI"),Draw.Samples[0].Uniforms.Num(),Layout.Slots);
    }
    // Corrupt the first PNG body; the inventory must reject before decoding.
    bool bChanged=false;
    for(int32 I=0;I+24<Data.Num();I++)if(Data[I]==137&&Data[I+1]==80&&Data[I+2]==78&&Data[I+3]==71)
    {Data[I+20]^=1;bChanged=true;break;}
    TestTrue(TEXT("Texture fixture present"),bChanged);
    Error.Empty();
    TestNull(TEXT("Corrupted texture rejected"),ImportAVFX(Data,GetTransientPackage(),NAME_None,RF_Transient,Error));
    TestTrue(TEXT("Useful integrity error"),Error.Contains(TEXT("Hash/size")));
    return true;
}
#endif
