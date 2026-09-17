using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class AvfxValidation {
    public static void Run() {
        var prefab=AvfxImporter.Import("Assets/AVFX/effect.avfx.json");
        var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        var effect=(GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(prefab));
        var player=effect.GetComponent<AvfxPlayer>(); player.playing=false; player.time=player.data.reference.time;
        var camera=new GameObject("Reference Camera").AddComponent<Camera>();
        var preview=camera.gameObject.AddComponent<AvfxPreviewCamera>(); preview.Configure(player);
        camera.aspect=16f/9;
        var tone=camera.gameObject.AddComponent<AvfxPreviewTone>(); tone.exposure=player.data.reference.exposure;
        tone.toneShader=Shader.Find("Hidden/autoV/PreviewTone");
        Directory.CreateDirectory("Captures");
        foreach(var angle in new[]{0,90,180}) {
            preview.yaw=angle; preview.ApplyView();
            var rt=new RenderTexture(640,360,24,RenderTextureFormat.ARGB32,RenderTextureReadWrite.Linear); rt.Create(); camera.targetTexture=rt;
            camera.Render(); RenderTexture.active=rt;
            var image=new Texture2D(640,360,TextureFormat.RGBA32,false); image.ReadPixels(new Rect(0,0,640,360),0,0); image.Apply();
            File.WriteAllBytes("Captures/unity-view-"+angle+".png",image.EncodeToPNG());
            RenderTexture.active=null; camera.targetTexture=null; UnityEngine.Object.DestroyImmediate(image); rt.Release(); UnityEngine.Object.DestroyImmediate(rt);
        }
        preview.yaw=0; preview.ApplyView(); player.playing=true;
        AvfxImporter.CreatePreview(prefab);
        EditorSceneManager.SaveScene(scene,"Assets/AVFX/Validation.unity");
        Debug.Log("AVFX_VALIDATION_COMPLETE: imported prefab, rendered three views, saved scene.");
    }
}
