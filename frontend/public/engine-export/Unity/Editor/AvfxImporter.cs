using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;
using UnityEngine.Rendering;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

public static class AvfxImporter {
    [Serializable] class ImageInfo { public int width, height; }
    [MenuItem("Assets/autoV/Import selected AVFX")]
    public static void ImportSelected() {
        var path=AssetDatabase.GetAssetPath(Selection.activeObject);
        if(!path.EndsWith(".avfx.json",StringComparison.OrdinalIgnoreCase)) throw new Exception("Select effect.avfx.json in the extracted bundle.");
        var prefab=Import(path);
        var preview=CreatePreview(prefab);
        Selection.activeObject=AssetDatabase.LoadAssetAtPath<GameObject>(preview);
    }
    public static string CreatePreview(string prefab) {
        var previous=SceneManager.GetActiveScene();
        var scene=EditorSceneManager.NewPreviewScene();
        try {
            var root=new GameObject("autoV Preview"); SceneManager.MoveGameObjectToScene(root,scene);
            var go=(GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(prefab),scene);
            go.transform.SetParent(root.transform,false);
            var player=go.GetComponent<AvfxPlayer>(); player.time=0; player.playing=true;
            var cameraObject=new GameObject("autoV Preview Camera"); SceneManager.MoveGameObjectToScene(cameraObject,scene);
            cameraObject.transform.SetParent(root.transform,false);
            cameraObject.AddComponent<Camera>();
            cameraObject.AddComponent<AvfxPreviewCamera>().Configure(player);
            var tone=cameraObject.AddComponent<AvfxPreviewTone>(); tone.exposure=player.data.reference.exposure;
            tone.toneShader=Shader.Find("Hidden/autoV/PreviewTone");
            var path=Path.GetDirectoryName(prefab).Replace('\\','/')+"/Preview.prefab";
            PrefabUtility.SaveAsPrefabAsset(root,path);
            return path;
        } finally { EditorSceneManager.ClosePreviewScene(scene); if(previous.IsValid()) SceneManager.SetActiveScene(previous); }
    }
    public static string Import(string path) {
        var root=Path.GetDirectoryName(path).Replace('\\','/');
        var data=JsonUtility.FromJson<AvfxPlayer.Data>(File.ReadAllText(root+"/effect.unity.json"));
        if(data.format!="avfx/0.1") throw new Exception("Unsupported AVFX version");
        var dest=AssetDatabase.GenerateUniqueAssetPath(root+"/Imported");
        AssetDatabase.CreateFolder(root,Path.GetFileName(dest));
        var go=new GameObject(data.name); var player=go.AddComponent<AvfxPlayer>();
        player.enabled=false; player.data=data; player.bindings=new AvfxPlayer.Binding[data.draws.Length];
        var meshCache=new Dictionary<int,Mesh>();
        var textureCache=new Dictionary<string,Texture2D>();
        try {
            for(int i=0;i<data.draws.Length;i++) {
                var d=data.draws[i]; var shader=Shader.Find("autoV/Native/"+d.program);
                if(!shader || ShaderUtil.ShaderHasError(shader)) throw new Exception("Native shader missing or failed compilation: "+d.program);
                var material=new Material(shader);
                var src=d.blend=="alpha"||d.blend=="additive"?BlendMode.SrcAlpha:BlendMode.One;
                var dst=d.blend=="additive"?BlendMode.One:d.blend=="screen"?BlendMode.OneMinusSrcColor:BlendMode.OneMinusSrcAlpha;
                material.SetFloat("_SrcBlend",(float)src); material.SetFloat("_DstBlend",(float)dst);
                material.SetFloat("_Cull",d.side=="front"?1:d.side=="back"?2:0);
                material.SetFloat("_ZWrite",d.depthWrite?1:0); material.SetFloat("_ZTest",(float)(d.depthTest?CompareFunction.LessEqual:CompareFunction.Always));
                material.renderQueue=3000+Mathf.Clamp(d.order,0,999);
                foreach(var t in d.textures) {
                    var file=root+"/"+t.path;
                    Texture2D texture;
                    if(!textureCache.TryGetValue(file,out texture)) {
                        if(file.EndsWith(".rgba32f")) {
                            var info=JsonUtility.FromJson<ImageInfo>(File.ReadAllText(file+".json"));
                            texture=new Texture2D(info.width,info.height,TextureFormat.RGBAFloat,false,true);
                            texture.filterMode=FilterMode.Point; texture.wrapMode=TextureWrapMode.Clamp;
                            texture.LoadRawTextureData(File.ReadAllBytes(file)); texture.Apply(false,false);
                            AssetDatabase.CreateAsset(texture,dest+"/texture-"+textureCache.Count+".asset");
                        } else {
                            var importer=(TextureImporter)AssetImporter.GetAtPath(file);
                            importer.sRGBTexture=false; importer.alphaIsTransparency=false; importer.textureCompression=TextureImporterCompression.Uncompressed;
                            importer.mipmapEnabled=true; importer.wrapMode=t.name.ToLowerInvariant().Contains("noise")?TextureWrapMode.Repeat:TextureWrapMode.Clamp;
                            importer.SaveAndReimport(); texture=AssetDatabase.LoadAssetAtPath<Texture2D>(file);
                        }
                        textureCache[file]=texture;
                    }
                    material.SetTexture(t.name,texture);
                }
                var geometries=d.samples.Select(s=>s.geometry).Distinct().Select(id=> {
                    var baseId=data.geometries[id].baseGeometry;
                    if(baseId<0) baseId=id;
                    var g=data.geometries[baseId];
                    Mesh mesh;
                    if(!meshCache.TryGetValue(baseId,out mesh)) {
                    mesh=new Mesh(); mesh.indexFormat=IndexFormat.UInt32;
                    var pos=new Vector3[g.positions.Length/3]; var normals=new Vector3[pos.Length]; var uv=new Vector2[pos.Length]; var indices=new Vector2[pos.Length];
                    for(int v=0;v<pos.Length;v++) { pos[v]=new Vector3(g.positions[v*3],g.positions[v*3+1],g.positions[v*3+2]); normals[v]=new Vector3(g.normals[v*3],g.normals[v*3+1],g.normals[v*3+2]); uv[v]=new Vector2(g.uv[v*2],g.uv[v*2+1]); indices[v]=new Vector2(g.attributeIndex[v],0); }
                    mesh.vertices=pos; mesh.normals=normals; mesh.uv=uv; mesh.uv2=indices;
                    mesh.SetIndices(g.indices,g.primitive=="lines"?MeshTopology.Lines:MeshTopology.Triangles,0);
                    mesh.bounds=new Bounds(Vector3.zero,Vector3.one*16384);
                    AssetDatabase.CreateAsset(mesh,dest+"/base-"+baseId+".mesh.asset"); meshCache[baseId]=mesh;
                    }
                    var stem=root+"/attributes/"+d.id+"-"+id;
                    var info=JsonUtility.FromJson<ImageInfo>(File.ReadAllText(stem+".json"));
                    var attributes=new Texture2D(info.width,info.height,TextureFormat.RGBAFloat,false,true);
                    attributes.filterMode=FilterMode.Point; attributes.wrapMode=TextureWrapMode.Clamp;
                    attributes.LoadRawTextureData(File.ReadAllBytes(stem+".bin")); attributes.Apply(false,false);
                    AssetDatabase.CreateAsset(attributes,dest+"/"+d.id+"-"+id+".attributes.asset");
                    return new AvfxPlayer.GeometryAsset {id=id,mesh=mesh,attributes=attributes};
                }).ToArray();
                AssetDatabase.CreateAsset(material,dest+"/"+d.id+".mat");
                var child=new GameObject(d.id); child.transform.SetParent(go.transform,false);
                var filter=child.AddComponent<MeshFilter>(); filter.sharedMesh=geometries[0].mesh;
                var renderer=child.AddComponent<MeshRenderer>(); renderer.sharedMaterial=material; renderer.shadowCastingMode=ShadowCastingMode.Off; renderer.receiveShadows=false;
                player.bindings[i]=new AvfxPlayer.Binding {renderer=renderer,filter=filter,material=material,geometries=geometries};
            }
            player.enabled=true;
            var prefab=dest+"/Effect.prefab"; PrefabUtility.SaveAsPrefabAsset(go,prefab); AssetDatabase.SaveAssets();
            Selection.activeObject=AssetDatabase.LoadAssetAtPath<GameObject>(prefab); return prefab;
        } finally { UnityEngine.Object.DestroyImmediate(go); }
    }
}
