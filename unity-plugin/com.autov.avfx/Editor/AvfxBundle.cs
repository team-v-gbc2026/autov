using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Deliberately independent of Unity: archive/GLB checks can run without an editor license.
public sealed class AvfxBundle {
    public const int MaxBytes = 256 * 1024 * 1024;
    public readonly Dictionary<string, byte[]> Files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
    public JObject Manifest, Timeline;
    public readonly List<JObject> Layers = new List<JObject>();
    static readonly Dictionary<string,string[]> Versions = new Dictionary<string,string[]> {
        {"particle", new[]{"a031010eed1957f7422b613c9d3ba8254be22d61a463d2a7a8fd71f3b3cd8082", "df5a63375111d8ec5b234a9ad2f38fbcf10b21e8ba742dbcf77a2304880d26eb"}},
        {"surface", new[]{"1f9030d68f3719121fac50a8c5cafeeb7bd0efe9fad36793c0afa0e169c99bca", "31a2e693e02db0d3583d1ab97007fc4d9ced67bee74e4a8cadd4b8455f887efe"}}
    };
    public static void Require(bool ok, string message) { if(!ok) throw new InvalidDataException("AVFX: " + message); }
    public static bool SafePath(string path) { return !string.IsNullOrEmpty(path) && path.All(c=>c>='a' && c<='z' || c>='A' && c<='Z' || c>='0' && c<='9' || "_./-".Contains(c)) && path.Split('/').All(p=>p.Length>0 && p!="." && p!=".."); }
    public static string Hash(byte[] bytes) { using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    static uint U32(byte[] b,int p) { Require(p>=0 && p<=b.Length-4,"truncated binary"); return BitConverter.ToUInt32(b,p); }
    static int U16(byte[] b,int p) { Require(p>=0 && p<=b.Length-2,"truncated binary"); return BitConverter.ToUInt16(b,p); }
    public static JObject Json(byte[] bytes) {
        using(var reader=new JsonTextReader(new StringReader(new UTF8Encoding(false,true).GetString(bytes))) { MaxDepth=64, DateParseHandling=DateParseHandling.None }) {
            var obj=JObject.Load(reader,new JsonLoadSettings { DuplicatePropertyNameHandling=DuplicatePropertyNameHandling.Error });
            Require(!reader.Read(),"trailing JSON content"); return obj;
        }
    }
    public byte[] Get(string path) { Require(SafePath(path) && Files.ContainsKey(path),"missing or unsafe path: "+path); return Files[path]; }
    public JObject Read(string path) { return Json(Get(path)); }
    public static float Number(JToken value) {
        Require(value!=null && (value.Type==JTokenType.Float || value.Type==JTokenType.Integer),"expected number");
        float n=(float)value; Require(!float.IsNaN(n) && !float.IsInfinity(n),"non-finite number"); return n;
    }
    public static float[] Values(JToken value) { return value is JArray array ? array.SelectMany(Values).ToArray() : new[]{Number(value)}; }
    public static AvfxBundle Load(string path) {
        Require(new FileInfo(path).Length<=MaxBytes,"bundle exceeds 256 MiB"); return Parse(File.ReadAllBytes(path));
    }
    public static AvfxBundle Parse(byte[] bytes) {
        Require(bytes.Length<=MaxBytes && bytes.Length>=22,"invalid archive size");
        var bundle=new AvfxBundle(); var offsets=new Dictionary<string,int>(); int offset=0;
        while(U32(bytes,offset)==0x04034b50) {
            Require(U16(bytes,offset+6)==0 && U16(bytes,offset+8)==0,"only unencrypted STORE ZIP supported");
            uint size=U32(bytes,offset+22); int length=U16(bytes,offset+26), extra=U16(bytes,offset+28);
            long start=(long)offset+30+length+extra;
            Require(size==U32(bytes,offset+18) && start+size<=bytes.Length,"truncated ZIP payload");
            string name=Encoding.UTF8.GetString(bytes,offset+30,length);
            Require(SafePath(name) && !bundle.Files.ContainsKey(name) && bundle.Files.Count<4096,"unsafe/duplicate ZIP entry or too many files");
            var data=new byte[(int)size]; Buffer.BlockCopy(bytes,(int)start,data,0,data.Length);
            Require(Crc(data)==U32(bytes,offset+14),"ZIP CRC mismatch: "+name);
            bundle.Files.Add(name,data); offsets.Add(name,offset); offset=(int)(start+size);
        }
        int directory=offset, entries=0; var seen=new HashSet<string>();
        while(U32(bytes,offset)==0x02014b50) {
            int length=U16(bytes,offset+28), extra=U16(bytes,offset+30), comment=U16(bytes,offset+32);
            Require((long)offset+46+length+extra+comment<=bytes.Length,"truncated ZIP directory");
            var name=Encoding.UTF8.GetString(bytes,offset+46,length);
            Require(offsets.ContainsKey(name) && seen.Add(name),"conflicting ZIP directory");
            int local=offsets[name];
            Require(U16(bytes,offset+8)==0 && U16(bytes,offset+10)==0 && U32(bytes,offset+42)==local && U32(bytes,offset+20)==bundle.Files[name].Length && U32(bytes,offset+24)==bundle.Files[name].Length && U32(bytes,offset+16)==U32(bytes,local+14),"conflicting ZIP entry metadata");
            entries++; offset+=46+length+extra+comment;
        }
        Require(U32(bytes,offset)==0x06054b50 && offset+22==bytes.Length && U16(bytes,offset+4)==0 && U16(bytes,offset+6)==0 && U16(bytes,offset+8)==entries && U16(bytes,offset+10)==entries && entries==bundle.Files.Count && U32(bytes,offset+12)==offset-directory && U32(bytes,offset+16)==directory,"invalid ZIP end record");
        bundle.Manifest=bundle.Read("avfx.json"); var m=bundle.Manifest;
        Require((string)m["version"]=="avfx/0.1" && Number(m["duration"])>0,"unsupported format/duration");
        Require((string)m["coordinates"]?["handedness"]=="right" && (string)m["coordinates"]?["up"]=="+Y" && (string)m["coordinates"]?["layerForward"]=="+Z" && (string)m["coordinates"]?["units"]=="meters" && (string)m["coordinates"]?["uvOrigin"]=="bottom-left","unsupported coordinates");
        seen=new HashSet<string>{"avfx.json"};
        Require(m["files"] is JArray && m["layers"] is JArray && m["programs"] is JObject,"missing inventory");
        foreach(var item in (JArray)m["files"]) {
            var path=(string)item["path"]; var data=bundle.Get(path);
            Require(seen.Add(path) && (long)item["bytes"]==data.Length && (string)item["sha256"]==Hash(data),"inventory hash/size mismatch: "+path);
        }
        Require(seen.Count==bundle.Files.Count,"unlisted archive entries");
        foreach(var program in ((JObject)m["programs"]).Properties()) {
            Require(Versions.ContainsKey(program.Name),"unsupported shader program: "+program.Name);
            var hashes=Versions[program.Name];
            Require(Hash(bundle.Get((string)program.Value["vertex"]))==hashes[0] && Hash(bundle.Get((string)program.Value["fragment"]))==hashes[1],"unsupported shader revision: "+program.Name);
        }
        bundle.Timeline=bundle.Read((string)m["timeline"]);
        Require((string)bundle.Timeline["interpolation"]=="step" && (string)bundle.Timeline["matrixLayout"]=="column-major" && (string)bundle.Timeline["timeDomain"]=="absolute-seconds" && bundle.Timeline["draws"] is JObject,"unsupported timeline");
        var drawIds=new HashSet<string>();
        foreach(var entry in (JArray)m["layers"]) {
            var layer=bundle.Read((string)entry["path"]);
            Require(new[]{"particles","ring","shell","trail","beam","sprite","decal"}.Contains((string)layer["kind"]),"unsupported layer kind");
            Require(Number(layer["start"])>=0 && Number(layer["end"])>Number(layer["start"]),"invalid layer interval");
            foreach(var draw in (JArray)layer["draws"]) {
                string id=(string)draw["id"], program=(string)draw["program"];
                Require(id!=null && drawIds.Add(id) && Versions.ContainsKey(program) && m["programs"][program]!=null,"invalid draw/program");
                var samples=bundle.Timeline["draws"][id] as JArray;
                Require(samples!=null && samples.Count>0 && Number(samples[0]["time"])==0,"missing initial timeline state");
                bundle.ValidateUniforms(program,(JObject)draw["uniforms"],samples);
                float previous=-1;
                foreach(var sample in samples) {
                    float time=Number(sample["time"]); Require(time>previous && time<=Number(m["duration"]),"invalid timeline order"); previous=time;
                    Require(Values(sample["matrix"]).Length==16 && sample["uniforms"] is JObject && sample["visible"]?.Type==JTokenType.Boolean,"invalid sample");
                    bundle.Get((string)sample["mesh"]);
                }
                bundle.Get((string)draw["mesh"]);
                if(draw["instances"]?.Type==JTokenType.String) bundle.Get((string)draw["instances"]);
            }
            bundle.Layers.Add(layer);
        }
        Require(drawIds.Count>0 && ((JObject)bundle.Timeline["draws"]).Count==drawIds.Count,"timeline draw mismatch");
        return bundle;
    }
    static uint Crc(byte[] data) { uint crc=0xffffffff; foreach(byte b in data) { crc^=b; for(int i=0;i<8;i++) crc=(crc>>1)^((crc&1)!=0?0xedb88320:0); } return crc^0xffffffff; }

    void ValidateUniforms(string program,JObject definitions,JArray samples) {
        var entry=Manifest["programs"][program];
        var source=Encoding.UTF8.GetString(Get((string)entry["vertex"]))+"\n"+Encoding.UTF8.GetString(Get((string)entry["fragment"]));
        source=System.Text.RegularExpressions.Regex.Replace(source,@"//[^\n]*|/\*[\s\S]*?\*/","");
        var expected=new Dictionary<string,Tuple<string,int>>();
        foreach(System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(source,@"\buniform\s+(\w+)\s+([^;]+);")) foreach(string item in match.Groups[2].Value.Split(',')) {
            var name=System.Text.RegularExpressions.Regex.Match(item.Trim(),@"^(\w+)(?:\[(\d+)\])?$"); Require(name.Success,"invalid trusted ABI");
            expected[name.Groups[1].Value]=Tuple.Create(match.Groups[1].Value,name.Groups[2].Success?int.Parse(name.Groups[2].Value):0);
        }
        Require(definitions!=null && definitions.Count==expected.Count,"uniform ABI mismatch");
        foreach(var def in definitions.Properties()) {
            Require(expected.TryGetValue(def.Name,out var info) && info.Item1==(string)def.Value["type"] && info.Item2==((int?)def.Value["size"]??0),"uniform ABI mismatch: "+def.Name);
            var binding=def.Value["binding"];
            if(info.Item1=="sampler2D") { Require(binding is JObject,"missing texture binding"); if((string)binding["source"]=="bundle") Get((string)binding["path"]); continue; }
            if(binding!=null) {
                var semantics=new Dictionary<string,string>{{"uTime","layer-local-seconds"},{"uNear","camera-near"},{"uFar","camera-far"},{"uResolution","viewport-size-pixels"},{"uSmokeRight","camera-right-world"},{"uSmokeUp","camera-up-world"},{"uSmokeForward","camera-back-world"}};
                Require((string)binding["source"]=="engine" && semantics.TryGetValue(def.Name,out var semantic) && (string)binding["semantic"]==semantic,"unsupported engine binding"); continue;
            }
            int components=info.Item1=="float" || info.Item1=="int"?1:info.Item1=="vec2"?2:info.Item1=="vec3"?3:info.Item1=="vec4"?4:0;
            Require(components>0 && info.Item2<=64,"unsupported uniform type");
            Require(new[]{"constant","uniform"}.Contains((string)def.Value["storage"]),"invalid uniform storage");
            foreach(var sample in samples) {
                var value=(string)def.Value["storage"]=="constant"?def.Value["value"]:sample["uniforms"]?[def.Name];
                var values=Values(value); Require(values.Length==components*Math.Max(1,info.Item2),"uniform width mismatch: "+def.Name);
                if(info.Item1=="int") Require(values.All(v=>v==Math.Floor(v)),"fractional integer uniform");
            }
        }
    }
    public sealed class MeshData { public float[] Positions, Normals, UV; public int[] Indices; public int Count => Positions.Length/3; }
    public static MeshData Mesh(byte[] bytes) {
        Require(U32(bytes,0)==0x46546c67 && U32(bytes,4)==2 && U32(bytes,8)==bytes.Length,"invalid GLB");
        int length=checked((int)U32(bytes,12)), bin=checked(20+length);
        Require(U32(bytes,16)==0x4e4f534a && U32(bytes,bin+4)==0x004e4942 && (long)bin+8+U32(bytes,bin)==bytes.Length,"invalid GLB chunks");
        var json=new byte[length]; Buffer.BlockCopy(bytes,20,json,0,length); var gltf=Json(json); int start=bin+8;
        Require(gltf["meshes"] is JArray meshes && meshes.Count==1 && ((JArray)gltf["meshes"][0]["primitives"]).Count==1,"expected one mesh primitive");
        var primitive=gltf["meshes"][0]["primitives"][0]; Require((int?)primitive["mode"]==4,"only triangles supported");
        Func<int,int,int,float[]> read=(index,components,type)=> {
            var a=gltf["accessors"][index]; var view=gltf["bufferViews"][(int)a["bufferView"]];
            Require((int)a["componentType"]==type && (string)a["type"]==new[]{"","SCALAR","VEC2","VEC3","VEC4"}[components] && a["sparse"]==null && (bool?)a["normalized"]!=true,"unsupported GLB accessor");
            int count=(int)a["count"], offset=(int?)view["byteOffset"]??0, local=(int?)a["byteOffset"]??0, stride=(int?)view["byteStride"]??components*4;
            Require(count>0 && count<=6000000 && offset>=0 && local>=0 && stride>=components*4 && (int)view["buffer"]==0,"invalid accessor");
            long end=(long)local+(long)(count-1)*stride+components*4;
            Require(end<=(int)view["byteLength"] && (long)start+offset+end<=bytes.Length,"GLB buffer overrun");
            var values=new float[checked(count*components)];
            for(int i=0;i<count;i++) for(int k=0;k<components;k++) { int pos=checked(start+offset+local+i*stride+k*4); float v=type==5126?BitConverter.ToSingle(bytes,pos):U32(bytes,pos); Require(!float.IsNaN(v) && !float.IsInfinity(v),"nonfinite vertex"); values[i*components+k]=v; }
            return values;
        };
        var attrs=(JObject)primitive["attributes"];
        Require(attrs.Properties().All(p=>new[]{"POSITION","NORMAL","TEXCOORD_0"}.Contains(p.Name)),"unsupported mesh attribute");
        var mesh=new MeshData { Positions=read((int)attrs["POSITION"],3,5126) };
        Require(mesh.Count<=1000000,"mesh vertex budget exceeded");
        mesh.Normals=attrs["NORMAL"]!=null?read((int)attrs["NORMAL"],3,5126):new float[mesh.Count*3];
        mesh.UV=attrs["TEXCOORD_0"]!=null?read((int)attrs["TEXCOORD_0"],2,5126):new float[mesh.Count*2];
        Require(mesh.Normals.Length==mesh.Positions.Length && mesh.UV.Length==mesh.Count*2,"attribute count mismatch");
        var indices=primitive["indices"]!=null?read((int)primitive["indices"],1,5125):Enumerable.Range(0,mesh.Count).Select(i=>(float)i).ToArray();
        Require(indices.Length%3==0 && indices.All(i=>i>=0 && i<mesh.Count),"invalid triangle indices");
        mesh.Indices=indices.Select(i=>(int)i).ToArray(); return mesh;
    }
}
