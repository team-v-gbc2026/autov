using System;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json.Linq;

static class BundleTests {
    static int assertions;
    static void Check(bool condition,string label) { if(!condition) throw new Exception(label); assertions++; }
    static void Reject(Action action,string label) { try { action(); } catch { assertions++; return; } throw new Exception("Accepted "+label); }
    public static void Main(string[] args) {
        var bytes=File.ReadAllBytes(args[0]); var bundle=AvfxBundle.Parse(bytes);
        Check(bundle.Layers.Count==8,"eight layers");
        Check(bundle.Layers.SelectMany(l=>(JArray)l["draws"]).Count()==8,"eight draws");
        foreach(var path in bundle.Files.Keys.Where(p=>p.EndsWith(".glb"))) {
            var mesh=AvfxBundle.Mesh(bundle.Files[path]); Check(mesh.Count>0 && mesh.Indices.Length%3==0,"valid mesh");
            var broken=(byte[])bundle.Files[path].Clone(); broken[8]=0; Reject(()=>AvfxBundle.Mesh(broken),"bad GLB length");
        }
        Check(!AvfxBundle.SafePath("../x") && !AvfxBundle.SafePath("/x") && !AvfxBundle.SafePath("a\\b") && !AvfxBundle.SafePath("C:/x") && !AvfxBundle.SafePath("a//b"),"path safety");
        var corrupt=(byte[])bytes.Clone(); corrupt[100]^=1; Reject(()=>AvfxBundle.Parse(corrupt),"corrupt archive");
        Reject(()=>AvfxBundle.Parse(bytes.Take(bytes.Length-1).ToArray()),"truncated archive");
        Reject(()=>AvfxBundle.Json(Encoding.UTF8.GetBytes("{\"x\":1,\"x\":2}")),"duplicate JSON properties");
        var modified=AvfxBundle.Parse(bytes);
        modified.Manifest["version"]="avfx/99"; modified.Files["avfx.json"]=Encoding.UTF8.GetBytes(modified.Manifest.ToString());
        Reject(()=>AvfxBundle.Parse(Zip(modified)),"unknown format");
        modified=AvfxBundle.Parse(bytes);
        var texture=modified.Files.Keys.First(p=>p.EndsWith(".png")); modified.Files[texture][25]^=1;
        Reject(()=>AvfxBundle.Parse(Zip(modified)),"SHA mismatch with valid ZIP CRC");
        modified=AvfxBundle.Parse(bytes);
        string shader=(string)modified.Manifest["programs"]["particle"]["vertex"];
        modified.Files[shader]=Encoding.UTF8.GetBytes("untrusted shader");
        var inventory=modified.Manifest["files"].First(f=>(string)f["path"]==shader);
        inventory["bytes"]=modified.Files[shader].Length; inventory["sha256"]=AvfxBundle.Hash(modified.Files[shader]);
        modified.Files["avfx.json"]=Encoding.UTF8.GetBytes(modified.Manifest.ToString());
        Reject(()=>AvfxBundle.Parse(Zip(modified)),"shader revision with valid inventory");
        modified=AvfxBundle.Parse(bytes);
        var layerPath=(string)modified.Manifest["layers"][0]["path"];
        var layer=modified.Read(layerPath);
        ((JObject)layer["draws"][0]["uniforms"]).Property("uTime").Remove();
        ReplaceJson(modified,layerPath,layer);
        Reject(()=>AvfxBundle.Parse(Zip(modified)),"missing required uniform");
        modified=AvfxBundle.Parse(bytes);
        var timeline=(JObject)modified.Timeline.DeepClone();
        var firstDraw=((JObject)timeline["draws"]).Properties().First().Value;
        firstDraw[0]["matrix"]=new JArray(1,2,3);
        ReplaceJson(modified,(string)modified.Manifest["timeline"],timeline);
        Reject(()=>AvfxBundle.Parse(Zip(modified)),"invalid model matrix");
        Console.WriteLine("PASS: "+assertions+" shared .avfx archive/GLB assertions; fire projectile has eight draws.");
    }
    static void ReplaceJson(AvfxBundle bundle,string path,JObject json) {
        bundle.Files[path]=Encoding.UTF8.GetBytes(json.ToString());
        var item=bundle.Manifest["files"].First(f=>(string)f["path"]==path);
        item["bytes"]=bundle.Files[path].Length; item["sha256"]=AvfxBundle.Hash(bundle.Files[path]);
        bundle.Files["avfx.json"]=Encoding.UTF8.GetBytes(bundle.Manifest.ToString());
    }
    static uint Crc(byte[] data) { uint crc=0xffffffff; foreach(byte b in data) { crc^=b; for(int i=0;i<8;i++) crc=(crc>>1)^((crc&1)!=0?0xedb88320:0); } return crc^0xffffffff; }
    static byte[] Zip(AvfxBundle bundle) {
        using(var stream=new MemoryStream()) using(var writer=new BinaryWriter(stream)) using(var directory=new MemoryStream()) using(var d=new BinaryWriter(directory)) {
            foreach(var item in bundle.Files) {
                byte[] name=Encoding.UTF8.GetBytes(item.Key),data=item.Value; uint offset=(uint)stream.Position,crc=Crc(data);
                writer.Write(0x04034b50u); writer.Write((ushort)20); writer.Write((ushort)0); writer.Write((ushort)0); writer.Write(0u); writer.Write(crc); writer.Write(data.Length); writer.Write(data.Length); writer.Write((ushort)name.Length); writer.Write((ushort)0); writer.Write(name); writer.Write(data);
                d.Write(0x02014b50u); d.Write((ushort)20); d.Write((ushort)20); d.Write((ushort)0); d.Write((ushort)0); d.Write(0u); d.Write(crc); d.Write(data.Length); d.Write(data.Length); d.Write((ushort)name.Length); d.Write((ushort)0); d.Write((ushort)0); d.Write((ushort)0); d.Write((ushort)0); d.Write(0u); d.Write(offset); d.Write(name);
            }
            uint start=(uint)stream.Position; writer.Write(directory.ToArray()); writer.Write(0x06054b50u); writer.Write((ushort)0); writer.Write((ushort)0); writer.Write((ushort)bundle.Files.Count); writer.Write((ushort)bundle.Files.Count); writer.Write((uint)directory.Length); writer.Write(start); writer.Write((ushort)0); return stream.ToArray();
        }
    }
}
