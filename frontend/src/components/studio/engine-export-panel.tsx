"use client";
import { useEffect, useRef, useState } from "react";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";

export default function EngineExportPanel({ doc }: { doc: VfxDocumentV2 }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => controller.current?.abort(), []);
  async function run() {
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError(""); setProgress(0);
    try {
      const { exportEngineBundle } = await import("@/lib/vfx-lab/engine-export/export");
      const { blob, manifest } = await exportEngineBundle(doc, { fps, signal: current.signal,
        onProgress: (text, p) => { setMessage(text); setProgress(p); } });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `${doc.name.replace(/[^a-zA-Z0-9_-]+/g, "-") || "effect"}-3d.avfx.zip`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(`Exported ${manifest.draws.length} 3D draws. Extract the ZIP and follow README.md.`);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") setMessage("Export cancelled.");
      else setError(e instanceof Error ? e.message : "3D export failed.");
    } finally { setBusy(false); controller.current = null; }
  }
  return <>
    <button type="button" className="engine-export-trigger" onClick={() => dialog.current?.showModal()}>Export 3D</button>
    <dialog ref={dialog} className="engine-export-dialog" onCancel={event => { if (busy) { event.preventDefault(); controller.current?.abort(); } }}>
      <h2>Export to game engines</h2>
      <p>Native 3D meshes, particles and shaders for Unity and Godot. Includes a ready-to-run Godot scene and a Unity prefab importer.</p>
      <p>Camera rotation is supported. Engine post-processing and soft intersection fading are separate; transparency sorting can differ when orbiting. Compare the included reference images before shipping.</p>
      <label>Animation sampling <select value={fps} disabled={busy} onChange={e => setFps(Number(e.target.value))}><option value={15}>15 Hz · smaller files</option><option value={30}>30 Hz · balanced</option><option value={60}>60 Hz · finer motion</option></select></label>
      <p>Particle motion is evaluated by native shaders. Sampling applies to authored parameter changes and CPU-generated geometry.</p>
      {busy && <progress value={progress} max={1} aria-label="Export progress" />}
      <p role="status">{message}</p>
      {error && <p role="alert">{error}</p>}
      <div className="engine-export-actions"><button type="button" onClick={() => busy ? controller.current?.abort() : dialog.current?.close()}>{busy ? "Cancel export" : "Close"}</button><button type="button" disabled={busy || !doc.layers.length} onClick={run}>{busy ? "Exporting…" : "Download 3D bundle"}</button></div>
    </dialog>
    <style jsx>{`
      .engine-export-trigger {border:1px solid #58666b;border-radius:6px;padding:8px 12px;background:#233136;color:#e4eeeb;cursor:pointer}
      .engine-export-dialog {max-width:560px;width:calc(100% - 40px);border:1px solid #566266;border-radius:12px;padding:28px;background:#182024;color:#edf3f1;font:14px/1.6 system-ui}
      .engine-export-dialog::backdrop {background:#0009}
      h2 {margin:0;font-size:22px} p {color:#b8c9c8} label {display:flex;justify-content:space-between;align-items:center;gap:12px}
      select,button {font:inherit;padding:8px 12px;border-radius:6px;border:1px solid #5b6e70;background:#25363a;color:#eef4f2}
      progress {width:100%;margin-top:16px} [role=alert] {color:#ffb4a5} .engine-export-actions {display:flex;justify-content:flex-end;gap:10px;margin-top:20px} button:disabled {opacity:.5}
    `}</style>
  </>;
}
