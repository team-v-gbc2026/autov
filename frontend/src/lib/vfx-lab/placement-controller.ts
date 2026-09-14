/**
 * The effect-origin handle.
 *
 * Shows one selectable origin with a forward (+Z) arrow, and drags it with a
 * translate/rotate gizmo. Dragging writes placement straight through to the
 * runtime — it never touches the effect document, so nothing regenerates and an
 * in-flight agent edit is unaffected.
 *
 * The handle lives in the scene, not in the effect group. If it were a child of
 * the thing it moves, every drag would feed its own transform back into itself.
 */
import * as THREE from "three/webgpu";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  IDENTITY_PLACEMENT,
  clonePlacement,
  placementsEqual,
  type EffectPlacement,
} from "./placement";

export type PlacementMode = "translate" | "rotate";
export type PlacementSpace = "local" | "world";

export type PlacementSnapshot = {
  placement: EffectPlacement;
  mode: PlacementMode;
  space: PlacementSpace;
  visible: boolean;
  dragging: boolean;
  canUndo: boolean;
  editingOrigin: boolean;
};

/** Deep enough to walk back a fumbled drag, shallow enough to stay bounded. */
const HISTORY_LIMIT = 50;

const HANDLE_COLOR = 0x6ee7ff;
const ARROW_LENGTH = 1.2;
/** Above the effect: the marker sits inside whatever it is placing. */
const HANDLE_RENDER_ORDER = 10000;

export class PlacementController {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly orbit: OrbitControls;
  private readonly apply: (placement: EffectPlacement) => void;
  private readonly requestRender: () => void;
  private readonly emit: (snapshot: PlacementSnapshot) => void;

  private readonly handle = new THREE.Group();
  private readonly effectRoot: THREE.Object3D;
  private readonly domElement: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDownAt: { x: number; y: number } | null = null;
  private readonly gizmo: TransformControls;
  private readonly gizmoHelper: THREE.Object3D;
  private readonly disposables: { dispose(): void }[] = [];

  private placement: EffectPlacement = clonePlacement(IDENTITY_PLACEMENT);
  private history: EffectPlacement[] = [];
  private mode: PlacementMode = "translate";
  private space: PlacementSpace = "world";
  private visible = false;
  private dragging = false;
  private disposed = false;
  private editingOrigin = false;
  private readonly authoringToWorld = new THREE.Matrix4();

  constructor(options: {
    scene: THREE.Scene;
    camera: THREE.Camera;
    domElement: HTMLElement;
    orbit: OrbitControls;
    /** Hit-tested so clicking the effect selects its origin. */
    effectRoot: THREE.Object3D;
    applyPlacement: (placement: EffectPlacement) => void;
    requestRender: () => void;
    onChange: (snapshot: PlacementSnapshot) => void;
  }) {
    this.scene = options.scene;
    this.orbit = options.orbit;
    this.effectRoot = options.effectRoot;
    this.domElement = options.domElement;
    this.camera = options.camera;
    this.apply = options.applyPlacement;
    this.requestRender = options.requestRender;
    this.emit = options.onChange;

    this.buildHandle();
    this.handle.visible = false;
    this.scene.add(this.handle);

    this.gizmo = new TransformControls(options.camera, options.domElement);
    this.gizmo.setMode(this.mode);
    this.gizmo.setSpace(this.space);
    this.gizmo.attach(this.handle);
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.visible = false;
    this.scene.add(this.gizmoHelper);

    this.gizmo.addEventListener("dragging-changed", this.onDraggingChanged);
    this.gizmo.addEventListener("objectChange", this.onObjectChange);

    this.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.domElement.addEventListener("pointerup", this.onPointerUp);
  }

