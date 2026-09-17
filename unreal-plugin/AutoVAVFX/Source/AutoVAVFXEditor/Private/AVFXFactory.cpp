#include "AVFXFactory.h"
#include "AVFXImport.h"
#include "AVFXAsset.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"

UAVFXFactory::UAVFXFactory()
{
    SupportedClass=UAVFXAsset::StaticClass();
    bEditorImport=true; bCreateNew=false;
    Formats.Add(TEXT("avfx;AutoV effect bundle"));
}
UObject* UAVFXFactory::FactoryCreateFile(UClass*,UObject* Parent,FName Name,EObjectFlags Flags,const FString& Filename,const TCHAR*,FFeedbackContext* Warn,bool& bCanceled)
{
    bCanceled=false;
    TArray<uint8> Bytes;
    if(IFileManager::Get().FileSize(*Filename)>256ll*1024*1024 || !FFileHelper::LoadFileToArray(Bytes,*Filename))
    { Warn->Logf(ELogVerbosity::Error,TEXT("AVFX: file unreadable or over 256 MiB")); return nullptr; }
    FString Error;
    auto* Asset=ImportAVFX(Bytes,Parent,Name,Flags,Error);
    if(!Asset) Warn->Logf(ELogVerbosity::Error,TEXT("AVFX: %s"),*Error);
    else Asset->SourceFile=Filename;
    return Asset;
}
