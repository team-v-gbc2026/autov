using UnityEngine;

// Optional reference preview for the Built-in pipeline. Game projects can use
// their own post stack; do not apply this in addition to another tone mapper.
[ExecuteAlways, RequireComponent(typeof(Camera))]
public sealed class AvfxPreviewTone : MonoBehaviour {
    public float exposure=1;
    public Shader toneShader;
    Material material;
    void OnEnable() { GetComponent<Camera>().allowHDR=true; }
    void OnRenderImage(RenderTexture source,RenderTexture destination) {
        if(!toneShader) toneShader=Shader.Find("Hidden/autoV/PreviewTone");
        if(!toneShader) { Graphics.Blit(source,destination); return; }
        if(!material) { material=new Material(toneShader); material.hideFlags=HideFlags.HideAndDontSave; }
        material.SetFloat("_Exposure",exposure);
        var previous=GL.sRGBWrite;
        try { GL.sRGBWrite=false; Graphics.Blit(source,destination,material); }
        finally { GL.sRGBWrite=previous; }
    }
    void OnDisable() {
        if(material) { if(Application.isPlaying) Destroy(material); else DestroyImmediate(material); }
        material=null;
    }
}
