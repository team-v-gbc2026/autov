import Mention from "@tiptap/extension-mention";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { createContext, useContext } from "react";
import type { VfxLayer } from "@/components/vfx-studio/ui-model";

export type EmitterTag = Pick<VfxLayer, "id" | "name" | "color">;
export const EmitterContext = createContext<EmitterTag[]>([]);

function EmitterChip({ node }: NodeViewProps) {
  const emitter = useContext(EmitterContext).find(item => item.id === node.attrs.id);
  const label = emitter?.name || node.attrs.label || "Emitter";
  return <NodeViewWrapper as="span" className={`reference-chip emitter-chip ${emitter ? "" : "reference-chip-error"}`} contentEditable={false} data-drag-handle>
    <span className="reference-chip-label" title={emitter ? `Emitter ${label}` : "Emitter is no longer available"}>
      <span aria-hidden="true" style={{ color: emitter?.color }}>#</span>{label}
    </span>
  </NodeViewWrapper>;
}

export const EmitterMention = Mention.extend({
  name: "emitterMention",
  draggable: true,
  parseHTML() { return [{ tag: 'span[data-type="emitterMention"]' }]; },
  addNodeView() { return ReactNodeViewRenderer(EmitterChip); },
});
