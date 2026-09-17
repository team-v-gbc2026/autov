#include "AutoVFactory.h"
#include "AutoVAsset.h"
#include "Modules/ModuleManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/PackageName.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/SavePackage.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "libzip/zip.h"

/** Bounded, in-memory ZIP access; no archive entries are extracted to the filesystem. */
struct FAutoVInput {
    TArray<uint8> Compressed;
    zip_t* Archive=nullptr;
    FString Directory;
    ~FAutoVInput() { if(Archive) zip_close(Archive); }
    bool Open(const FString& Filename) {
        if(!Filename.EndsWith(TEXT(".zip"))) { Directory=FPaths::GetPath(Filename); return true; }
        int64 Size=IFileManager::Get().FileSize(*Filename);
        if(Size<=0 || Size>512ll*1024*1024 || !FFileHelper::LoadFileToArray(Compressed,*Filename)) return false;
        zip_error_t Error; zip_error_init(&Error);
        auto Source=zip_source_buffer_create(Compressed.GetData(),Compressed.Num(),0,&Error);
        if(Source) { Archive=zip_open_from_source(Source,ZIP_RDONLY,&Error); if(!Archive) zip_source_free(Source); }
        zip_error_fini(&Error); return Archive!=nullptr;
    }
    bool Read(const FString& Path,TArray<uint8>& Bytes) {
        if(Path.IsEmpty() || Path.Contains(TEXT("..")) || Path.Contains(TEXT(":")) || Path.Contains(TEXT("\\")) || Path.StartsWith(TEXT("/"))) return false;
        if(!Archive) { const FString Full=FPaths::Combine(Directory,Path); int64 Size=IFileManager::Get().FileSize(*Full); return Size>=0 && Size<=256ll*1024*1024 && FFileHelper::LoadFileToArray(Bytes,*Full); }
        FTCHARToUTF8 Name(*Path); zip_stat_t Stat; zip_stat_init(&Stat);
        if(zip_stat(Archive,Name.Get(),0,&Stat)!=0 || Stat.size>256ull*1024*1024 || Stat.encryption_method!=ZIP_EM_NONE) return false;
        auto File=zip_fopen(Archive,Name.Get(),0); if(!File) return false;
        Bytes.SetNumUninitialized(int32(Stat.size)); bool OK=zip_fread(File,Bytes.GetData(),Stat.size)==int64(Stat.size); zip_fclose(File); return OK;
    }
};

