using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;
using UnityEditor.AssetImporters;
using Object = UnityEngine.Object;

[ScriptedImporter(1, "avfx")]
public sealed class AvfxImporter : ScriptedImporter {
    readonly List<Object> created=new List<Object>();
    long texturePixels;
    T Own<T>(T obj) where T:Object { created.Add(obj); return obj; }
    public override void OnImportAsset(AssetImportContext ctx) {
        created.Clear();
        texturePixels=0;
        try {
            AvfxBundle.Require(GraphicsSettings.currentRenderPipeline==null,"Built-in pipeline required (URP/HDRP not supported)");
            var bundle=AvfxBundle.Load(ctx.assetPath);
            var root=Own(new GameObject((string)bundle.Manifest["name"])); root.SetActive(false);
            var player=root.AddComponent<AvfxPlayer>();
            player.data=new AvfxPlayer.Data { format="avfx/0.1",name=root.name,duration=AvfxBundle.Number(bundle.Manifest["duration"]) };
            var draws=new List<AvfxPlayer.Draw>(); var bindings=new List<AvfxPlayer.Binding>();
            var assets=new Dictionary<string,Object>{{"effect",root}};
            var meshes=new Dictionary<string,AvfxBundle.MeshData>(); long totalVertices=0;
            foreach(var layer in bundle.Layers) foreach(JObject draw in (JArray)layer["draws"]) {
                string id=(string)draw["id"],program=(string)draw["program"];
                // Load by asset path: Shader.Find can miss a package shader during
                // the first asset refresh, before it enters the global registry.
                string shaderPath="Packages/com.autov.avfx/Runtime/Shaders/"+program+".shader";
                ctx.DependsOnSourceAsset(shaderPath);
                var shader=AssetDatabase.LoadAssetAtPath<Shader>(shaderPath);
                AvfxBundle.Require(shader,"missing shader: "+shaderPath);
                AvfxBundle.Require(!ShaderUtil.ShaderHasError(shader),"invalid shader: "+program+" "+string.Join("; ",ShaderUtil.GetShaderMessages(shader).Select(m=>m.message)));
                var state=draw["renderState"]; string blend=(string)state["blend"];
                AvfxBundle.Require((string)state["side"]=="double" && ((string)state["depthFunction"]??"less-equal")=="less-equal","only double-sided less-equal draws supported");
                AvfxBundle.Require(new[]{"additive","alpha","premultiplied"}.Contains(blend),"unsupported blend");
                var material=Own(new Material(shader){name=id});
                material.SetFloat("_SrcBlend",(float)(blend=="premultiplied"?BlendMode.One:BlendMode.SrcAlpha));
                material.SetFloat("_DstBlend",(float)(blend=="additive"?BlendMode.One:BlendMode.OneMinusSrcAlpha));
                material.SetFloat("_Cull",0); material.SetFloat("_ZWrite",(bool)state["depthWrite"]?1:0);
                material.SetFloat("_ZTest",(float)((bool)state["depthTest"]?CompareFunction.LessEqual:CompareFunction.Always));
                material.renderQueue=3000+Mathf.Clamp((int)state["renderOrder"],0,999); assets.Add(id+"/material",material);
                var definitions=(JObject)draw["uniforms"]; // ABI verified by AvfxBundle.
                foreach(var def in definitions.Properties().Where(p=>(string)p.Value["type"]=="sampler2D")) {
                    var texture=Texture(bundle,(JObject)def.Value["binding"]); texture.name=id+"/"+def.Name;
                    material.SetTexture(def.Name,texture); assets.Add(id+"/texture/"+def.Name,texture);
                }
                JObject instances=draw["instances"]?.Type==JTokenType.String?bundle.Read((string)draw["instances"]):null;
                AvfxBundle.Require((program=="particle")== (instances!=null),"particle instance table mismatch");
                int count=instances==null?1:(int)instances["count"]; AvfxBundle.Require(count>0 && count<=60000,"instance budget exceeded");
                var attributes=Attributes(instances,count); assets.Add(id+"/attributes",attributes);
                var geometries=new List<AvfxPlayer.GeometryAsset>(); var meshIds=new Dictionary<string,int>();
                var samples=(JArray)bundle.Timeline["draws"][id];
                foreach(string path in samples.Select(s=>(string)s["mesh"]).Distinct()) {
                    if(!meshes.TryGetValue(path,out var data)) { data=AvfxBundle.Mesh(bundle.Get(path)); meshes.Add(path,data); }
                    totalVertices+=(long)data.Count*count; AvfxBundle.Require(totalVertices<=2000000,"effect exceeds 2M expanded vertices");
                    var mesh=BuildMesh(data,count); mesh.name=id+"/"+path;
                    int index=meshIds.Count; meshIds.Add(path,index);
                    geometries.Add(new AvfxPlayer.GeometryAsset{id=index,mesh=mesh,attributes=attributes}); assets.Add(id+"/mesh/"+path,mesh);
                }
                var runtimeDraw=new AvfxPlayer.Draw {id=id,program=program,start=AvfxBundle.Number(layer["start"]),end=AvfxBundle.Number(layer["end"]),samples=samples.Select(s=>new AvfxPlayer.Sample {
                    time=AvfxBundle.Number(s["time"]),visible=(bool)s["visible"],depthWrite=(bool)state["depthWrite"],matrix=AvfxBundle.Values(s["matrix"]),geometry=meshIds[(string)s["mesh"]],uniforms=Uniforms(definitions,(JObject)s["uniforms"])
                }).ToArray()};
                var child=new GameObject(id); child.transform.SetParent(root.transform,false);
                var filter=child.AddComponent<MeshFilter>(); filter.sharedMesh=geometries[0].mesh;
                var renderer=child.AddComponent<MeshRenderer>(); renderer.sharedMaterial=material; renderer.enabled=false; renderer.shadowCastingMode=ShadowCastingMode.Off; renderer.receiveShadows=false;
                bindings.Add(new AvfxPlayer.Binding{filter=filter,renderer=renderer,material=material,geometries=geometries.ToArray()}); draws.Add(runtimeDraw);
            }
            player.bindings=bindings.ToArray(); player.data.draws=draws.ToArray(); root.SetActive(true);
            player.ReleaseMaterials(); // Serialize asset materials, never transient preview clones.
            foreach(var item in assets) ctx.AddObjectToAsset(item.Key,item.Value);
            ctx.SetMainObject(root);
            ctx.LogImportWarning("Experimental Built-in adapter: soft depth intersections disabled; particles retain seed order (no camera-dependent sort). Scene lighting and post-processing are not imported.");
            created.Clear();
        } catch(Exception e) {
            foreach(var obj in created) if(obj) Object.DestroyImmediate(obj);
            created.Clear(); ctx.LogImportError(e.Message); throw;
        }
    }
    static AvfxPlayer.Uniform[] Uniforms(JObject definitions,JObject sample) {
        AvfxBundle.Require(sample.Properties().All(p=>definitions[p.Name]!=null),"unknown sampled uniform"); var result=new List<AvfxPlayer.Uniform>();
        foreach(var def in definitions.Properties()) {
            string type=(string)def.Value["type"]; if(type=="sampler2D" || def.Value["binding"]!=null) continue;
            int size=(int?)def.Value["size"]??0,components=type=="float" || type=="int"?1:type=="vec2"?2:type=="vec3"?3:type=="vec4"?4:0;
            var values=AvfxBundle.Values((string)def.Value["storage"]=="constant"?def.Value["value"]:sample[def.Name]);
            AvfxBundle.Require(components>0 && size>=0 && size<=64 && values.Length==components*Math.Max(1,size),"invalid uniform: "+def.Name);
            if(type=="int") AvfxBundle.Require(values.All(v=>v==Math.Floor(v)),"fractional integer uniform");
            result.Add(new AvfxPlayer.Uniform{name=def.Name,type=type,size=size,values=values});
        }
        return result.ToArray();
    }
    Texture2D Attributes(JObject instances,int count) {
        var names=new[]{"aSeed","aExtra","aExtra2","aIndex","aSrcPos","aSrcDir","aEvent"}; var widths=new[]{4,4,4,1,3,3,4};
        int height=Math.Max(1,(count*7+1023)/1024); var colors=new Color[1024*height];
        if(instances!=null) for(int slot=0;slot<names.Length;slot++) {
            var attr=instances["attributes"]?[names[slot]]; AvfxBundle.Require(attr!=null && (int)attr["count"]==count && (int)attr["itemSize"]==widths[slot],"invalid instance attribute: "+names[slot]);
            var values=AvfxBundle.Values(attr["values"]); AvfxBundle.Require(values.Length==count*widths[slot],"instance length mismatch");
            for(int i=0;i<count;i++) for(int k=0;k<widths[slot];k++) colors[i*7+slot][k]=values[i*widths[slot]+k];
        }
        var texture=Own(new Texture2D(1024,height,TextureFormat.RGBAFloat,false,true)); texture.SetPixels(colors); texture.Apply(false,false); texture.filterMode=FilterMode.Point; texture.wrapMode=TextureWrapMode.Clamp; return texture;
    }
    Mesh BuildMesh(AvfxBundle.MeshData data,int count) {
        int total=checked(data.Count*count); AvfxBundle.Require(total<=1000000 && (long)data.Indices.Length*count<=6000000,"expanded mesh budget exceeded");
        var positions=new Vector3[total]; var normals=new Vector3[total]; var uv=new Vector2[total]; var uv2=new Vector2[total]; var indices=new int[checked(data.Indices.Length*count)];
        for(int instance=0;instance<count;instance++) {
            for(int v=0;v<data.Count;v++) { int dst=instance*data.Count+v; positions[dst]=new Vector3(data.Positions[v*3],data.Positions[v*3+1],data.Positions[v*3+2]); normals[dst]=new Vector3(data.Normals[v*3],data.Normals[v*3+1],data.Normals[v*3+2]); uv[dst]=new Vector2(data.UV[v*2],data.UV[v*2+1]); uv2[dst]=new Vector2(instance,0); }
            for(int i=0;i<data.Indices.Length;i++) indices[instance*data.Indices.Length+i]=instance*data.Count+data.Indices[i];
        }
        var mesh=Own(new Mesh{indexFormat=IndexFormat.UInt32}); mesh.vertices=positions; mesh.normals=normals; mesh.uv=uv; mesh.uv2=uv2; mesh.triangles=indices; mesh.bounds=new Bounds(Vector3.zero,Vector3.one*16384); return mesh;
    }
    Texture2D Texture(AvfxBundle bundle,JObject binding) {
        string source=(string)binding?["source"];
        if(source=="unbound" || source=="engine") {
            AvfxBundle.Require(source=="unbound" || (string)binding["semantic"]=="opaque-scene-depth","unknown engine texture");
            var zero=Own(new Texture2D(1,1,TextureFormat.RGBA32,false,true)); zero.SetPixel(0,0,Color.clear); zero.Apply(); return zero;
        }
        AvfxBundle.Require(source=="bundle" && (string)binding["colorSpace"]=="linear","unsupported texture binding/color space");
        var bytes=bundle.Get((string)binding["path"]); AvfxBundle.Require(bytes.Length>=24 && bytes.Take(8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}),"only PNG textures supported");
        Func<int,int> be=p=>checked((int)(((uint)bytes[p]<<24)|((uint)bytes[p+1]<<16)|((uint)bytes[p+2]<<8)|bytes[p+3]));
        int width=be(16),height=be(20); AvfxBundle.Require(width>0 && height>0 && width<=8192 && height<=8192 && (long)width*height<=16777216,"PNG dimensions exceed budget");
        texturePixels+=(long)width*height; AvfxBundle.Require(texturePixels<=33554432,"effect texture budget exceeded");
        bool mip=(bool)binding["generateMipmaps"]; var texture=Own(new Texture2D(2,2,TextureFormat.RGBA32,mip,true)); AvfxBundle.Require(texture.LoadImage(bytes,false),"PNG decode failed");
        if(!(bool)binding["flipY"]) { var pixels=texture.GetPixels(); for(int y=0;y<height/2;y++) for(int x=0;x<width;x++) { int a=y*width+x,b=(height-1-y)*width+x; var t=pixels[a]; pixels[a]=pixels[b]; pixels[b]=t; } texture.SetPixels(pixels); }
        texture.wrapModeU=Wrap((string)binding["wrapS"]); texture.wrapModeV=Wrap((string)binding["wrapT"]);
        int min=(int)binding["minFilter"],mag=(int)binding["magFilter"];
        AvfxBundle.Require(new[]{1003,1006,1008}.Contains(min) && new[]{1003,1006}.Contains(mag),"unsupported texture filter");
        AvfxBundle.Require(min==1003?mag==1003:mag==1006,"mixed nearest/linear filtering unsupported");
        texture.filterMode=min==1003?FilterMode.Point:min==1008?FilterMode.Trilinear:FilterMode.Bilinear; texture.anisoLevel=Mathf.Clamp((int?)binding["anisotropy"]??1,1,16); texture.Apply(mip,false); return texture;
    }
    static TextureWrapMode Wrap(string value) { AvfxBundle.Require(new[]{"repeat","mirrored-repeat","clamp-to-edge"}.Contains(value),"unsupported wrap"); return value=="repeat"?TextureWrapMode.Repeat:value=="mirrored-repeat"?TextureWrapMode.Mirror:TextureWrapMode.Clamp; }
}
