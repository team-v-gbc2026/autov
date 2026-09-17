using System;
using UnityEditor;
using UnityEngine;
using System.Linq;

// Batch-mode smoke check, no project scenes are replaced or saved.
public static class AvfxSmokeTest {
    public static void Run() {
        var go=new GameObject("autoV smoke test");
        try {
            var player=go.AddComponent<AvfxPlayer>();
            player.data=new AvfxPlayer.Data { duration=2 };
            player.looping=true; player.time=1.5f; player.Advance(1);
            Check(Mathf.Approximately(player.time,.5f),"loop");
            player.Pause(); player.Advance(1); Check(Mathf.Approximately(player.time,.5f),"pause");
            player.Restart(); player.speed=2; player.Advance(.5f); Check(Mathf.Approximately(player.time,1),"speed");
            player.looping=false; player.Advance(2); Check(player.time==2 && !player.playing,"finish");
            player.Seek(-1); Check(player.time==0,"seek");
            Check(!AvfxBundle.SafePath("../outside.png"),"path traversal");
            AssetDatabase.ImportAsset("Assets/fire-projectile.avfx",ImportAssetOptions.ForceUpdate | ImportAssetOptions.ForceSynchronousImport);
            var effect=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/fire-projectile.avfx");
            Check(effect!=null,"automatic .avfx import");
            var imported=effect.GetComponent<AvfxPlayer>();
            Check(imported!=null && imported.bindings.Length==8,"fire projectile has eight draws");
            var instance=(GameObject)PrefabUtility.InstantiatePrefab(effect);
            try {
                var live=instance.GetComponent<AvfxPlayer>(); live.Seek(.5f); live.Pause();
                Check(live.bindings[0].filter.sharedMesh!=null,"imported mesh persists");
                Capture(live);
            } finally { UnityEngine.Object.DestroyImmediate(instance); }
            foreach(var name in AvfxShaderAbi.Versions.Keys) {
                var shader=AssetDatabase.LoadAssetAtPath<Shader>("Packages/com.autov.avfx/Runtime/Shaders/"+name+".shader");
                Check(shader && !ShaderUtil.ShaderHasError(shader),"shader "+name);
            }
            if(System.IO.Directory.Exists("Assets/Generators")) CheckGenerators();
            Debug.Log("AUTOV_SMOKE_PASS: .avfx import, prefab instantiation, playback, paths and shader import");
        } finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    static void Check(bool condition,string name) { if(!condition) throw new Exception("autoV smoke failure: "+name); }
    static void CheckGenerators() {
        bool asyncCompilation=ShaderUtil.allowAsyncCompilation;
        ShaderUtil.allowAsyncCompilation=false;
        var cameraObject=new GameObject("autoV generator test camera");
        var target=new RenderTexture(256,256,24,RenderTextureFormat.ARGB32);
        var image=new Texture2D(256,256,TextureFormat.RGBA32,false);
        var previous=RenderTexture.active;
        try {
            var camera=cameraObject.AddComponent<Camera>(); camera.transform.position=new Vector3(3,3,-6); camera.transform.LookAt(new Vector3(0,.5f,0));
            camera.clearFlags=CameraClearFlags.SolidColor; camera.backgroundColor=Color.black; camera.targetTexture=target; target.Create();
            Func<byte[]> capture=()=>{camera.Render();camera.Render();RenderTexture.active=target;image.ReadPixels(new Rect(0,0,256,256),0,0);image.Apply();return image.GetRawTextureData<byte>().ToArray();};
            var empty=capture();
            foreach(var kind in new[]{"blob","crystals","splash","ribbon","wireBurst","arcs","streakBurst","sheets","crescent","licks"}) {
                string path="Assets/Generators/"+kind+".avfx";
                AssetDatabase.ImportAsset(path,ImportAssetOptions.ForceUpdate|ImportAssetOptions.ForceSynchronousImport);
                var asset=AssetDatabase.LoadAssetAtPath<GameObject>(path); Check(asset,"generator import: "+kind);
                var instance=(GameObject)PrefabUtility.InstantiatePrefab(asset);
                try {
                    var player=instance.GetComponent<AvfxPlayer>();player.Pause();
                    // Exclude the source crescent so this test observes licks themselves.
                    if(kind=="licks")for(int i=0;i<player.data.draws.Length;i++)if(player.data.draws[i].program!="lick")foreach(var sample in player.data.draws[i].samples)sample.visible=false;
                    float firstTime=kind=="crescent"||kind=="licks"?.45f:.2f;
                    player.Seek(firstTime);var first=capture();
                    player.Seek(.65f);var second=capture();
                    player.Seek(firstTime);var rewind=capture();
                    Check(!first.SequenceEqual(empty) && !second.SequenceEqual(empty),kind+" visible pixels");
                    Check(!first.SequenceEqual(second),kind+" animated pixels");
                    Check(first.SequenceEqual(rewind),kind+" exact rewind");
                    foreach(var binding in player.bindings)Check(!ShaderUtil.ShaderHasError(binding.material.shader),kind+" GPU shader");
                    System.IO.File.WriteAllBytes("avfx-"+kind+".png",image.EncodeToPNG());
                    Debug.Log("AUTOV_GENERATOR_PASS: "+kind);
                } finally {UnityEngine.Object.DestroyImmediate(instance);}
            }
        } finally {ShaderUtil.allowAsyncCompilation=asyncCompilation;RenderTexture.active=previous;UnityEngine.Object.DestroyImmediate(cameraObject);target.Release();UnityEngine.Object.DestroyImmediate(target);UnityEngine.Object.DestroyImmediate(image);}
    }
    static void Capture(AvfxPlayer player) {
        var cameraObject=new GameObject("autoV test camera");
        var target=new RenderTexture(640,360,24,RenderTextureFormat.ARGB32);
        var image=new Texture2D(640,360,TextureFormat.RGBA32,false);
        var previous=RenderTexture.active;
        bool asyncCompilation=ShaderUtil.allowAsyncCompilation;
        try {
            ShaderUtil.allowAsyncCompilation=false;
            var camera=cameraObject.AddComponent<Camera>();
            camera.transform.position=new Vector3(0,2,-8); camera.transform.LookAt(Vector3.zero);
            camera.fieldOfView=45; camera.clearFlags=CameraClearFlags.SolidColor; camera.backgroundColor=Color.black;
            camera.targetTexture=target; target.Create(); player.Seek(1); player.Pause(); camera.Render(); camera.Render();
            foreach(var binding in player.bindings) {
                Check(!ShaderUtil.ShaderHasError(binding.material.shader),"compiled draw shader");
            }
            RenderTexture.active=target; image.ReadPixels(new Rect(0,0,640,360),0,0); image.Apply();
            int lit=0; foreach(var pixel in image.GetPixels32()) if(pixel.r>8 || pixel.g>8 || pixel.b>8) lit++;
            System.IO.File.WriteAllBytes("avfx-smoke.png",image.EncodeToPNG());
            Check(lit>100,"rendered effect has visible pixels");
            Debug.Log("AUTOV_RENDER_PASS: "+lit+" visible pixels; avfx-smoke.png");
            var first=image.GetPixels32();
            player.Seek(2); camera.Render(); image.ReadPixels(new Rect(0,0,640,360),0,0); image.Apply();
            var second=image.GetPixels32(); int changed=0;
            for(int i=0;i<first.Length;i++) if(!first[i].Equals(second[i])) changed++;
            Check(changed>100,"seek changes rendered timeline state");
            player.enabled=false; camera.Render(); image.ReadPixels(new Rect(0,0,640,360),0,0); image.Apply();
            foreach(var pixel in image.GetPixels32()) Check(pixel.r==0 && pixel.g==0 && pixel.b==0,"disabled effect does not render");
        } finally { ShaderUtil.allowAsyncCompilation=asyncCompilation; RenderTexture.active=previous; UnityEngine.Object.DestroyImmediate(cameraObject); target.Release(); UnityEngine.Object.DestroyImmediate(target); UnityEngine.Object.DestroyImmediate(image); }
    }
}
