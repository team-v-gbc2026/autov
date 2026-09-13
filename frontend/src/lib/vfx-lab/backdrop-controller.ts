/**
 * Optional Gaussian-splat backdrop for the v2 viewer.
 *
 * This module owns Spark end to end: the `SparkRenderer`, the loaded
 * `SplatMesh`, and their transforms. It is handed the viewer's existing scene
 * and renderer and adds nothing else to them, so the runtime's rendering,
 * postprocessing, depth passes, effect generation and camera behaviour are
 * untouched — see `dispose()` for the matching guarantee on the way out.
 *
 * Verified against the real render path before this was written:
 *   - Spark draws correctly through the existing `EffectComposer`.
 *   - Splat materials are `depthWrite: false`, so a backdrop never enters the
 *     runtime's soft-particle depth pre-pass and cannot occlude particles.
 *     Accurate particle occlusion is therefore out of scope by construction,
 *     not by omission.
 *   - `SplatMesh.dispose()` releases the splat payload (the textures); Spark's
 *     one-time shared machinery is allocated on first use and is not returned.
 *
 * Spark uses its public render hook unchanged. The optional depth pre-pass
 * may invoke it again; avoiding that work would couple this controller to the
 * runtime's private render targets and Spark's callback implementation.
 */
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

export type BackdropState = "empty" | "loading" | "ready" | "error";

export interface BackdropTransform {
  /** Offset from the ground-anchored asset; Y=0 places its bottom at ground level. */
  position: [number, number, number];
  /** Euler XYZ, radians. */
  rotation: [number, number, number];
  scale: number;
}

export interface BackdropSettings extends BackdropTransform {
  url: string | null;
  visible: boolean;
}

export const DEFAULT_BACKDROP_SETTINGS: BackdropSettings = {
  url: null,
  visible: true,
  position: [0, 0, 0],
  // Splat captures are authored Y-down relative to three's Y-up, so a half turn
  // about X is the identity orientation for this viewer, not a correction.
  rotation: [Math.PI, 0, 0],
  scale: 4,
};

export interface BackdropControllerOptions {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  /**
   * Draw one frame. The viewer only renders while its clock advances, so a
   * transform changed on a paused viewer is invisible until something else
   * triggers a frame. Supply this to keep edits live while paused.
   */
  requestRender?: () => void;
  /** Fired after any state or settings change, for UI to read back. */
  onChange?: (snapshot: BackdropSnapshot) => void;
}

export interface BackdropSnapshot {
  state: BackdropState;
  settings: BackdropSettings;
  error: string | null;
  /** Splat count of the loaded asset, when the loader reports one. */
  numSplats: number | null;
}

const LOAD_TIMEOUT_MS = 120_000;

export class BackdropController {
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly requestRender?: () => void;
  private readonly onChange?: (snapshot: BackdropSnapshot) => void;

  private spark: SparkRenderer | null = null;
  private splat: SplatMesh | null = null;
  private localBounds: THREE.Box3 | null = null;

  /**
   * Monotonic load token. Every `load()` claims the next value; a load whose
   * token is stale by the time it resolves disposes itself instead of
   * attaching. Without this, two quick replaces can land out of order and
   * leave the losing splat in the scene forever.
   */
  private loadToken = 0;

  private settings: BackdropSettings = { ...DEFAULT_BACKDROP_SETTINGS };
  private stateValue: BackdropState = "empty";
  private errorValue: string | null = null;
  private numSplatsValue: number | null = null;
  private disposed = false;

  private currentObjectUrl: string | null = null;
  private cancelPending: (() => void) | null = null;

  constructor(options: BackdropControllerOptions) {
    this.scene = options.scene;
    this.renderer = options.renderer;
    this.requestRender = options.requestRender;
    this.onChange = options.onChange;
  }

  get snapshot(): BackdropSnapshot {
    return {
      state: this.stateValue,
      settings: { ...this.settings },
      error: this.errorValue,
      numSplats: this.numSplatsValue,
    };
  }

  get hasAsset() {
    return !!this.splat;
  }

  /**
   * Load a splat asset, replacing whatever is currently shown.
   *
   * Resolves to "loaded" when this call's asset is the one on screen, or
   * "superseded" when replaced, removed or disposed. An abandoned initializer
   * is never attached; its payload is disposed when Spark finishes decoding.
   */
  async load(url: string): Promise<"loaded" | "superseded"> {
    return this.loadAsset(url);
  }

  private async loadAsset(url: string, ownedUrl?: string): Promise<"loaded" | "superseded"> {
    if (this.disposed) {
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      throw new Error("BackdropController is disposed");
    }
    this.cancelPending?.();
    const token = ++this.loadToken;
    this.stateValue = "loading";
    this.errorValue = null;
    this.emit();

    let spark: SparkRenderer | null = null;
    let splat: SplatMesh | null = null;
    try {
      splat = await this.loadSplat(url, ownedUrl);
      if (!splat) return "superseded";

      if (token !== this.loadToken) {
        // A newer load won while this one was in flight.
        splat.dispose();
        if (ownedUrl) URL.revokeObjectURL(ownedUrl);
        return "superseded";
      }

      const localBounds = splat.getBoundingBox(false).clone();
      spark = new SparkRenderer({ renderer: this.renderer });
      // Only now tear down the previous asset, so a failed or superseded load
      // never leaves the viewer empty.
      this.detachCurrent();

      this.spark = spark;
      this.splat = splat;
      this.localBounds = localBounds;
      this.scene.add(spark);
      this.scene.add(splat);
      this.currentObjectUrl = ownedUrl ?? null;

      this.settings = { ...this.settings, url };
      this.numSplatsValue = readSplatCount(splat);
      this.applyTransform();
      this.applyVisibility();

      this.stateValue = "ready";
      this.emit();
      this.requestRender?.();
      return "loaded";
    } catch (err) {
      splat?.dispose();
      spark?.dispose();
      if (splat && ownedUrl) URL.revokeObjectURL(ownedUrl);
      if (token === this.loadToken) {
        this.stateValue = this.splat ? "ready" : "error";
        this.errorValue = err instanceof Error ? err.message : String(err);
        this.emit();
      }
      throw err;
    }
  }