IMPLEMENT_MODULE(FDefaultModuleImpl, AutoVEditor)
UAutoVFactory::UAutoVFactory() { SupportedClass=UAutoVAsset::StaticClass(); bEditorImport=true; Formats.Add(TEXT("json;Auto V AVFX manifest")); Formats.Add(TEXT("zip;Auto V exported AVFX bundle")); }
bool UAutoVFactory::FactoryCanImport(const FString& Filename) { return Filename.EndsWith(TEXT(".avfx.json")) || Filename.EndsWith(TEXT(".zip")); }
UObject* UAutoVFactory::FactoryCreateFile(UClass*,UObject* Parent,FName Name,EObjectFlags Flags,const FString& Filename,const TCHAR*,FFeedbackContext* Warn,bool& Canceled) {
    Canceled=false;
    FString Text; FAutoVInput Input; TArray<uint8> ManifestBytes;
    if (!FactoryCanImport(Filename) || !Input.Open(Filename) || !Input.Read(Filename.EndsWith(TEXT(".zip"))?TEXT("effect.avfx.json"):FPaths::GetCleanFilename(Filename),ManifestBytes)) { UE_LOG(LogTemp,Error,TEXT("AutoV: cannot read effect.avfx.json from %s"),*Filename); return nullptr; }
    FUTF8ToTCHAR Decoded(reinterpret_cast<const ANSICHAR*>(ManifestBytes.GetData()),ManifestBytes.Num()); Text=FString(Decoded.Length(),Decoded.Get());
    TSharedPtr<FJsonObject> Root;
    if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text),Root) || !Root) return nullptr;
    auto Asset=NewObject<UAutoVAsset>(GetTransientPackage()); Asset->Manifest=Text;
    // Import only required dependencies, never execute scripts carried in a bundle.
    TSet<FString> Paths;
    const TArray<TSharedPtr<FJsonValue>>* Draws;
    if(!Root->TryGetArrayField(TEXT("draws"),Draws)) return nullptr;
    for(auto DValue:*Draws) {
        auto D=DValue->AsObject(); if(!D) return nullptr;
        const TSharedPtr<FJsonObject>* Textures; const TArray<TSharedPtr<FJsonValue>>* Samples; FString Id;
        if(!D->TryGetObjectField(TEXT("textures"),Textures) || !D->TryGetArrayField(TEXT("samples"),Samples) || !D->TryGetStringField(TEXT("id"),Id)) return nullptr;
        for(const auto& T:(*Textures)->Values) { FString P=T.Value->AsString(); Paths.Add(P); if(P.EndsWith(TEXT(".rgba32f"))) Paths.Add(P+TEXT(".json")); }
        for(auto SValue:*Samples) { auto S=SValue->AsObject(); double Geo; if(!S || !S->TryGetNumberField(TEXT("geometry"),Geo)) return nullptr; FString Stem=FString::Printf(TEXT("attributes/%s-%d"),*Id,int32(Geo)); Paths.Add(Stem+TEXT(".bin")); Paths.Add(Stem+TEXT(".json")); }
    }
    int64 Total=0;
    for(const auto& P:Paths) {
        if(P.IsEmpty() || P.Contains(TEXT("..")) || P.Contains(TEXT(":")) || P.Contains(TEXT("\\")) || P.StartsWith(TEXT("/"))) { UE_LOG(LogTemp,Error,TEXT("AutoV: unsafe dependency path")); return nullptr; }
        FAutoVFile File; File.Path=P;
        if(!Input.Read(P,File.Bytes) || (Total+=File.Bytes.Num())>1024ll*1024*1024) { UE_LOG(LogTemp,Error,TEXT("AutoV: missing or oversized dependency %s"),*P); return nullptr; }
        Asset->Files.Add(MoveTemp(File));
    }
    FString Error;
    if(!Asset->Validate(Error)) { UE_LOG(LogTemp,Error,TEXT("AutoV import rejected: %s"),*Error); return nullptr; }
    Asset->EffectName=Root->GetStringField(TEXT("name")); Asset->Duration=Root->GetNumberField(TEXT("duration")); Asset->FramesPerSecond=Root->GetNumberField(TEXT("fps"));
    // Duplicate after validation, so a failed import never mutates an existing asset.
    auto Result=DuplicateObject<UAutoVAsset>(Asset,Parent,Name); Result->SetFlags(Flags);
    UE_LOG(LogTemp,Display,TEXT("AutoV imported %s: %d draws, %d embedded dependencies"),*Result->EffectName,Draws->Num(),Result->Files.Num());
    return Result;
}
UAutoVImportCommandlet::UAutoVImportCommandlet() { IsClient=false; IsServer=false; IsEditor=true; LogToConsole=true; }
int32 UAutoVImportCommandlet::Main(const FString& Params) {
    FString Bundle,Destination;
    if(!FParse::Value(*Params,TEXT("Bundle="),Bundle) || !FParse::Value(*Params,TEXT("Destination="),Destination) || !FPackageName::IsValidLongPackageName(Destination)) { UE_LOG(LogTemp,Error,TEXT("Use -Bundle=.../effect.avfx.json -Destination=/Game/AutoV/Fire")); return 1; }
    // Refuse overwrite; use a new package name or explicitly remove the old asset in editor.
    if(FPackageName::DoesPackageExist(Destination)) { UE_LOG(LogTemp,Error,TEXT("Destination already exists: %s"),*Destination); return 2; }
    UPackage* Package=CreatePackage(*Destination); auto Factory=NewObject<UAutoVFactory>(); bool Canceled=false;
    UObject* Asset=Factory->FactoryCreateFile(UAutoVAsset::StaticClass(),Package,*FPackageName::GetLongPackageAssetName(Destination),RF_Public|RF_Standalone,Bundle,nullptr,GWarn,Canceled);
    if(!Asset) return 3;
    FAssetRegistryModule::AssetCreated(Asset); Package->MarkPackageDirty();
    FSavePackageArgs Args; Args.TopLevelFlags=RF_Public|RF_Standalone; Args.SaveFlags=SAVE_NoError;
    const FString File=FPackageName::LongPackageNameToFilename(Destination,FPackageName::GetAssetPackageExtension());
    return UPackage::SavePackage(Package,Asset,*File,Args)?0:4;
}
