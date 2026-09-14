import type { VfxDocumentV2 } from "../vfx-lab/schema-v2";

/** Data supplied by the adapter after it verifies user/project ownership.
 * Browser document snapshots are untrusted input, never authorization evidence.
 */
export type StudioToolContext = {
  userId: string;
  projectId: string;
  snapshot: {
    document: VfxDocumentV2;
    revision: number;
    selectedEmitterId: string | null;
  };
};

export type StudioToolResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE";
        message: string;
      };
    };

/** Framework-independent operation. Validate input before changing any state.
 * TInput describes parsed input; each operation owns its runtime parser.
 */
export type StudioTool<TInput, TOutput> = {
  description: string;
  parse: (input: unknown) => TInput;
  execute: (
    input: TInput,
    context: StudioToolContext,
  ) => StudioToolResult<TOutput> | Promise<StudioToolResult<TOutput>>;
};
