using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class AvfxPresentation {
    [MenuItem("autoV/Presentation/Play")]
    public static void Play() {
        EditorSceneManager.OpenScene("Assets/Bundles/fire-projectile/Validation.unity");
        EditorApplication.delayCall+=()=> { EditorApplication.isPlaying=true; EditorApplication.ExecuteMenuItem("Window/General/Game"); };
    }
    public static void Build() {
        PlayerSettings.productName="autoV VFX Presentation";
        PlayerSettings.defaultScreenWidth=1280; PlayerSettings.defaultScreenHeight=720;
        PlayerSettings.fullScreenMode=FullScreenMode.Windowed;
        PlayerSettings.resizableWindow=true; PlayerSettings.runInBackground=true;
        var report=BuildPipeline.BuildPlayer(EditorBuildSettings.scenes,"../AutoV Unity.app",BuildTarget.StandaloneOSX,BuildOptions.None);
        if(report.summary.result!=UnityEditor.Build.Reporting.BuildResult.Succeeded) throw new System.Exception("Presentation build failed: "+report.summary.result);
        Debug.Log("AVFX_PRESENTATION_BUILD_COMPLETE");
    }
}
