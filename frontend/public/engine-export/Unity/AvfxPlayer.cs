using System;
using UnityEngine;
using UnityEngine.Rendering;

[ExecuteAlways]
public sealed class AvfxPlayer : MonoBehaviour {
    [Serializable] public class Uniform { public string name, type; public float[] values; public int size; }
    [Serializable] public class TextureRef { public string name, path; }
    [Serializable] public class Sample { public float time; public bool visible, depthWrite; public float[] matrix; public Uniform[] uniforms; public int geometry; }
    [Serializable] public class Draw { public string id, program, blend, side; public int order; public bool depthTest, depthWrite; public TextureRef[] textures; public Sample[] samples; }
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
    private Material[] live;
    void OnEnable() {
        if (bindings != null) { live = new Material[bindings.Length]; for(int i=0;i<bindings.Length;i++) { live[i]=new Material(bindings[i].material); live[i].hideFlags=HideFlags.HideAndDontSave; bindings[i].renderer.sharedMaterial=live[i]; } }
        Camera.onPreCull += BeforeCamera;
        RenderPipelineManager.beginCameraRendering += BeforeSrpCamera;
    }
    void OnDisable() {
        Camera.onPreCull -= BeforeCamera;
        RenderPipelineManager.beginCameraRendering -= BeforeSrpCamera;
        if (live != null) foreach(var m in live) if(m) { if(Application.isPlaying) Destroy(m); else DestroyImmediate(m); }
        live=null;
    }
    void BeforeSrpCamera(ScriptableRenderContext context, Camera camera) { BeforeCamera(camera); }
    void Update() {
        if (data == null || data.duration <= 0) return;
        if (playing && Application.isPlaying) time += Time.deltaTime;
        time=looping ? Mathf.Repeat(time,data.duration) : Mathf.Clamp(time,0,data.duration);
    }
    public static Matrix4x4 Matrix(float[] a) {
        var m=new Matrix4x4(); for(int c=0;c<4;c++) for(int r=0;r<4;r++) m[r,c]=a[c*4+r]; return m;
    }
    void BeforeCamera(Camera camera) {
        if(data == null || bindings == null || live == null || data.draws == null) return;
        var frame=Mathf.FloorToInt(Mathf.Clamp(time,0,data.duration)*data.fps+0.00001f);
        for(int i=0;i<bindings.Length;i++) {
            var d=data.draws[i]; var s=d.samples[Mathf.Min(frame,d.samples.Length-1)]; var b=bindings[i]; var m=live[i];
            b.renderer.enabled=s.visible; m.SetFloat("_ZWrite",s.depthWrite?1:0);
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
            var model=transform.localToWorldMatrix*Matrix(s.matrix);
            var view=camera.worldToCameraMatrix;
            m.SetMatrix("modelMatrix",model); m.SetMatrix("viewMatrix",view);
            m.SetMatrix("modelViewMatrix",view*model);
            m.SetMatrix("normalMatrix",(view*model).inverse.transpose);
            m.SetMatrix("projectionMatrix",GL.GetGPUProjectionMatrix(camera.projectionMatrix,camera.targetTexture!=null));
            m.SetVector("cameraPosition",camera.transform.position); m.SetVector("uCam",camera.transform.position);
        }
    }
}