  /** Load from a local file; the object URL is owned and revoked by this controller. */
  async loadFile(file: File): Promise<"loaded" | "superseded"> {
    const url = URL.createObjectURL(file);
    return this.loadAsset(url, url);
  }

  setVisible(visible: boolean) {
    this.settings = { ...this.settings, visible };
    this.applyVisibility();
    this.emit();
    this.requestRender?.();
  }

  setTransform(patch: Partial<BackdropTransform>) {
    this.settings = { ...this.settings, ...patch };
    this.applyTransform();
    this.emit();
    this.requestRender?.();
  }

  /**
   * Apply a whole settings object, loading the referenced asset if it differs
   * from what is currently shown. Used to restore persisted settings.
   */
  async applySettings(next: BackdropSettings) {
    const shouldLoad = next.url && next.url !== this.settings.url;
    // The URL describes the committed asset even while a replacement loads.
    this.settings = { ...next, url: this.settings.url };
    if (!next.url) {
      this.remove();
      return;
    }
    this.applyTransform();
    this.applyVisibility();
    this.emit();
    if (shouldLoad && next.url) await this.load(next.url);
    else this.requestRender?.();
  }

  /** Remove the current asset and free it. The controller stays usable. */
  remove() {
    this.loadToken++;
    this.cancelPending?.();
    this.detachCurrent();
    this.settings = { ...this.settings, url: null };
    this.numSplatsValue = null;
    this.stateValue = "empty";
    this.errorValue = null;
    this.emit();
    this.requestRender?.();
  }

  /**
   * Full teardown. Removes only objects this controller added and frees their
   * GPU resources. Pending decoders retain a cleanup continuation (see below).
   * Must run BEFORE the runtime disposes, because the runtime's
   * own `dispose()` ends by disposing the renderer these resources belong to.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadToken++;
    this.cancelPending?.();
    this.detachCurrent();
    this.stateValue = "empty";
  }

  // ---------------------------------------------------------------- internals

  private loadSplat(url: string, ownedUrl?: string): Promise<SplatMesh | null> {
    return new Promise((resolve, reject) => {
      let abandoned = false;
      let mesh: SplatMesh;
      const release = () => {
        mesh?.dispose();
        if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      };
      const finish = () => {
        clearTimeout(timer);
        if (this.cancelPending === cancel) this.cancelPending = null;
      };
      const cancel = () => {
        abandoned = true;
        finish();
        resolve(null);
      };
      const timer = setTimeout(() => {
        abandoned = true;
        finish();
        reject(new Error(`Timed out loading splat after ${LOAD_TIMEOUT_MS}ms`));
      }, LOAD_TIMEOUT_MS);
      this.cancelPending = cancel;
      try {
        mesh = new SplatMesh({ url });
        // Spark 2.2 has no public abort API. Never dispose a mesh while its
        // initializer still owns its buffers: cancellation settles our caller
        // immediately, but this continuation owns and frees the late payload.
        // Keep only this request's object URL alive until decoding settles.
        void mesh.initialized.then(
          () => {
            finish();
            if (abandoned) release();
            else resolve(mesh);
          },
          (err: unknown) => {
            finish();
            release();
            if (!abandoned) reject(err);
          },
        );
      } catch (err) {
        finish();
        release();
        reject(err);
      }
    });
  }

  private detachCurrent() {
    this.localBounds = null;
    if (this.currentObjectUrl) URL.revokeObjectURL(this.currentObjectUrl);
    this.currentObjectUrl = null;
    if (this.splat) {
      this.scene.remove(this.splat);
      this.splat.dispose();
      this.splat = null;
    }
    if (this.spark) {
      this.scene.remove(this.spark);
      this.spark.dispose();
      this.spark = null;
    }
  }

  private applyTransform() {
    if (!this.splat) return;
    const { position, rotation, scale } = this.settings;
    this.splat.position.set(position[0], position[1], position[2]);
    this.splat.rotation.set(rotation[0], rotation[1], rotation[2]);
    this.splat.scale.setScalar(scale);
    this.splat.updateMatrix();
    // Include Gaussian extents, not just centers. Re-anchor after rotation or
    // scale changes without accumulating offsets or altering the effect runtime.
    if (this.localBounds && !this.localBounds.isEmpty()) {
      const bounds = this.localBounds.clone().applyMatrix4(this.splat.matrix);
      if (Number.isFinite(bounds.min.y)) this.splat.position.y += position[1] - bounds.min.y;
    }
    this.splat.updateMatrixWorld(true);
  }

  private applyVisibility() {
    const visible = this.settings.visible;
    if (this.splat) this.splat.visible = visible;
    if (this.spark) this.spark.visible = visible;
  }

  private emit() {
    this.onChange?.(this.snapshot);
  }
}

function readSplatCount(splat: SplatMesh): number | null {
  const direct = (splat as unknown as { numSplats?: number }).numSplats;
  if (typeof direct === "number") return direct;
  const packed = (splat as unknown as { packedSplats?: { numSplats?: number } })
    .packedSplats?.numSplats;
  return typeof packed === "number" ? packed : null;
}
