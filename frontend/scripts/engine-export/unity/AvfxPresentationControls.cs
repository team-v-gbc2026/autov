using UnityEngine;
using UnityEngine.SceneManagement;

public sealed class AvfxPresentationControls : MonoBehaviour {
    void OnGUI() {
        GUILayout.BeginArea(new Rect(18,18,380,150),GUI.skin.box);
        GUILayout.Label("autoV · 3D VFX");
        GUILayout.BeginHorizontal();
        if(GUILayout.Button("Fire Projectile")) SceneManager.LoadScene(0);
        if(GUILayout.Button("Shield")) SceneManager.LoadScene(1);
        GUILayout.EndHorizontal();
        GUILayout.Label("Drag: orbit   Scroll: zoom   Space: pause");
        var view=GetComponent<AvfxPreviewCamera>();
        if(GUILayout.Button("Reset view")) { view.yaw=0; view.pitchOffset=0; view.zoom=1; }
        GUILayout.EndArea();
    }
}
