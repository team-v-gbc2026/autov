import { validateWorkspaceDocumentV2, type VfxDocumentV2 } from "./schema-v2";
import type { EffectPath } from "./effect-path";
export type CurvePoint = { pathId: string; index: number };

/** Draft paths never mutate the applied document. Only Apply validates and
 * produces a replacement; one bounded undo entry is recorded per replacement. */
export class CurveEditModel {
  private history: VfxDocumentV2[] = [];
  private draft: EffectPath[];
  constructor(private document: VfxDocumentV2) {
    this.draft = structuredClone(document.paths ?? []);
  }
  get paths() {
    return this.draft;
  }
  get dirty() {
    return (
      JSON.stringify(this.draft) !== JSON.stringify(this.document.paths ?? [])
    );
  }
  get canUndo() {
    return this.history.length > 0;
  }
  replaceDocument(next: VfxDocumentV2) {
    if (next === this.document) return false;
    this.document = next;
    this.history = [];
    this.cancel();
    return true;
  }
  move(point: CurvePoint, position: [number, number, number]) {
    const path = this.draft.find((p) => p.id === point.pathId);
    if (!path?.points[point.index] || !position.every(Number.isFinite)) return;
    path.points[point.index] = [...position];
  }
  cancel() {
    this.draft = structuredClone(this.document.paths ?? []);
  }
  apply(): VfxDocumentV2 | null {
    if (!this.dirty) return null;
    const next = validateWorkspaceDocumentV2({
      ...this.document,
      paths: this.draft,
    });
    this.history.push(this.document);
    if (this.history.length > 50) this.history.shift();
    this.document = next;
    this.cancel();
    return next;
  }
  undo(): VfxDocumentV2 | null {
    const previous = this.history.pop();
    if (!previous) return null;
    this.document = previous;
    this.cancel();
    return previous;
  }
}
