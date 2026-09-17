"use client";

import { useRef, useState } from "react";
import Tooltip from "@/components/ui/tooltip";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import { hasExportableAvfxLayers, isAvfxKind } from "@/lib/avfx/kinds";
import Icon from "./icon";

export default function AvfxExportButton({ document, disabled = false }: {
  document: VfxDocumentV2;
  disabled?: boolean;
}) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const eligible = hasExportableAvfxLayers(document.layers);
  const excluded = document.layers.filter(layer => layer.enabled && !isAvfxKind(layer.kind));
  const warning = excluded.length
    ? `Cannot export these layers; they will be excluded: ${excluded.map(layer => `${layer.name || layer.id} (${layer.kind})`).join(", ")}.`
    : "";
  const unavailableReason = !document.layers.some(layer => layer.enabled)
    ? "Add or enable an effect layer to export .avfx."
    : !eligible
      ? "AVFX export supports particle, ring, shell, trail, beam, sprite and decal layers only."
      : "";

  async function download() {
    if (lock.current || disabled || !eligible) return;
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

  return <div className="lab-export-control">
    <Tooltip side="bottom" content={[warning, unavailableReason, "Disabled layers are omitted; environment and post-processing are reference only."].filter(Boolean).join(" ")}>
    <button type="button" className="lab-avfx-export" disabled={disabled || busy || !eligible}
      aria-label={busy ? "Building AVFX bundle" : "Export .avfx"} aria-busy={busy}
      onClick={() => void download()}>
      <Icon name="download" size={16} />
      <span>{busy ? "Exporting…" : "Export .avfx"}</span>
      {warning && <svg className="lab-export-warning" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M10.3 3.9a2 2 0 0 1 3.4 0l8 14A2 2 0 0 1 20 21H4a2 2 0 0 1-1.7-3.1z" />
        <path d="M12 8v5m0 3v1" stroke="#17191b" strokeWidth="2" strokeLinecap="round" />
      </svg>}
    </button>
    </Tooltip>
    <span className="lab-export-announcement" role="status">{status}</span>
    {error && <p className="lab-scene-export-error" role="alert">{error}</p>}
  </div>;
}
