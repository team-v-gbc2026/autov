using UnityEditor;
using UnityEngine;

[CustomEditor(typeof(AvfxPlayer))]
public sealed class AvfxPlayerEditor : Editor {
    public override void OnInspectorGUI() {
        var player = (AvfxPlayer)target;
        EditorGUILayout.LabelField("autoV Effect", EditorStyles.boldLabel);
        if (player.data == null || player.data.duration <= 0) {
            EditorGUILayout.HelpBox("Drop a .avfx file into Assets, then drag the imported effect into your scene.", MessageType.Info);
            return;
        }
        EditorGUI.BeginChangeCheck();
        var preview = EditorGUILayout.Toggle("Editor preview", player.editorPreview);
        var loop = EditorGUILayout.Toggle("Loop", player.looping);
        var speed = EditorGUILayout.Slider("Speed", player.speed, 0, 4);
        var time = EditorGUILayout.Slider("Time", player.time, 0, player.data.duration);
        if (EditorGUI.EndChangeCheck()) {
            Undo.RecordObject(player, "Change autoV playback");
            player.editorPreview = preview; player.looping = loop; player.speed = speed; player.time = time;
            EditorUtility.SetDirty(player); SceneView.RepaintAll();
        }
        using (new EditorGUILayout.HorizontalScope()) {
            if (GUILayout.Button(player.playing ? "Pause" : "Play")) {
                Undo.RecordObject(player, "Toggle autoV playback"); player.playing = !player.playing;
            }
            if (GUILayout.Button("Restart")) {
                Undo.RecordObject(player, "Restart autoV playback"); player.Restart();
            }
        }
        EditorGUILayout.HelpBox("Shared .avfx bundle • Built-in pipeline. Soft intersections and camera-dependent particle sorting are not yet supported.", MessageType.Info);
    }
}

[InitializeOnLoad]
static class AvfxEditorPlayback {
    static double previous;
    static AvfxEditorPlayback() { previous = EditorApplication.timeSinceStartup; EditorApplication.update += Tick; }
    static void Tick() {
        var now = EditorApplication.timeSinceStartup;
        var delta = (float)System.Math.Min(now - previous, .1);
        previous = now;
        if (EditorApplication.isPlayingOrWillChangePlaymode) return;
        bool repaint = false;
        foreach (var player in Object.FindObjectsByType<AvfxPlayer>(FindObjectsSortMode.None)) {
            if (!player.isActiveAndEnabled || !player.editorPreview || !player.playing || EditorUtility.IsPersistent(player)) continue;
            player.Advance(delta); repaint = true;
        }
        if (repaint) { EditorApplication.QueuePlayerLoopUpdate(); SceneView.RepaintAll(); }
    }
}
