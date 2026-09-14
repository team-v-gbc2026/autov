import type { CurvePoint } from "./curve-edit-model";
export type CurveEditSnapshot = {
  active: boolean;
  dirty: boolean;
  dragging: boolean;
  canUndo: boolean;
  selected: CurvePoint | null;
  error: string;
};
export const EMPTY_CURVE_EDIT: CurveEditSnapshot = {
  active: false,
  dirty: false,
  dragging: false,
  canUndo: false,
  selected: null,
  error: "",
};
