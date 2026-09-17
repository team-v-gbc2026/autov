using System;
using UnityEditor;
using UnityEngine;

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
            bool rejected=false;
            try { AvfxImporter.BundlePath("Assets/Bundle","../outside.png"); } catch { rejected=true; }
            Check(rejected,"path traversal");
            foreach(var name in new[]{"particle","surface","trail","subParticle","strip","sliver","blob","ribbon","wireBurst","crystal","arc","streak","sheet","crescent","lick","splash","subTrail"}) {
                var shader=Shader.Find("autoV/Native/"+name);
                Check(shader && !ShaderUtil.ShaderHasError(shader),"shader "+name);
            }
            Debug.Log("AUTOV_SMOKE_PASS: playback, paths and shader import");
        } finally { UnityEngine.Object.DestroyImmediate(go); }
    }
    static void Check(bool condition,string name) { if(!condition) throw new Exception("autoV smoke failure: "+name); }
}
