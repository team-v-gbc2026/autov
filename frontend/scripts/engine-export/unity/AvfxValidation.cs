using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class AvfxValidation {
    public static void Run() { Capture("Assets/AVFX", "Captures", false); }
    public static void RunPresentation() {
        foreach(var id in new[]{"fire-projectile","shield"}) Capture("Assets/Bundles/"+id,"Captures/"+id,true);
        EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene("Assets/Bundles/fire-projectile/Validation.unity",true),new EditorBuildSettingsScene("Assets/Bundles/shield/Validation.unity",true)};
        AssetDatabase.SaveAssets();
    }
    static void Capture(string bundle, string captures, bool presentation) {
        var prefab=AvfxImporter.Import(bundle+"/effect.avfx.json");
        var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        var effect=(GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(prefab));
        var player=effect.GetComponent<AvfxPlayer>(); player.playing=false; player.time=player.data.reference.time;
        var camera=new GameObject("Reference Camera").AddComponent<Camera>();
        var preview=camera.gameObject.AddComponent<AvfxPreviewCamera>(); preview.Configure(player);
        camera.aspect=16f/9;
        var tone=camera.gameObject.AddComponent<AvfxPreviewTone>(); tone.exposure=player.data.reference.exposure;
        tone.toneShader=Shader.Find("Hidden/autoV/PreviewTone");
        Directory.CreateDirectory(captures);
        foreach(var angle in new[]{0,90,180}) {
            preview.yaw=angle; preview.ApplyView();
            var rt=new RenderTexture(640,360,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear); rt.Create(); camera.targetTexture=rt;
            camera.Render(); RenderTexture.active=rt;
            var image=new Texture2D(640,360,TextureFormat.RGBA32,false); image.ReadPixels(new Rect(0,0,640,360),0,0); image.Apply();
            File.WriteAllBytes(captures+"/unity-view-"+angle+".png",image.EncodeToPNG());
            RenderTexture.active=null; camera.targetTexture=null; UnityEngine.Object.DestroyImmediate(image); rt.Release(); UnityEngine.Object.DestroyImmediate(rt);
        }
        preview.yaw=0; preview.ApplyView(); player.playing=true;
        AvfxImporter.CreatePreview(prefab);
        if(presentation) camera.gameObject.AddComponent<AvfxPresentationControls>();
        EditorSceneManager.SaveScene(scene,bundle+"/Validation.unity");
        Debug.Log("AVFX_VALIDATION_COMPLETE: imported prefab, rendered three views, saved scene.");
    }
}
