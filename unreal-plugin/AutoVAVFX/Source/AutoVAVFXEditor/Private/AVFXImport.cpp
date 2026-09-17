#include "AVFXImport.h"
#include "AVFXAsset.h"
#include "AVFXLayout.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "Modules/ModuleManager.h"
THIRD_PARTY_INCLUDES_START
#include <openssl/sha.h>
THIRD_PARTY_INCLUDES_END

namespace
{
using JObject=TSharedPtr<FJsonObject>;
using JValue=TSharedPtr<FJsonValue>;
using JArray=TArray<JValue>;
uint32 U32(const uint8* P) {return uint32(P[0])|(uint32(P[1])<<8)|(uint32(P[2])<<16)|(uint32(P[3])<<24);}
uint16 U16(const uint8* P) {return uint16(P[0])|(uint16(P[1])<<8);}
JObject Object(const JValue& V) {return V.IsValid() && V->Type==EJson::Object ? V->AsObject():nullptr;}
JObject Obj(const JObject& O,const TCHAR* K) {const JObject* P=nullptr;return O && O->TryGetObjectField(K,P)?*P:nullptr;}
JArray Array(const JObject& O,const TCHAR* K) {const JArray* P=nullptr;return O && O->TryGetArrayField(K,P)?*P:JArray();}
FString Str(const JObject& O,const TCHAR* K) {FString V;if(O)O->TryGetStringField(K,V);return V;}
double Num(const JObject& O,const TCHAR* K,double Default=0) {double V=Default;if(O)O->TryGetNumberField(K,V);return V;}
bool Bool(const JObject& O,const TCHAR* K,bool Default=false) {bool V=Default;if(O)O->TryGetBoolField(K,V);return V;}
bool Finite(const JValue& V,double& Out) {return V && V->TryGetNumber(Out) && FMath::IsFinite(Out);}
bool SafePath(const FString& Name)
{
    if(Name.IsEmpty()||Name.StartsWith(TEXT("/"))||Name.Contains(TEXT("\\"))||Name.Contains(TEXT(":")))return false;
    TArray<FString> Parts;Name.ParseIntoArray(Parts,TEXT("/"),false);
    for(const auto& P:Parts)if(P.IsEmpty()||P==TEXT(".")||P==TEXT(".."))return false;
    return true;
}
FString Hash(TConstArrayView<uint8> Data)
{
    uint8 Digest[SHA256_DIGEST_LENGTH];
    if(!SHA256(Data.GetData(),Data.Num(),Digest))return FString();
    return BytesToHex(Digest,SHA256_DIGEST_LENGTH).ToLower();
}
struct FReader
{
    FString Error;
    TMap<FString,TArray<uint8>> Files;
    TMap<FString,int32> MeshIds;
    TMap<FString,UTexture2D*> Textures;
    UAVFXAsset* Asset=nullptr;
    bool Fail(const FString& Message) {if(Error.IsEmpty())Error=Message;return false;}
    JObject Json(TConstArrayView<uint8> Data)
    {
        const FUTF8ToTCHAR Text(reinterpret_cast<const ANSICHAR*>(Data.GetData()),Data.Num());
        JObject Result;
        if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(FString(Text.Length(),Text.Get())),Result))Fail(TEXT("Invalid JSON"));
        return Result;
    }
    JObject JsonFile(const FString& Path)
    {
        const auto* Data=Files.Find(Path);
        if(!Data){Fail(TEXT("Missing file: ")+Path);return nullptr;}
        return Json(*Data);
    }
    bool Archive(TConstArrayView<uint8> Bytes)
    {
        if(Bytes.Num()>256*1024*1024)return Fail(TEXT("Archive exceeds 256 MiB"));
        int64 Offset=0;
        while(Offset+30<=Bytes.Num() && U32(Bytes.GetData()+Offset)==0x04034b50)
        {
            const uint8* P=Bytes.GetData()+Offset;
            const int64 Size=U32(P+22),Length=U16(P+26),Start=Offset+30+Length+U16(P+28);
            if(U16(P+6)!=0||U16(P+8)!=0||U32(P+18)!=Size||Start+Size>Bytes.Num())return Fail(TEXT("Only bounded STORE ZIP entries are supported"));
            const FUTF8ToTCHAR Text(reinterpret_cast<const ANSICHAR*>(P+30),Length);
            const FString Name(Text.Length(),Text.Get());
            if(!SafePath(Name)||Files.Contains(Name)||Files.Num()>=4096)return Fail(TEXT("Invalid/duplicate path or entry budget"));
            TArray<uint8> Data;Data.Append(Bytes.GetData()+Start,Size);Files.Add(Name,MoveTemp(Data));
            Offset=Start+Size;
        }
        if(Offset+4>Bytes.Num()||U32(Bytes.GetData()+Offset)!=0x02014b50)return Fail(TEXT("Missing ZIP directory"));
        const auto Manifest=JsonFile(TEXT("avfx.json"));
        if(!Manifest||Str(Manifest,TEXT("version"))!=TEXT("avfx/0.1"))return Fail(TEXT("Unsupported AVFX version"));
        TSet<FString> Verified;Verified.Add(TEXT("avfx.json"));
        for(const auto& Item:Array(Manifest,TEXT("files")))
        {
            const auto Entry=Object(Item);const FString Path=Str(Entry,TEXT("path"));const auto* Data=Files.Find(Path);
            if(!Data||Verified.Contains(Path)||Num(Entry,TEXT("bytes"),-1)!=Data->Num()||Hash(*Data)!=Str(Entry,TEXT("sha256")))return Fail(TEXT("Hash/size mismatch or duplicate inventory: ")+Path);
            Verified.Add(Path);
        }
        if(Verified.Num()!=Files.Num())return Fail(TEXT("Unlisted archive files"));
        const auto Coords=Obj(Manifest,TEXT("coordinates"));
        if(Str(Coords,TEXT("up"))!=TEXT("+Y")||Str(Coords,TEXT("units"))!=TEXT("meters")||Str(Coords,TEXT("handedness"))!=TEXT("right"))return Fail(TEXT("Unsupported coordinate system"));
        const auto Programs=Obj(Manifest,TEXT("programs"));
        if(!Programs)return Fail(TEXT("Missing shader ABI"));
        for(const auto& Pair:Programs->Values)
        {
            FAVFXLayout Layout;if(!GetAVFXLayout(Pair.Key,Layout))return Fail(TEXT("Unsupported program: ")+Pair.Key);
            const auto Program=Object(Pair.Value);
            const auto* Vertex=Files.Find(Str(Program,TEXT("vertex")));const auto* Fragment=Files.Find(Str(Program,TEXT("fragment")));
            if(!Vertex||!Fragment||Hash(*Vertex)!=Layout.VertexHash||Hash(*Fragment)!=Layout.FragmentHash)return Fail(TEXT("Shader revision mismatch: ")+Pair.Key);
        }
        return true;
    }
    bool Accessor(const JObject& Gltf,TConstArrayView<uint8> Bin,int32 Index,int32 Width,bool bIndex,TArray<double>& Values)
    {
        const auto Accessors=Array(Gltf,TEXT("accessors")),Views=Array(Gltf,TEXT("bufferViews"));
        if(!Accessors.IsValidIndex(Index))return Fail(TEXT("Missing accessor"));
        const auto A=Object(Accessors[Index]);const int32 VI=Num(A,TEXT("bufferView"),-1);
        if(!A||!Views.IsValidIndex(VI)||A->HasField(TEXT("sparse"))||Bool(A,TEXT("normalized")))return Fail(TEXT("Unsupported accessor"));
        const auto V=Object(Views[VI]);
        const int64 Count=Num(A,TEXT("count")),Offset=Num(V,TEXT("byteOffset"))+Num(A,TEXT("byteOffset")),Stride=Num(V,TEXT("byteStride"),Width*4);
        const FString Type=Width==1?TEXT("SCALAR"):FString::Printf(TEXT("VEC%d"),Width);
        if(Count<1||Count>6000000||Stride<Width*4||Offset<0||Offset+(Count-1)*Stride+Width*4>Bin.Num()||Offset+(Count-1)*Stride+Width*4>Num(V,TEXT("byteOffset"))+Num(V,TEXT("byteLength"))||Num(V,TEXT("buffer"),-1)!=0||Num(A,TEXT("componentType"))!=(bIndex?5125:5126)||Str(A,TEXT("type"))!=Type)return Fail(TEXT("Invalid accessor bounds/type"));
        Values.Reserve(Count*Width);
        for(int64 I=0;I<Count;I++)for(int32 K=0;K<Width;K++)
        {
            const uint32 Bits=U32(Bin.GetData()+Offset+I*Stride+K*4);float F;FMemory::Memcpy(&F,&Bits,4);
            const double Number=bIndex?double(Bits):double(F);
            if(!FMath::IsFinite(Number))return Fail(TEXT("Nonfinite mesh data"));Values.Add(Number);
        }
        return true;
    }
    int32 Mesh(const FString& Path)
    {
        if(const auto* Id=MeshIds.Find(Path))return *Id;
        const auto* Data=Files.Find(Path);
        if(!Data||Data->Num()<28){Fail(TEXT("Missing/truncated GLB"));return -1;}
        const uint8* P=Data->GetData();const int64 JSize=U32(P+12),BHead=20+JSize;
        if(U32(P)!=0x46546c67||U32(P+4)!=2||U32(P+8)!=Data->Num()||U32(P+16)!=0x4e4f534a||BHead+8>Data->Num()||U32(P+BHead+4)!=0x004e4942||BHead+8+U32(P+BHead)!=Data->Num()){Fail(TEXT("Invalid GLB chunks"));return -1;}
        const auto Gltf=Json(MakeArrayView(P+20,int32(JSize)));const auto Meshes=Array(Gltf,TEXT("meshes"));
        const auto Primitives=Meshes.Num()==1?Array(Object(Meshes[0]),TEXT("primitives")):JArray();
        const auto Prim=Primitives.Num()==1?Object(Primitives[0]):nullptr;const auto Attr=Obj(Prim,TEXT("attributes"));
        if(!Attr||Num(Prim,TEXT("mode"),4)!=4){Fail(TEXT("Expected one triangle primitive"));return -1;}
        for(const auto& Pair:Attr->Values)if(Pair.Key!=TEXT("POSITION")&&Pair.Key!=TEXT("NORMAL")&&Pair.Key!=TEXT("TEXCOORD_0")){Fail(TEXT("Unsupported custom mesh attribute"));return -1;}
        TArray<double> Pos,Normal,UV,Indices;const auto Bin=MakeArrayView(P+BHead+8,int32(U32(P+BHead)));
        if(!Accessor(Gltf,Bin,Num(Attr,TEXT("POSITION"),-1),3,false,Pos))return -1;
        if(Attr->HasField(TEXT("NORMAL"))&&!Accessor(Gltf,Bin,Num(Attr,TEXT("NORMAL")),3,false,Normal))return -1;
        if(Attr->HasField(TEXT("TEXCOORD_0"))&&!Accessor(Gltf,Bin,Num(Attr,TEXT("TEXCOORD_0")),2,false,UV))return -1;
        if(Prim->HasField(TEXT("indices"))&&!Accessor(Gltf,Bin,Num(Prim,TEXT("indices")),1,true,Indices))return -1;
        const int32 Count=Pos.Num()/3;
        if(Count>1000000||(!Normal.IsEmpty()&&Normal.Num()!=Pos.Num())||(!UV.IsEmpty()&&UV.Num()!=Count*2)){Fail(TEXT("Invalid vertex counts"));return -1;}
        FAVFXMesh Result;
        for(int32 I=0;I<Count;I++)
        {
            Result.Vertices.Add(FVector4(Pos[I*3],Pos[I*3+1],Pos[I*3+2],1));
            Result.Vertices.Add(Normal.IsEmpty()?FVector4(0,0,1,0):FVector4(Normal[I*3],Normal[I*3+1],Normal[I*3+2],0));
            Result.Vertices.Add(UV.IsEmpty()?FVector4(0,0,0,0):FVector4(UV[I*2],UV[I*2+1],0,0));
        }
        if(!Prim->HasField(TEXT("indices")))for(int32 I=0;I<Count;I++)Indices.Add(I);
        if(Indices.Num()%3){Fail(TEXT("Non-triangle indices"));return -1;}
        for(double I:Indices){if(I<0||I>=Count||I!=FMath::FloorToDouble(I)){Fail(TEXT("Index out of bounds"));return -1;}Result.Indices.Add(I);}
        const int32 Id=Asset->Meshes.Add(MoveTemp(Result));MeshIds.Add(Path,Id);return Id;
    }
    bool Uniform(TArray<FVector4>& Dest,const FAVFXField& Field,const JValue& Value)
    {
        if(Field.Components>4)return Fail(TEXT("Authored matrix uniforms unsupported"));
        const JArray* Rows=nullptr;
        if(Field.Count>1&&(!Value||!Value->TryGetArray(Rows)||Rows->Num()!=Field.Count))return Fail(TEXT("Invalid uniform array"));
        for(int32 I=0;I<Field.Count;I++)
        {
            const auto Row=Rows?(*Rows)[I]:Value;FVector4 V(0,0,0,0);
            if(Field.Components==1){if(!Finite(Row,V.X))return Fail(TEXT("Invalid numeric uniform"));}
            else {const JArray* Items=nullptr;if(!Row||!Row->TryGetArray(Items)||Items->Num()!=Field.Components)return Fail(TEXT("Invalid vector uniform"));for(int32 K=0;K<Field.Components;K++)if(!Finite((*Items)[K],V[K]))return Fail(TEXT("Invalid vector component"));}
            Dest[Field.Slot+I]=V;
        }
        return true;
    }
    UTexture2D* Texture(const JObject& Binding)
    {
        const FString Path=Str(Binding,TEXT("path"));
        const FString Key=Path+FString::FromInt(Bool(Binding,TEXT("flipY")))+Str(Binding,TEXT("wrapS"))+Str(Binding,TEXT("wrapT"))+FString::FromInt(Num(Binding,TEXT("minFilter")))+FString::FromInt(Num(Binding,TEXT("magFilter")))+FString::FromInt(Bool(Binding,TEXT("generateMipmaps")));
        if(auto* Found=Textures.Find(Key))return *Found;
        const auto* Data=Files.Find(Path);
        if(!Data||!Path.EndsWith(TEXT(".png"))||Str(Binding,TEXT("colorSpace"))!=TEXT("linear")){Fail(TEXT("First pass requires linear PNG textures; data/lattice textures not supported"));return nullptr;}
        auto& Module=FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
        auto Image=Module.CreateImageWrapper(EImageFormat::PNG);
        TArray64<uint8> Pixels;
        if(!Image->SetCompressed(Data->GetData(),Data->Num())||Image->GetWidth()<1||Image->GetHeight()<1||Image->GetWidth()>4096||Image->GetHeight()>4096||!Image->GetRaw(ERGBFormat::BGRA,8,Pixels)){Fail(TEXT("Invalid/oversized PNG"));return nullptr;}
        const int32 Width=Image->GetWidth(),Height=Image->GetHeight();
        if(Bool(Binding,TEXT("flipY")))for(int32 Y=0;Y<Height/2;Y++)for(int32 X=0;X<Width*4;X++)Swap(Pixels[Y*Width*4+X],Pixels[(Height-1-Y)*Width*4+X]);
        auto* T=NewObject<UTexture2D>(Asset,MakeUniqueObjectName(Asset,UTexture2D::StaticClass(),TEXT("AVFXTexture")),RF_Transactional);
        T->SRGB=false;T->CompressionSettings=TC_VectorDisplacementmap;
        T->MipGenSettings=Bool(Binding,TEXT("generateMipmaps"))?TMGS_FromTextureGroup:TMGS_NoMipmaps;
        T->Filter=Num(Binding,TEXT("magFilter"))==1003?TF_Nearest:Num(Binding,TEXT("minFilter"))==1008?TF_Trilinear:TF_Bilinear;
        auto Address=[](const FString& V){return V==TEXT("repeat")?TA_Wrap:V==TEXT("mirrored-repeat")?TA_Mirror:TA_Clamp;};
        T->AddressX=Address(Str(Binding,TEXT("wrapS")));T->AddressY=Address(Str(Binding,TEXT("wrapT")));
        T->Source.Init(Width,Height,1,1,TSF_BGRA8,Pixels.GetData());T->UpdateResource();Textures.Add(Key,T);return T;
    }
    bool Build()
    {
        const auto Manifest=JsonFile(TEXT("avfx.json"));
        Asset->EffectName=Str(Manifest,TEXT("name"));Asset->Duration=Num(Manifest,TEXT("duration"));
        if(!FMath::IsFinite(Asset->Duration)||Asset->Duration<=0||Asset->Duration>12)return Fail(TEXT("Invalid duration"));
        const auto Timeline=JsonFile(Str(Manifest,TEXT("timeline")));const auto Timelines=Obj(Timeline,TEXT("draws"));
        if(!Timelines||Str(Timeline,TEXT("interpolation"))!=TEXT("step")||Str(Timeline,TEXT("matrixLayout"))!=TEXT("column-major")||Str(Timeline,TEXT("timeDomain"))!=TEXT("absolute-seconds"))return Fail(TEXT("Unsupported timeline"));
        const auto Programs=Obj(Manifest,TEXT("programs"));
        TSet<FString> Ids;
        for(const auto& Item:Array(Manifest,TEXT("layers")))
        {
            const auto Layer=JsonFile(Str(Object(Item),TEXT("path")));
            const FString Kind=Str(Layer,TEXT("kind"));
            const TSet<FString> Kinds={TEXT("particles"),TEXT("ring"),TEXT("shell"),TEXT("trail"),TEXT("beam"),TEXT("sprite"),TEXT("decal")};
            if(!Kinds.Contains(Kind))return Fail(TEXT("Unsupported layer kind"));
            const double Start=Num(Layer,TEXT("start"),-1),End=Num(Layer,TEXT("end"),-1);
            if(!FMath::IsFinite(Start)||!FMath::IsFinite(End)||Start<0||End<=Start||End>Asset->Duration)return Fail(TEXT("Invalid layer window"));
            for(const auto& DrawValue:Array(Layer,TEXT("draws")))
            {
                const auto Descriptor=Object(DrawValue),Definitions=Obj(Descriptor,TEXT("uniforms")),State=Obj(Descriptor,TEXT("renderState"));
                FAVFXDraw Draw;Draw.Id=Str(Descriptor,TEXT("id"));Draw.Program=Str(Descriptor,TEXT("program"));Draw.Blend=Str(State,TEXT("blend"));Draw.Order=Num(State,TEXT("renderOrder"));Draw.Start=Start;Draw.End=End;
                FAVFXLayout Layout;if(!Definitions||!GetAVFXLayout(Draw.Program,Layout)||Draw.Id.IsEmpty()||Ids.Contains(Draw.Id)||Ids.Num()>=256)return Fail(TEXT("Missing/unsupported draw ABI"));Ids.Add(Draw.Id);
                if(!Programs||!Programs->HasField(Draw.Program))return Fail(TEXT("Missing program fingerprint"));
                if((Draw.Blend!=TEXT("alpha")&&Draw.Blend!=TEXT("additive")&&Draw.Blend!=TEXT("premultiplied"))||Bool(State,TEXT("depthWrite"))||!Bool(State,TEXT("depthTest"),true)||Str(State,TEXT("side"))!=TEXT("double"))return Fail(TEXT("Unsupported blend/depth/cull state"));
                TArray<FVector4> Defaults;Defaults.Init(FVector4(0,0,0,0),Layout.Slots);TSet<FString> Constants;
                for(const auto& Pair:Definitions->Values)
                {
                    const auto Def=Object(Pair.Value);const auto Binding=Obj(Def,TEXT("binding"));
                    if(Str(Def,TEXT("storage"))==TEXT("constant"))Constants.Add(Pair.Key);
                    if(Def&&Def->HasField(TEXT("value"))){const auto* Field=Layout.Fields.Find(Pair.Key);if(!Field||!Uniform(Defaults,*Field,Def->Values[TEXT("value")]))return Fail(TEXT("Invalid uniform default: ")+Pair.Key);}
                    if(Str(Binding,TEXT("source"))==TEXT("bundle")){auto* T=Texture(Binding);if(!T)return false;Draw.Textures.Add(FName(Pair.Key),T);}
                }
                if(Draw.Program==TEXT("particle"))
                {
                    const auto Instances=JsonFile(Str(Descriptor,TEXT("instances"))),Attributes=Obj(Instances,TEXT("attributes"));
                    const int32 Count=Num(Instances,TEXT("count"));if(!Attributes||Count<1||Count>60000)return Fail(TEXT("Invalid instance count"));
                    Draw.Instances.Init(FVector4(0,0,0,0),Count*8);
                    const TCHAR* Names[]={TEXT("aSeed"),TEXT("aExtra"),TEXT("aExtra2"),TEXT("aIndex"),TEXT("aSrcPos"),TEXT("aSrcDir"),TEXT("aEvent"),TEXT("aSub")};const int32 Widths[]={4,4,4,1,3,3,4,1};
                    for(int32 K=0;K<8;K++)
                    {
                        const auto Attr=Obj(Attributes,Names[K]);const auto Values=Array(Attr,TEXT("values"));
                        if(Num(Attr,TEXT("count"))!=Count||Num(Attr,TEXT("itemSize"))!=Widths[K]||Values.Num()!=Count*Widths[K])return Fail(TEXT("Invalid particle attributes"));
                        for(int32 I=0;I<Count;I++)for(int32 J=0;J<Widths[K];J++)if(!Finite(Values[I*Widths[K]+J],Draw.Instances[I*8+K][J]))return Fail(TEXT("Invalid particle seed"));
                    }
                }
                else Draw.Instances.Init(FVector4(0,0,0,0),8);
                const auto Samples=Array(Timelines,*Draw.Id);double Last=-1;
                if(Samples.IsEmpty()||Samples.Num()>2048)return Fail(TEXT("Invalid timeline length"));
                for(const auto& V:Samples)
                {
                    const auto S=Object(V);FAVFXSample Sample;Sample.Time=Num(S,TEXT("time"),-1);Sample.bVisible=Bool(S,TEXT("visible"));
                    if(!FMath::IsFinite(Sample.Time)||Sample.Time<=Last||Sample.Time<0||Sample.Time>Asset->Duration)return Fail(TEXT("Invalid sample times"));Last=Sample.Time;
                    const auto Matrix=Array(S,TEXT("matrix"));if(Matrix.Num()!=16)return Fail(TEXT("Invalid matrix"));
                    for(const auto& Component:Matrix){double N;if(!Finite(Component,N))return Fail(TEXT("Invalid matrix component"));Sample.Matrix.Add(N);}
                    Sample.Mesh=Mesh(Str(S,TEXT("mesh")));if(Sample.Mesh<0)return false;
                    Sample.Uniforms=Defaults;const auto Values=Obj(S,TEXT("uniforms"));if(!Values)return Fail(TEXT("Missing sample uniforms"));
                    for(const auto& Pair:Values->Values)if(!Constants.Contains(Pair.Key)){const auto* F=Layout.Fields.Find(Pair.Key);if(!F||!Uniform(Sample.Uniforms,*F,Pair.Value))return Fail(TEXT("Invalid timeline uniform: ")+Pair.Key);}
                    Draw.Samples.Add(MoveTemp(Sample));
                }
                if(Draw.Samples[0].Time!=0)return Fail(TEXT("Timeline must start at zero"));
                Asset->Draws.Add(MoveTemp(Draw));
            }
        }
        Asset->ImportNotes=TEXT("Experimental particle/surface renderer. No per-particle sorting, motion vectors, shadow casting or automatic source post-processing. Editor preview needs Realtime. Screen percentage must be 100% for this pass.");
        return !Asset->Draws.IsEmpty()&&Error.IsEmpty();
    }
};
}

UAVFXAsset* ImportAVFX(TConstArrayView<uint8> Bytes,UObject* Parent,FName Name,EObjectFlags Flags,FString& Error)
{
    if(!Name.IsNone() && StaticFindObjectFast(UObject::StaticClass(),Parent,Name))
    {Error=TEXT("An asset with this name already exists. Import under a new name; reimport is not implemented yet.");return nullptr;}
    FReader Reader;
    if(!Reader.Archive(Bytes)){Error=Reader.Error;return nullptr;}
    // Build under a transient outer until every draw has validated.
    Reader.Asset=NewObject<UAVFXAsset>(GetTransientPackage());
    if(!Reader.Build()){Error=Reader.Error.IsEmpty()?TEXT("No supported draws"):Reader.Error;return nullptr;}
    if(!Reader.Asset->Rename(*Name.ToString(),Parent,REN_DontCreateRedirectors|REN_NonTransactional))
    {Error=TEXT("Could not assign imported asset name");return nullptr;}
    Reader.Asset->SetFlags(Flags);Reader.Asset->MarkPackageDirty();
    return Reader.Asset;
}
