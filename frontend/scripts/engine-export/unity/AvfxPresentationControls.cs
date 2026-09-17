using UnityEngine;
using UnityEngine.SceneManagement;

public sealed class AvfxPresentationControls : MonoBehaviour {
    void Update() {
        if(Input.GetKeyDown(KeyCode.Alpha1)) Select(0);
        if(Input.GetKeyDown(KeyCode.Alpha2)) Select(1);
        var view=GetComponent<AvfxPreviewCamera>();
        if(Input.GetKey(KeyCode.LeftArrow)) view.yaw-=45*Time.unscaledDeltaTime;
        if(Input.GetKey(KeyCode.RightArrow)) view.yaw+=45*Time.unscaledDeltaTime;
        if(Input.GetKeyDown(KeyCode.Alpha0)) { view.yaw=0; view.pitchOffset=0; view.zoom=1; }
    }
    static void Select(int index) {
        Debug.Log("AVFX_PRESENTATION_SELECT: "+index);
        SceneManager.LoadScene(index);
    }
    void OnGUI() {
        var oldMatrix=GUI.matrix;
        var scale=Mathf.Max(1,Screen.width/960f);
        GUI.matrix=Matrix4x4.Scale(new Vector3(scale,scale,1));
        var label=new GUIStyle(GUI.skin.label) {fontSize=18};
        var button=new GUIStyle(GUI.skin.button) {fontSize=18};
        GUILayout.BeginArea(new Rect(18,18,420,168),GUI.skin.box);
        GUILayout.Label("autoV · 3D VFX",label);
        GUILayout.BeginHorizontal();
        if(GUILayout.Button("1  Fire Projectile",button,GUILayout.Height(36))) Select(0);
        if(GUILayout.Button("2  Shield",button,GUILayout.Height(36))) Select(1);
        GUILayout.EndHorizontal();
        GUILayout.Label("Orbit: drag / arrows   Pause: Space",label);
        var view=GetComponent<AvfxPreviewCamera>();
        if(GUILayout.Button("Reset view",button,GUILayout.Height(30))) { view.yaw=0; view.pitchOffset=0; view.zoom=1; }
        GUILayout.EndArea();
        GUI.matrix=oldMatrix;
    }
}
