using System;
using UnityEngine;
using UnityEngine.Rendering;

[ExecuteAlways, AddComponentMenu("autoV/AVFX Effect")]
public sealed class AvfxPlayer : MonoBehaviour {
    [Serializable] public class Uniform { public string name, type; public float[] values; public int size; }
    [Serializable] public class TextureRef { public string name, path; }
    [Serializable] public class Sample { public float time; public bool visible, depthWrite; public float[] matrix; public Uniform[] uniforms; public int geometry; }
    [Serializable] public class Draw { public string id, program, blend, side; public float start, end; public int order; public bool depthTest, depthWrite; public TextureRef[] textures; public Sample[] samples; }
    [Serializable] public class Geometry { public int baseGeometry=-1; public int[] attributeIndex; public float[] positions, normals, uv; public int[] indices; public string primitive; }
    [Serializable] public class CameraData { public float[] position, target; public float fov, aspect, near, far; }
    [Serializable] public class ReferenceData { public string background; public float exposure=1; public float time; }
    [Serializable] public class Data { public ReferenceData reference; public string format, name; public float duration, fps; public Draw[] draws; public Geometry[] geometries; public CameraData camera; }
    [Serializable] public class GeometryAsset { public int id; public Mesh mesh; public Texture2D attributes; }
    [Serializable] public class Binding { public MeshRenderer renderer; public MeshFilter filter; public Material material; public GeometryAsset[] geometries; }
    public Data data;
    public Binding[] bindings;
    public bool playing = true, looping = true;
    public float time;
    public bool editorPreview = true;
    [Min(0)] public float speed = 1;
    public void Play() { playing = true; }
    public void Pause() { playing = false; }
    public void Restart() { time = 0; playing = true; }
    public void Seek(float seconds) { time = data == null ? 0 : Mathf.Clamp(seconds, 0, data.duration); }
    private Material[] live;
    void OnEnable() {
        CreateMaterials();
        Camera.onPreCull += BeforeCamera;
        RenderPipelineManager.beginCameraRendering += BeforeSrpCamera;
    }
    void CreateMaterials() {
        if(live!=null) return;
        if (bindings != null) { live = new Material[bindings.Length]; for(int i=0;i<bindings.Length;i++) { live[i]=new Material(bindings[i].material); live[i].hideFlags=HideFlags.HideAndDontSave; bindings[i].renderer.sharedMaterial=live[i]; } }
    }
    void OnDisable() {
        Camera.onPreCull -= BeforeCamera;
        RenderPipelineManager.beginCameraRendering -= BeforeSrpCamera;
        ReleaseMaterials();
        if(bindings!=null) foreach(var b in bindings) if(b!=null && b.renderer) b.renderer.enabled=false;
    }
    public void ReleaseMaterials() {
        if (bindings != null) foreach(var b in bindings) if(b != null && b.renderer) b.renderer.sharedMaterial=b.material;
        if (live != null) foreach(var m in live) if(m) { if(Application.isPlaying) Destroy(m); else DestroyImmediate(m); }
        live=null;
    }
    void BeforeSrpCamera(ScriptableRenderContext context, Camera camera) { BeforeCamera(camera); }
    void Update() {
        if (Application.isPlaying) Advance(Time.deltaTime);
    }
    public void Advance(float delta) {
        if (data == null || data.duration <= 0) return;
        if (playing) time += Mathf.Max(0, delta) * Mathf.Max(0, speed);
        if (!looping && time >= data.duration) playing = false;
        time=looping ? Mathf.Repeat(time,data.duration) : Mathf.Clamp(time,0,data.duration);
    }
    public static Matrix4x4 Matrix(float[] a) {
        var m=new Matrix4x4(); for(int c=0;c<4;c++) for(int r=0;r<4;r++) m[r,c]=a[c*4+r]; return m;
    }
    void BeforeCamera(Camera camera) {
        CreateMaterials();
        if(data == null || bindings == null || live == null || data.draws == null) return;
        for(int i=0;i<bindings.Length;i++) {
            var d=data.draws[i];
            if(d.samples == null || d.samples.Length == 0) continue;
            int low=0, high=d.samples.Length-1;
            while(low<high) { int mid=(low+high+1)/2; if(d.samples[mid].time<=time) low=mid; else high=mid-1; }
            var s=d.samples[low]; var b=bindings[i]; var m=live[i];
            b.renderer.enabled=s.visible && time>=d.start && time<d.end; m.SetFloat("_ZWrite",s.depthWrite?1:0);
            foreach(var g in b.geometries) if(g.id==s.geometry) { b.filter.sharedMesh=g.mesh; m.SetTexture("avfxAttributes",g.attributes); break; }
            foreach(var u in s.uniforms) {
                if(u.size>0) {
                    int components=u.type=="float"?1:u.type=="vec2"?2:u.type=="vec3"?3:4;
                    var v=new Vector4[u.size]; for(int j=0;j<v.Length;j++) for(int k=0;k<components;k++) v[j][k]=u.values[j*components+k];
                    m.SetVectorArray(u.name,v);
                } else if(u.type=="int") m.SetInteger(u.name,(int)u.values[0]);
                else if(u.type=="float") m.SetFloat(u.name,u.values[0]+(u.name=="uTime"?time-s.time:0));
                else { var v=Vector4.zero; for(int k=0;k<Mathf.Min(4,u.values.Length);k++) v[k]=u.values[k]; m.SetVector(u.name,v); }
            }
            // Convert right-handed source coordinates once; Unity is left-handed.
            var sourceToWorld=transform.localToWorldMatrix*Matrix4x4.Scale(new Vector3(1,1,-1));
            var worldToSource=sourceToWorld.inverse;
            // Keep shader world coordinates in source space. Apply conversion
            // in the view so camera, normals and lighting share one space.
            var model=Matrix(s.matrix);
            var view=camera.worldToCameraMatrix*sourceToWorld;
            // Unity binds column-major matrix properties. Generated HLSL uses
            // row-vector mul(v,M); transpose here rather than row_major globals,
            // which Unity's D3D material binding leaves unpopulated.
            m.SetMatrix("modelMatrix",model.transpose); m.SetMatrix("viewMatrix",view.transpose);
            m.SetMatrix("modelViewMatrix",(view*model).transpose);
            m.SetMatrix("normalMatrix",(view*model).inverse);
            m.SetMatrix("projectionMatrix",GL.GetGPUProjectionMatrix(camera.projectionMatrix,camera.targetTexture!=null).transpose);
            var sourceCamera=worldToSource.MultiplyPoint3x4(camera.transform.position);
            m.SetVector("cameraPosition",sourceCamera); m.SetVector("uCam",sourceCamera);
            m.SetFloat("uTime",time-d.start);
            m.SetFloat("uNear",camera.nearClipPlane); m.SetFloat("uFar",camera.farClipPlane);
            m.SetVector("uResolution",new Vector4(camera.pixelWidth,camera.pixelHeight,0,0));
            m.SetVector("uSmokeRight",worldToSource.MultiplyVector(camera.transform.right).normalized);
            m.SetVector("uSmokeUp",worldToSource.MultiplyVector(camera.transform.up).normalized);
            m.SetVector("uSmokeForward",worldToSource.MultiplyVector(-camera.transform.forward).normalized);
            // Reference shaders expect OpenGL depth; no unsafe Unity depth substitution.
            m.SetFloat("uSoft",0);
        }
    }
}
