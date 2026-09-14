import * as THREE from "three/webgpu";
import type { VfxDocumentV2 } from "./schema-v2";
import type { EffectPlacement } from "./placement";
import { sampleEffectPath, type EffectPath } from "./effect-path";

/** Viewer-only guides. Paths already use reference coordinates, so apply only
 * placement, not the document's authored-coordinate correction. */
export class CurveGuides {
  private readonly root = new THREE.Group();
  private signature = "";
  private readonly markerTexture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.beginPath();
    context.arc(32, 32, 29, 0, Math.PI * 2);
    context.fill();
    this.markerTexture = new THREE.CanvasTexture(canvas);
    this.root.name = "curve-guides";
    this.root.visible = false;
    scene.add(this.root);
  }
  setVisible(visible: boolean) {
    this.root.visible = visible;
  }
  setPlacement(placement: EffectPlacement) {
    this.root.position.fromArray(placement.position);
    this.root.rotation.set(...placement.rotation);
  }
  setDocument(doc: VfxDocumentV2) {
    this.setPaths(doc.paths ?? []);
  }
  setPaths(paths: EffectPath[]) {
    const signature = JSON.stringify(
      paths.map((path) => [path.id, path.points.length]),
    );
    if (signature === this.signature) {
      for (const path of paths) {
        const points = path.points.map((p) => new THREE.Vector3(...p));
        for (const child of this.root.children) {
          if (child.userData.pathId !== path.id) continue;
          if (child instanceof THREE.Sprite)
            child.position.copy(points[child.userData.curvePoint.index]);
          else if (child instanceof THREE.Line) {
            const positions = child.userData.handles
              ? this.handlePoints(points)
              : this.samplePoints(path, points);
            child.geometry.setFromPoints(positions);
            child.geometry.computeBoundingSphere();
          }
        }
      }
      return;
    }
    this.clear();
    this.signature = signature;
    const materialOptions = {
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    };
    for (const path of paths) {
      const points = path.points.map((p) => new THREE.Vector3(...p));
      const sampled = this.samplePoints(path, points);
      const curve = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(sampled),
        new THREE.LineBasicMaterial({ ...materialOptions, color: 0x6ee7ff }),
      );
      curve.userData.pathId = path.id;
      curve.name = `${path.id}: curve`;
      this.add(curve);
      const handles = this.handlePoints(points);
      const handleLines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(handles),
        new THREE.LineBasicMaterial({ ...materialOptions, color: 0xffc66d }),
      );
      handleLines.userData.pathId = path.id;
      handleLines.userData.handles = true;
      this.add(handleLines);
      // WebGPU point primitives are always one pixel; sprites retain a visible
      // screen-space size regardless of camera distance.
      points.forEach((point, index) => {
        const anchor = index % 3 === 0;
        const size = anchor ? 0.016 : 0.013;
        for (const outline of [true, false]) {
          const marker = new THREE.Sprite(
            new THREE.SpriteMaterial({
              ...materialOptions,
              sizeAttenuation: false,
              map: this.markerTexture,
              transparent: true,
              color: outline ? 0x101820 : anchor ? 0x6ee7ff : 0xffc66d,
            }),
          );
          marker.position.copy(point);
          marker.scale.setScalar(size * (outline ? 1.25 : 1));
          marker.userData.pathId = path.id;
          marker.userData.curvePoint = { pathId: path.id, index };
          marker.name = `${path.id}: ${anchor ? "anchor" : "control"} ${index}`;
          this.add(marker);
          marker.renderOrder = outline ? 10002 : 10003;
        }
      });
    }
  }
  private handlePoints(points: THREE.Vector3[]) {
    const handles: THREE.Vector3[] = [];
    for (let i = 0; i + 3 < points.length; i += 3)
      handles.push(points[i], points[i + 1], points[i + 2], points[i + 3]);
    return handles;
  }
  private samplePoints(path: EffectPath, points: THREE.Vector3[]) {
    try {
      return sampleEffectPath(path).frames.map((f) => f.position);
    } catch {
      // Keep a same-sized control polygon for invalid intermediate drafts;
      // buffer/material identities remain stable and Apply reports validation.
      return Array.from({ length: 65 }, (_, i) => {
        const x = (i / 64) * (points.length - 1),
          lo = Math.min(points.length - 2, Math.floor(x));
        return points[lo].clone().lerp(points[lo + 1], x - lo);
      });
    }
  }
  pickPoint(
    pointer: THREE.Vector2,
    camera: THREE.Camera,
  ): { pathId: string; index: number } | null {
    if (!this.root.visible) return null;
    this.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(
      this.root.children.filter((child) => child instanceof THREE.Sprite),
      false,
    )[0];
    return hit?.object.userData.curvePoint ?? null;
  }
  private add(object: THREE.Object3D) {
    object.renderOrder = 10001;
    object.frustumCulled = false;
    this.root.add(object);
  }
  private clear() {
    for (const child of [...this.root.children]) {
      const drawable = child as THREE.Line | THREE.Sprite;
      if (!(drawable instanceof THREE.Sprite)) drawable.geometry.dispose();
      const materials = Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material];
      materials.forEach((m) => m.dispose());
      this.root.remove(child);
    }
  }
  dispose() {
    this.clear();
    this.markerTexture.dispose();
    this.root.removeFromParent();
  }
}
