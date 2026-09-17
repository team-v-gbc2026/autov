"use client";

import { useRef, useState } from "react";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import { hasOnlyAvfxLayers } from "@/lib/avfx/kinds";
import Icon from "./icon";

export default function AvfxExportButton({ document, disabled = false }: {
  document: VfxDocumentV2;
  disabled?: boolean;
}) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  if (!hasOnlyAvfxLayers(document.layers)) return null;

  async function download() {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setStatus("Preparing AVFX export…");
    try {
      const { exportAvfx } = await import("@/lib/avfx/export");
      // Export the complete document, not the current frame or solo selection.
      const result = await exportAvfx(document, { onProgress: setStatus });
      const url = URL.createObjectURL(new Blob([result.bytes], { type: "application/zip" }));
      try {
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = result.filename;
        window.document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      setStatus(`Downloaded ${result.filename}. Disabled layers are omitted; environment and post-processing are reference only. Engine adapter support varies.`);
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "AVFX export failed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="lab-avfx-export" disabled={disabled || busy}
      aria-label={busy ? "Building AVFX bundle" : "Export .avfx"} aria-busy={busy}
      title="Export particle and geometry layers as .avfx. Engine adapter support varies; environment and post-processing are not recreated."
      onClick={() => void download()}>
      <Icon name="download" size={16} />
      <span>{busy ? "Exporting…" : ".avfx"}</span>
    </button>
    <span className="lab-export-announcement" role="status">{status}</span>
    {error && <p className="lab-scene-export-error" role="alert">{error}</p>}
  </>;
}
