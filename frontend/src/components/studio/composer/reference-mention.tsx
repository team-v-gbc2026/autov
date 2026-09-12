import Mention from "@tiptap/extension-mention";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { createContext, useContext } from "react";
import Image from "next/image";
import type { Reference } from "@/lib/project-types";
import Tooltip from "@/components/ui/tooltip";

export const ReferenceContext = createContext<{ references: Reference[]; retry: (id: string) => void }>({ references: [], retry: () => {} });
function ReferenceChip({ node }: NodeViewProps) {
  const { references, retry } = useContext(ReferenceContext);
  const reference = references.find(ref => ref.id === node.attrs.id);
  const pending = node.attrs.status === "uploading";
  const failed = node.attrs.status === "failed";
  const missing = !reference && !pending && !failed;
  const label = reference?.name || node.attrs.label || "Reference";
  return <NodeViewWrapper as="span" className={`reference-chip ${failed || missing ? "reference-chip-error" : ""}`} contentEditable={false} data-drag-handle>
    <Tooltip content={reference ? <span className="reference-chip-preview"><Image unoptimized width={160} height={110} src={reference.url} alt={label} /><span>{label}</span></span> : pending ? "Uploading image" : failed ? "Click to retry upload" : "Reference removed from board"} side="top">
      <button type="button" className="reference-chip-label" onClick={() => { if (failed) retry(node.attrs.id); }} aria-label={failed ? `Retry ${label}` : `Reference ${label}`}>
        {pending ? "Uploading " : failed ? "Retry " : "@"}{label}
      </button>
    </Tooltip>
  </NodeViewWrapper>;
}
export const ReferenceMention = Mention.extend({
  draggable: true,
  addAttributes() { return { ...this.parent?.(), status: { default: "ready" } }; },
  addNodeView() { return ReactNodeViewRenderer(ReferenceChip); },
});
