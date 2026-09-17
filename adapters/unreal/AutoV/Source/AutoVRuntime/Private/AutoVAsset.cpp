#include "AutoVAsset.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

const TArray<uint8>* UAutoVAsset::FindFile(const FString& Path) const {
    for (const auto& File : Files) if (File.Path == Path) return &File.Bytes;
    return nullptr;
}

bool UAutoVAsset::Validate(FString& Error) const {
    TSharedPtr<FJsonObject> Root;
    if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Manifest), Root) || !Root) { Error = TEXT("Invalid JSON"); return false; }
    auto Fail = [&](const FString& Why) { Error = Why; return false; };
    FString Format, Coordinates;
    if (!Root->TryGetStringField(TEXT("format"), Format) || Format != TEXT("avfx/0.1")) return Fail(TEXT("Expected avfx/0.1"));
    if (!Root->TryGetStringField(TEXT("coordinates"), Coordinates) || Coordinates != TEXT("right-handed-y-up-metres")) return Fail(TEXT("Unsupported coordinate system"));
    double FPS = 0, Seconds = 0;
    if (!Root->TryGetNumberField(TEXT("fps"), FPS) || !(FPS == 15 || FPS == 30 || FPS == 60) ||
        !Root->TryGetNumberField(TEXT("duration"), Seconds) || !FMath::IsFinite(Seconds) || Seconds <= 0 || Seconds > 60) return Fail(TEXT("Invalid duration/fps"));
    const TArray<TSharedPtr<FJsonValue>> *Geos, *Draws;
    if (!Root->TryGetArrayField(TEXT("geometries"), Geos) || !Root->TryGetArrayField(TEXT("draws"), Draws) || Draws->IsEmpty()) return Fail(TEXT("Missing geometries/draws"));
    for (int32 I=0; I<Geos->Num(); ++I) {
        const auto G=(*Geos)[I]->AsObject();
        if (!G) return Fail(TEXT("Invalid geometry"));
        double Base;
        if (!G->TryGetNumberField(TEXT("baseGeometry"), Base) || Base != FMath::FloorToDouble(Base) || Base < -1 || Base >= I) return Fail(TEXT("baseGeometry must refer to an earlier geometry"));
        const TArray<TSharedPtr<FJsonValue>> *P,*N,*UV,*Rows,*Indices;
        if (!G->TryGetArrayField(TEXT("positions"), P) || !G->TryGetArrayField(TEXT("normals"), N) || !G->TryGetArrayField(TEXT("uv"), UV) || !G->TryGetArrayField(TEXT("attributeIndex"), Rows) || !G->TryGetArrayField(TEXT("indices"), Indices)) return Fail(TEXT("Incomplete geometry"));
        if (Base < 0) {
            if (P->Num()%3 || N->Num()!=P->Num() || UV->Num()!=P->Num()/3*2 || Rows->Num()!=P->Num()/3 || Indices->Num()%3) return Fail(TEXT("Geometry array sizes disagree"));
            for (auto V:*Indices) if (V->AsNumber()<0 || V->AsNumber()>=P->Num()/3 || V->AsNumber()!=FMath::FloorToDouble(V->AsNumber())) return Fail(TEXT("Index outside vertex buffer"));
        }
        FString Primitive;
        if (!G->TryGetStringField(TEXT("primitive"), Primitive) || Primitive != TEXT("triangles")) return Fail(TEXT("Only triangle primitives are supported"));
    }
    TSet<FString> FilePaths;
    for (const auto& File:Files) {
        if (File.Path.IsEmpty() || File.Path.StartsWith(TEXT("/")) || File.Path.Contains(TEXT("..")) || File.Path.Contains(TEXT(":")) || File.Path.Contains(TEXT("\\")) || FilePaths.Contains(File.Path)) return Fail(TEXT("Unsafe or duplicate dependency path"));
        FilePaths.Add(File.Path);
    }
    const TSharedPtr<FJsonObject>* Camera;
    if (!Root->TryGetObjectField(TEXT("camera"), Camera)) return Fail(TEXT("Missing camera"));
    for (const TCHAR* Key:{TEXT("position"),TEXT("target")}) { const TArray<TSharedPtr<FJsonValue>>* A; if (!(*Camera)->TryGetArrayField(Key,A) || A->Num()!=3) return Fail(TEXT("Invalid camera vectors")); }
    double Fov, Aspect, Near, Far;
    if (!(*Camera)->TryGetNumberField(TEXT("fov"),Fov) || Fov<=0 || Fov>=179 || !(*Camera)->TryGetNumberField(TEXT("aspect"),Aspect) || Aspect<=0 || !(*Camera)->TryGetNumberField(TEXT("near"),Near) || Near<=0 || !(*Camera)->TryGetNumberField(TEXT("far"),Far) || Far<=Near) return Fail(TEXT("Invalid camera projection"));
    const TSharedPtr<FJsonObject>* Ref;
    if (!Root->TryGetObjectField(TEXT("reference"),Ref)) return Fail(TEXT("Missing reference metadata"));
    TSet<FString> DrawIds;
    for (auto Value:*Draws) {
        auto D=Value->AsObject(); FString Program, Id, Blend, Side;
        if (!D || !D->TryGetStringField(TEXT("id"),Id) || Id.Contains(TEXT("/")) || Id.Contains(TEXT("..")) || DrawIds.Contains(Id)) return Fail(TEXT("Invalid draw id"));
        DrawIds.Add(Id);
        if (!D->TryGetStringField(TEXT("program"),Program) || !(Program==TEXT("particle") || Program==TEXT("surface"))) return Fail(TEXT("Unsupported shader program: ")+Program);
        if (!D->TryGetStringField(TEXT("blend"),Blend) || !(Blend==TEXT("alpha") || Blend==TEXT("premultiplied") || Blend==TEXT("additive"))) return Fail(TEXT("Unsupported blend"));
        if (!D->TryGetStringField(TEXT("side"),Side) || !(Side==TEXT("front") || Side==TEXT("back") || Side==TEXT("double"))) return Fail(TEXT("Unsupported side"));
        const TSharedPtr<FJsonObject>* Tex;
        if (!D->TryGetObjectField(TEXT("textures"),Tex)) return Fail(TEXT("Missing texture bindings"));
        for (auto& Pair:(*Tex)->Values) { auto Path=Pair.Value->AsString(); if (!FindFile(Path) || (Path.EndsWith(TEXT(".rgba32f")) && !FindFile(Path+TEXT(".json")))) return Fail(TEXT("Missing texture: ")+Path); }
        const TArray<TSharedPtr<FJsonValue>>* Samples;
        if (!D->TryGetArrayField(TEXT("samples"),Samples) || Samples->Num()!=FMath::CeilToInt(Seconds*FPS)+1) return Fail(TEXT("Unexpected sample count"));
        for (auto Sample:*Samples) {
            auto S=Sample->AsObject(); double Geometry;
            if (!S || !S->TryGetNumberField(TEXT("geometry"),Geometry) || Geometry<0 || Geometry>=Geos->Num() || Geometry!=FMath::FloorToDouble(Geometry)) return Fail(TEXT("Invalid sample geometry"));
            const TArray<TSharedPtr<FJsonValue>>* Matrix;
            const TSharedPtr<FJsonObject>* Uniforms;
            if (!S->TryGetArrayField(TEXT("matrix"),Matrix) || Matrix->Num()!=16 || !S->TryGetObjectField(TEXT("uniforms"),Uniforms)) return Fail(TEXT("Invalid sample matrix/uniforms"));
            for(auto V:*Matrix) if(!FMath::IsFinite(V->AsNumber())) return Fail(TEXT("Nonfinite matrix"));
            FString Stem=FString::Printf(TEXT("attributes/%s-%d"),*Id,int32(Geometry));
            const auto Bytes=FindFile(Stem+TEXT(".bin")); const auto Info=FindFile(Stem+TEXT(".json"));
            if (!Bytes || !Info) return Fail(TEXT("Missing attributes: ")+Stem);
            FUTF8ToTCHAR Text(reinterpret_cast<const ANSICHAR*>(Info->GetData()),Info->Num()); TSharedPtr<FJsonObject> Meta;
            if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(FString(Text.Length(),Text.Get())),Meta) || !Meta) return Fail(TEXT("Invalid attribute metadata"));
            double W,H;
            if(!Meta->TryGetNumberField(TEXT("width"),W) || !Meta->TryGetNumberField(TEXT("height"),H) || W!=1024 || H<1 || H>16384 || H!=FMath::FloorToDouble(H) || int64(W)*int64(H)*16!=Bytes->Num()) return Fail(TEXT("Attribute byte size mismatch"));
        }
    }
    return true;
}
