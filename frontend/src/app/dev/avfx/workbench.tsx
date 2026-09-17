"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import WorkspaceScene from "@/components/studio/workspace-scene";
import { PlaybackFrames, usePlaybackClock } from "@/components/studio/playback-clock";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import { AVFX_GEOMETRY_KINDS as GEOMETRY, isAvfxKind as inScope } from "@/lib/avfx/kinds";
import styles from "./workbench.module.css";

export default function Workbench({ document }: { document: VfxDocumentV2 }) {
  const [scopeOnly, setScopeOnly] = useState(true);
  const [solo, setSolo] = useState<string>();
  const [focusRequest, setFocusRequest] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const clock = usePlaybackClock(document.duration);
  const preview = useMemo(() => scopeOnly
    ? { ...document, layers: document.layers.filter(layer => inScope(layer.kind)) }
    : document, [document, scopeOnly]);
  const particles = document.layers.filter(layer => layer.kind === "particles").length;
  const geometry = document.layers.filter(layer => GEOMETRY.has(layer.kind)).length;
  const excluded = document.layers.length - particles - geometry;
  async function downloadBundle() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    setExportStatus("Preparing export…");
    const release = clock.hold();
    try {
      const { exportAvfx } = await import("@/lib/avfx/export");
      // Export the full input through the scope validator, independent of solo
      // and preview toggles, so exclusions remain recorded in the manifest.
      const result = await exportAvfx(document, { onProgress: setExportStatus });
      const url = URL.createObjectURL(new Blob([result.bytes], { type: "application/zip" }));
      const link = window.document.createElement("a");
      link.href = url;
      link.download = result.filename;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setExportStatus(`Downloaded ${result.filename} · ${result.fileCount} files · ${(result.bytes.length / 1024 / 1024).toFixed(2)} MiB. ${result.manifest.excluded.length} layer(s) excluded.`);
    } catch (error) {
      setExportStatus("");
      setExportError(error instanceof Error ? error.message : "AVFX export failed.");
    } finally { release(); setExporting(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/dev">← Dev utilities</Link><p className={styles.eyebrow}>INTERCHANGE LAB / FIRST PASS</p><h1>.avfx <span>export workbench</span></h1></div>
      <div className={styles.stage}>01 / SOURCE INSPECTION</div>
    </header>
    <div className={styles.layout}>
      <section className={styles.preview} aria-label="Source preview">
        <div className={styles.toolbar}><div><strong>Fire projectile</strong><span>Browser source · WebGPU</span></div><button onClick={() => setFocusRequest(value => value + 1)}>Reset framing</button></div>
        <div className={styles.canvas}>
          <WorkspaceScene doc={preview} clock={clock} solo={solo} focusRequest={focusRequest} />
          <div className={styles.caption}>{scopeOnly ? "PARTICLES + GEOMETRY" : "FULL SOURCE"} / NOT A BUNDLE PLAYBACK</div>
        </div>
        <PlaybackFrames clock={clock}>{playback => <div className={styles.playback}>
          <button onClick={() => playback.setPlaying(value => !value)}>{playback.playing ? "Pause" : "Play"}</button>
          <button onClick={() => playback.setTime(0)}>Restart</button>
          <input aria-label="Preview time" type="range" min={0} max={document.duration} step={0.01} value={playback.time} onChange={event => { playback.setPlaying(false); playback.setTime(Number(event.target.value)); }} />
          <output>{playback.time.toFixed(2)} / {document.duration.toFixed(2)} s</output>
        </div>}</PlaybackFrames>
        <div className={styles.options}>
          <label><input type="checkbox" checked={scopeOnly} onChange={event => { setScopeOnly(event.target.checked); setSolo(undefined); }} /> Preview only in-scope layers</label>
          <span>Authored environment & post-processing retained</span>
        </div>
      </section>
      <aside className={styles.sidebar}>
        <section className={styles.panel}>
          <p className={styles.eyebrow}>EXPORT SCOPE</p>
          <h2>Particles + geometry</h2>
          <p>Ring, shell, trail, beam, sprite and decal. Generators are excluded from this pass.</p>
          <div className={styles.counts}><div><strong>{particles}</strong>particles</div><div><strong>{geometry}</strong>geometry</div><div><strong>{excluded}</strong>excluded</div></div>
          <div className={styles.layerHeading}><h3>Source layers</h3><button onClick={() => setSolo(undefined)} disabled={!solo}>Show all</button></div>
          <ul className={styles.layers}>{document.layers.map(layer => <li key={layer.id}>
            <button aria-pressed={solo === layer.id} disabled={!layer.enabled || (scopeOnly && !inScope(layer.kind))} onClick={() => setSolo(solo === layer.id ? undefined : layer.id)}>
              <span>{layer.name || layer.id}<small>{layer.kind}{!layer.enabled ? " · disabled" : ""}</small></span>
              <em>{inScope(layer.kind) ? "in scope" : "excluded"}</em>
            </button>
          </li>)}</ul>
          <p className={styles.note}>Select a layer to isolate it. The source light is excluded; visual differences are expected without it.</p>
        </section>
        <section className={styles.panel}>
          <p className={styles.eyebrow}>BUNDLE PIPELINE</p>
          <h2>Document → .avfx → adapter</h2>
          <p>The AI authors the document. Our exporter packages the meshes, particle attributes, textures, shader parameters and timing.</p>
          <button className={styles.export} disabled={exporting} onClick={downloadBundle} aria-describedby="export-status">{exporting ? "Building bundle…" : "Export .avfx"}</button>
          <p id="export-status" className={styles.note} role="status">{exportStatus || "Exports all enabled particle and geometry layers, regardless of preview or solo selection. Engine adapter and parity validation are still pending."}</p>
          {exportError && <p role="alert">{exportError}</p>}
        </section>
      </aside>
    </div>
    <details className={styles.source}><summary>Inspect source document · {document.schemaVersion} · seed {document.seed}</summary><pre>{JSON.stringify(document, null, 2)}</pre></details>
  </main>;
}
