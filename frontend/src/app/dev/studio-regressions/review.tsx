"use client";
import { useState } from "react";
import WorkspaceScene from "@/components/studio/workspace-scene";
import { usePlaybackClock } from "@/components/studio/playback-clock";
import { createWorkspaceDocument } from "@/lib/vfx-lab/ui-bridge";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";
import "@/components/vfx-studio/studio-ui.css";

/** Deterministic review of the empty-to-generated transition; no account writes. */
export default function Review({ fixture }: { fixture: VfxDocumentV2 }) {
  const [doc, setDoc] = useState(() => createWorkspaceDocument("Empty regression scene"));
  const [focus, setFocus] = useState(0);
  const [panels, setPanels] = useState(true);
  const clock = usePlaybackClock(doc.duration);
  const install = () => { setDoc(structuredClone(fixture)); clock.getSnapshot().setTime(2); clock.getSnapshot().setPlaying(false); };
  return <>
    <header style={{ display: "flex", gap: 16, padding: 16, flexWrap: "wrap" }}>
      <a href="/dev">Dev utilities</a><strong>Studio regression review · #47 / #48</strong>
      <button onClick={install}>Load generated scene</button>
      <button onClick={() => setDoc(createWorkspaceDocument())}>Reset to empty</button>
      <button onClick={() => setDoc(value => ({ ...value, camera: { ...value.camera, azimuth: value.camera.azimuth + Math.PI / 2 } }))}>Rotate authored camera</button>
      <button onClick={() => setDoc(value => ({ ...value, environment: { ...value.environment, background: "#351048" } }))}>Set purple background</button>
      <button onClick={() => setPanels(value => !value)}>Toggle panels</button>
      <button onClick={() => setFocus(value => value + 1)}>Focus</button>
      <output>{doc.layers.length} layers · {doc.environment.background}</output>
    </header>
    <main className="studio lab" style={{ position: "relative", height: "85vh", minHeight: 600 }}>
      <div className="lab-preview-stage"><WorkspaceScene doc={doc} clock={clock} focusRequest={focus} loaded /></div>
      {panels && <>
        <aside style={{ position: "absolute", left: 0, top: 0, bottom: 160, width: 250, background: "#111c", padding: 20 }}>Reference board</aside>
        <aside className="chat-panel" style={{ position: "absolute", right: 0, top: 0, bottom: 160, width: 300, background: "#111c", padding: 20 }}>Assistant panel</aside>
        <section id="playback-timeline" style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 150, background: "#111c", padding: 20 }}>Timeline</section>
      </>}
    </main>
  </>;
}
