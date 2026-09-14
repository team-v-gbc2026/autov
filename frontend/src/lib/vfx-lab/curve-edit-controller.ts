import * as THREE from "three/webgpu";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { VfxDocumentV2 } from "./schema-v2";
import type { EffectPlacement } from "./placement";
import type { CurveGuides } from "./curve-guides";
import { CurveEditModel, type CurvePoint } from "./curve-edit-model";

import type { CurveEditSnapshot } from "./curve-edit-state";
export type { CurveEditSnapshot } from "./curve-edit-state";

/** Paths already are in the reference frame: no authoringFrame correction. */
export function worldToCurvePoint(
  world: THREE.Vector3,
  placement: THREE.Matrix4,
): [number, number, number] {
  return world.clone().applyMatrix4(placement.clone().invert()).toArray();
}

/** Viewer-only draft editing. There is deliberately no runtime/setDocument
 * dependency: only the explicit Apply/Undo callbacks can change the effect. */
export class CurveEditController {
  private readonly model: CurveEditModel;
  private readonly handle = new THREE.Object3D();
  private readonly gizmo: TransformControls;
  private readonly helper: THREE.Object3D;
  private readonly placement = new THREE.Matrix4();
  private selected: CurvePoint | null = null;
  private visible = false;
  private dragging = false;
  private disposed = false;
  private error = "";
  private pointerDown: { x: number; y: number; id: number } | null = null;
  constructor(
    private readonly options: {
      scene: THREE.Scene;
      camera: THREE.Camera;
      domElement: HTMLElement;
      orbit: OrbitControls;
      guides: CurveGuides;
      document: VfxDocumentV2;
      onChange: (snapshot: CurveEditSnapshot) => void;
      onCommit: (doc: VfxDocumentV2) => void;
      onActive: (active: boolean) => void;
      requestRender: () => void;
    },
  ) {
    this.model = new CurveEditModel(options.document);
    options.scene.add(this.handle);
    this.gizmo = new TransformControls(options.camera, options.domElement);
    this.gizmo.setMode("translate");
    this.gizmo.setSpace("local");
    this.gizmo.enabled = false;
    this.helper = this.gizmo.getHelper();
    this.helper.visible = false;
    options.scene.add(this.helper);
    this.gizmo.addEventListener("objectChange", this.onMove);
    this.gizmo.addEventListener("dragging-changed", this.onDrag);
    options.domElement.addEventListener("pointerdown", this.onDown, true);
    options.domElement.addEventListener("pointerup", this.onUp, true);
    window.addEventListener("keydown", this.onKey);
    options.domElement.addEventListener("pointercancel", this.onPointerCancel);
  }
  get snapshot(): CurveEditSnapshot {
    return {
      active: !!this.selected,
      dirty: this.model.dirty,
      dragging: this.dragging,
      canUndo: this.model.canUndo,
      selected: this.selected,
      error: this.error,
    };
  }
  private publish() {
    if (!this.disposed) this.options.onChange(this.snapshot);
    this.options.requestRender();
  }
  setDocument(doc: VfxDocumentV2) {
    if (this.model.replaceDocument(doc)) {
      this.detach();
      this.error = "";
      this.refresh();
    }
    this.publish();
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) this.cancel();
    this.options.guides.setVisible(visible);
    this.publish();
  }
  setPlacement(value: EffectPlacement) {
    this.placement.compose(
      new THREE.Vector3(...value.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...value.rotation)),
      new THREE.Vector3(1, 1, 1),
    );
    this.syncHandle();
  }
  select(point: CurvePoint | null) {
    if (!this.visible || this.dragging) return;
    if (!point) {
      this.cancel();
      return;
    }
    if (
      !this.model.paths.find((p) => p.id === point.pathId)?.points[point.index]
    )
      return;
    this.selected = point;
    this.options.onActive(true);
    this.syncHandle();
    this.gizmo.attach(this.handle);
    this.gizmo.enabled = true;
    this.helper.visible = true;
    this.publish();
  }
  private syncHandle() {
    if (!this.selected) return;
    const p = this.model.paths.find((p) => p.id === this.selected!.pathId)
      ?.points[this.selected.index];
    if (!p) return;
    this.handle.position.set(...p).applyMatrix4(this.placement);
    this.handle.quaternion.setFromRotationMatrix(this.placement);
    this.handle.updateMatrixWorld(true);
  }
  private refresh() {
    this.options.guides.setPaths(this.model.paths);
    this.syncHandle();
  }
  private onMove = () => {
    if (!this.selected) return;
    this.model.move(
      this.selected,
      worldToCurvePoint(this.handle.position, this.placement),
    );
    this.error = "";
    this.refresh();
    this.publish();
  };
  private onDrag = (event: { value: unknown }) => {
    this.dragging = event.value === true;
    this.options.orbit.enabled = !this.dragging;
    this.publish();
  };
  private onDown = (event: PointerEvent) => {
    if (!this.visible || event.button !== 0) return;
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
    };
    // Claim marker clicks before the origin controller selects the effect behind it.
    if (this.hit(event)) {
      event.stopImmediatePropagation();
    }
  };
  private onUp = (event: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!this.visible || !down || this.dragging || this.gizmo.dragging) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    const point = this.hit(event);
    if (point) {
      event.stopImmediatePropagation();
      this.select(point);
    }
  };
  private hit(event: PointerEvent) {
    const r = this.options.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return this.options.guides.pickPoint(
      new THREE.Vector2(
        ((event.clientX - r.left) / r.width) * 2 - 1,
        (-(event.clientY - r.top) / r.height) * 2 + 1,
      ),
      this.options.camera,
    );
  }
  private onPointerCancel = () => {
    if (this.dragging) this.cancel();
    else this.pointerDown = null;
  };
  private onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.selected) return;
    event.preventDefault();
    this.cancel();
  };
  private detach() {
    if (
      this.pointerDown &&
      this.options.domElement.hasPointerCapture(this.pointerDown.id)
    )
      this.options.domElement.releasePointerCapture(this.pointerDown.id);
    this.pointerDown = null;
    this.gizmo.dragging = false;
    this.gizmo.axis = null;
    this.gizmo.detach();
    this.gizmo.enabled = false;
    this.helper.visible = false;
    this.dragging = false;
    this.options.orbit.enabled = true;
    this.selected = null;
    this.options.onActive(false);
  }
  cancel() {
    this.model.cancel();
    this.error = "";
    this.detach();
    this.refresh();
    this.publish();
  }
  apply() {
    if (this.dragging) return;
    try {
      const next = this.model.apply();
      if (next) {
        this.detach();
        this.refresh();
        this.options.onCommit(next);
      }
      this.error = "";
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Invalid curve";
    }
    this.publish();
  }
  undo() {
    if (this.dragging || this.model.dirty) return;
    const next = this.model.undo();
    if (next) {
      this.detach();
      this.refresh();
      this.options.onCommit(next);
    }
    this.publish();
  }
  dispose() {
    this.disposed = true;
    this.detach();
    this.gizmo.removeEventListener("objectChange", this.onMove);
    this.gizmo.removeEventListener("dragging-changed", this.onDrag);
    this.gizmo.dispose();
    this.helper.removeFromParent();
    this.handle.removeFromParent();
    this.options.domElement.removeEventListener(
      "pointerdown",
      this.onDown,
      true,
    );
    this.options.domElement.removeEventListener("pointerup", this.onUp, true);
    window.removeEventListener("keydown", this.onKey);
    this.options.domElement.removeEventListener(
      "pointercancel",
      this.onPointerCancel,
    );
  }
}