  /** Orbiting is a drag, selecting is a click: only a pointer that barely moved
   * counts, or every orbit would toggle the handle. */
  private onPointerDown = (event: PointerEvent) => {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (event: PointerEvent) => {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    // The gizmo owns the pointer during its own drags.
    if (!down || this.dragging || this.gizmo.dragging || this.editingOrigin) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;

    const rect = this.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hitEffect = this.raycaster.intersectObject(this.effectRoot, true).length > 0;
    const hitHandle = this.raycaster.intersectObject(this.handle, true).length > 0;
    this.setVisible(hitEffect || hitHandle);
  };

  /**
   * A wireframe origin plus a +Z arrow: the forward the authoring contract names.
   *
   * Drawn without depth test and last. The effect is exactly what surrounds the
   * origin, so a depth-tested marker is buried inside it — and the whole scene,
   * helpers included, goes through the post stack (post-v2 builds its pass over
   * this scene), where bloom washes out anything dim. TransformControls does the
   * same for its gizmo, which is why the gizmo was visible when this was not.
   */
  private buildHandle() {
    const originGeometry = new THREE.OctahedronGeometry(0.2);
    const originMaterial = new THREE.MeshBasicMaterial({
      color: HANDLE_COLOR,
      wireframe: true,
      toneMapped: false,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const origin = new THREE.Mesh(originGeometry, originMaterial);
    origin.renderOrder = HANDLE_RENDER_ORDER;
    this.handle.add(origin);
    this.disposables.push(originGeometry, originMaterial);

    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0),
      ARROW_LENGTH,
      HANDLE_COLOR,
      0.3,
      0.16,
    );
    // Helpers must read as UI, not as part of the effect's lighting.
    for (const child of [arrow.line, arrow.cone]) {
      const material = child.material as THREE.Material & {
        toneMapped?: boolean;
        fog?: boolean;
      };
      material.toneMapped = false;
      material.depthTest = false;
      material.depthWrite = false;
      material.fog = false;
      child.renderOrder = HANDLE_RENDER_ORDER;
      this.disposables.push(material);
      this.disposables.push(child.geometry);
    }
    arrow.renderOrder = HANDLE_RENDER_ORDER;
    this.handle.add(arrow);
    this.handle.renderOrder = HANDLE_RENDER_ORDER;
  }

  // three types this event's payload as `unknown`; it is the drag flag.
  private onDraggingChanged = (event: { value: unknown }) => {
    const dragging = event.value === true;
    this.dragging = dragging;
    // Orbit and gizmo both claim the pointer; the gizmo wins while dragging.
    this.orbit.enabled = !dragging;
    if (dragging && !this.editingOrigin) this.pushHistory();
    this.publish();
  };

  private onObjectChange = () => {
    // Origin editing moves only the marker; the effect stays still until Apply.
    if (this.editingOrigin) { this.requestRender(); return; }
    const next: EffectPlacement = {
      position: this.handle.position.toArray() as [number, number, number],
      rotation: [
        this.handle.rotation.x,
        this.handle.rotation.y,
        this.handle.rotation.z,
      ],
    };
    if (placementsEqual(next, this.placement)) return;
    this.placement = next;
    this.apply(next);
    this.publish();
    this.requestRender();
  };

  private pushHistory() {
    this.history.push(clonePlacement(this.placement));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  private syncHandle() {
    this.handle.position.fromArray(this.placement.position);
    this.handle.rotation.fromArray(this.placement.rotation);
    this.handle.updateMatrixWorld(true);
  }

  private publish() {
    if (this.disposed) return;
    this.emit(this.snapshot);
  }

  get snapshot(): PlacementSnapshot {
    return {
      placement: clonePlacement(this.placement),
      mode: this.mode,
      space: this.space,
      visible: this.visible,
      dragging: this.dragging,
      canUndo: !this.editingOrigin && this.history.length > 0,
      editingOrigin: this.editingOrigin,
    };
  }

  /**
   * Set placement from outside the gizmo — restoring stored state, or a numeric
   * edit. `history: false` is for restoration, which must not become an undo step.
   */
  setPlacement(placement: EffectPlacement, options: { history?: boolean } = {}) {
    if (this.editingOrigin) return;
    if (placementsEqual(placement, this.placement)) return;
    if (options.history !== false) this.pushHistory();
    this.placement = clonePlacement(placement);
    this.syncHandle();
    this.apply(this.placement);
    this.publish();
    this.requestRender();
  }

  setMode(mode: PlacementMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.gizmo.setMode(mode);
    this.publish();
    this.requestRender();
  }

  setSpace(space: PlacementSpace) {
    if (space === this.space) return;
    this.space = space;
    this.gizmo.setSpace(space);
    this.publish();
    this.requestRender();
  }

  /** Selecting the origin is what reveals the gizmo; nothing is shown until then. */
  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.handle.visible = visible;
    this.gizmoHelper.visible = visible;
    this.gizmo.enabled = visible;
    if (!visible && this.dragging) {
      this.dragging = false;
      this.orbit.enabled = true;
    }
    this.publish();
    this.requestRender();
  }

  /** Freeze the effect and position the marker at its semantic emission point. */
  beginOriginEdit() {
    if (this.disposed || this.dragging || this.editingOrigin) return;
    this.effectRoot.updateWorldMatrix(true, false);
    this.authoringToWorld.copy(this.effectRoot.matrixWorld);
    this.editingOrigin = true;
    this.setVisible(true);
    this.publish();
    this.requestRender();
  }

  finishOriginEdit(): EffectPlacement | null {
    if (!this.editingOrigin || this.dragging) return null;
    this.handle.updateMatrixWorld(true);
    const local = this.authoringToWorld.clone().invert().multiply(this.handle.matrixWorld);
    const position = new THREE.Vector3(), orientation = new THREE.Quaternion(), scale = new THREE.Vector3();
    local.decompose(position, orientation, scale);
    const rotation = new THREE.Euler().setFromQuaternion(orientation, "XYZ");
    const frame: EffectPlacement = {
      position: position.toArray(), rotation: [rotation.x, rotation.y, rotation.z],
    };
    this.cancelOriginEdit();
    return frame;
  }

  cancelOriginEdit() {
    if (!this.editingOrigin) return;
    // Document replacement can cancel a draft in the middle of a pointer drag.
    // End that drag before returning the handle to placement ownership.
    this.gizmo.dragging = false;
    this.gizmo.axis = null;
    this.editingOrigin = false;
    this.syncHandle();
    this.publish();
    this.requestRender();
  }

  /** Back to the authored frame: the effect renders exactly as generated. */
  reset() {
    this.setPlacement(IDENTITY_PLACEMENT);
  }

  undo() {
    if (this.editingOrigin) return;
    const previous = this.history.pop();
    if (!previous) return;
    this.placement = previous;
    this.syncHandle();
    this.apply(this.placement);
    this.publish();
    this.requestRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.gizmo.removeEventListener("dragging-changed", this.onDraggingChanged);
    this.gizmo.removeEventListener("objectChange", this.onObjectChange);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.scene.remove(this.gizmoHelper);
    this.scene.remove(this.handle);
    for (const item of this.disposables) item.dispose();
    // A drag interrupted by unmount must not leave orbit disabled.
    this.orbit.enabled = true;
  }
}
