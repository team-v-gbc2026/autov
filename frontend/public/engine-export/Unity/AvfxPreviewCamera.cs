using UnityEngine;

// Reference camera for an AVFX bundle's right-handed, Y-up coordinate system.
// This component belongs only on the preview camera, not on a game's camera.
[ExecuteAlways, RequireComponent(typeof(Camera))]
public sealed class AvfxPreviewCamera : MonoBehaviour {
    public Vector3 target;
    public Vector3 referenceOffset;
    public float yaw, pitchOffset, zoom=1;
    public AvfxPlayer player;
    Vector3 previousMouse;
    public void Configure(AvfxPlayer effect) {
        player=effect;
        var c=effect.data.camera;
        target=new Vector3(c.target[0],c.target[1],c.target[2]);
        referenceOffset=new Vector3(c.position[0],c.position[1],c.position[2])-target;
        var camera=GetComponent<Camera>(); camera.fieldOfView=c.fov;
        camera.nearClipPlane=c.near; camera.farClipPlane=c.far; camera.allowHDR=true;
        camera.clearFlags=CameraClearFlags.SolidColor;
        Color color; ColorUtility.TryParseHtmlString(effect.data.reference.background,out color);
        camera.backgroundColor=color.linear;
        ApplyView();
    }
    public void ApplyView() {
        if(referenceOffset.sqrMagnitude<0.00001f) return;
        var radius=referenceOffset.magnitude*Mathf.Max(zoom,.01f);
        var azimuth=Mathf.Atan2(referenceOffset.x,referenceOffset.z)+yaw*Mathf.Deg2Rad;
        var elevation=Mathf.Clamp(Mathf.Asin(referenceOffset.y/referenceOffset.magnitude)+pitchOffset,-1.45f,1.45f);
        var position=target+radius*new Vector3(Mathf.Sin(azimuth)*Mathf.Cos(elevation),Mathf.Sin(elevation),Mathf.Cos(azimuth)*Mathf.Cos(elevation));
        transform.position=position; transform.LookAt(target);
        var back=(position-target).normalized;
        var right=Vector3.Cross(Vector3.up,back).normalized; var up=Vector3.Cross(back,right);
        var view=Matrix4x4.identity;
        view.SetRow(0,new Vector4(right.x,right.y,right.z,-Vector3.Dot(right,position)));
        view.SetRow(1,new Vector4(up.x,up.y,up.z,-Vector3.Dot(up,position)));
        view.SetRow(2,new Vector4(back.x,back.y,back.z,-Vector3.Dot(back,position)));
        GetComponent<Camera>().worldToCameraMatrix=view;
    }
    void LateUpdate() {
        if(Application.isPlaying) {
            if(Input.GetMouseButtonDown(0)) previousMouse=Input.mousePosition;
            if(Input.GetMouseButton(0)) {
                var delta=Input.mousePosition-previousMouse; previousMouse=Input.mousePosition;
                yaw-=delta.x*.3f; pitchOffset-=delta.y*.005f;
            }
            zoom=Mathf.Clamp(zoom*Mathf.Exp(-Input.mouseScrollDelta.y*.1f),.05f,20);
            if(Input.GetKeyDown(KeyCode.Space)&&player) player.playing=!player.playing;
        }
        ApplyView();
    }
    void OnDisable() { GetComponent<Camera>().ResetWorldToCameraMatrix(); }
}
