"use client";
import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { Reference } from "@/lib/project-types";
import type { ReferenceState } from "../use-references";
import { defaultPosition, useBoardLayout } from "./board-store";
import BoardCard from "./board-card";
import ReferencePreview from "./reference-preview";
import IconButton from "../icon-button";
import Tooltip from "@/components/ui/tooltip";
import styles from "./board.module.css";

export default function MoodBoard({ projectId, state, onMention, onCollapse, locked }: {
  projectId: string; state: ReferenceState; onMention: (reference: Reference) => void; onCollapse: () => void; locked: boolean;
}) {
  const { layout, update, persist } = useBoardLayout(projectId);
  const [expanded, setExpanded] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [drop, setDrop] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const transform = useRef<ReactZoomPanPinchRef>(null);
  const input = useRef<HTMLInputElement>(null);
  const known = useRef(new Set(state.references.map(item => item.id)));
  const refs = state.references;
  const preview = refs.find(item => item.id === previewId);
  const reportPersistence = () => { if (!persist()) state.setError("Board arrangement could not be saved in this browser."); };

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const api = transform.current;
      if (api) api.setTransform(api.state.positionX - event.deltaX, api.state.positionY - event.deltaY, api.state.scale, 0);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const occupied = refs.map((ref, index) => layout[ref.id] || defaultPosition(index));
    for (const ref of refs) {
      if (known.current.has(ref.id)) continue;
      known.current.add(ref.id);
      if (layout[ref.id]) continue;
      const view = transform.current?.state;
      let x = view ? (20 - view.positionX) / view.scale : 24;
      let y = view ? (20 - view.positionY) / view.scale : 24;
      let attempts = 0;
      while (occupied.some(p => Math.abs(p.x - x) < 176 && Math.abs(p.y - y) < 166) && attempts++ < 1000) {
        y += 174;
        if (attempts % 3 === 0) { x += 180; y = view ? (20 - view.positionY) / view.scale : 24; }
      }
      occupied.push({ x, y }); update(ref.id, { x, y }); persist();
    }
  }, [refs, layout, update, persist]);
  function fitAll() {
    const api = transform.current; const el = viewport.current;
    if (!api || !el) return;
    if (!refs.length) { api.resetTransform(); return; }
    const positions = refs.map((ref, i) => layout[ref.id] || defaultPosition(i));
    const minX = Math.min(...positions.map(p => p.x)); const minY = Math.min(...positions.map(p => p.y));
    const width = Math.max(...positions.map(p => p.x + 160)) - minX;
    const height = Math.max(...positions.map(p => p.y + 150)) - minY;
    const zoom = Math.max(.15, Math.min(1.5, (el.clientWidth - 32) / width, (el.clientHeight - 32) / height));
    api.setTransform((el.clientWidth - width * zoom) / 2 - minX * zoom, (el.clientHeight - height * zoom) / 2 - minY * zoom, zoom, 150);
  }
  return <aside className={`glass ${styles.panel} ${expanded ? styles.expanded : ""}`}>
    <div className="panel-heading"><div><h2>Board</h2><span className="count">{refs.length}</span></div><div>
      <Tooltip content="Add images" side="bottom"><IconButton name="plus" label="Add images" disabled={state.busy || locked} onClick={() => input.current?.click()} /></Tooltip>
      <Tooltip content={expanded ? "Minimize board" : "Expand board"} side="bottom"><button className={styles.smallButton} aria-label={expanded ? "Minimize board" : "Expand board"} onClick={() => setExpanded(!expanded)}>{expanded ? "↙" : "↗"}</button></Tooltip>
      <IconButton name="panel" label="Collapse board" onClick={onCollapse} />
    </div></div>
    <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void state.addFiles(event.target.files); event.target.value = ""; }} />
    <div ref={viewport} className={`${styles.viewport} ${drop ? styles.dropping : ""}`} tabIndex={0} aria-label="Reference mood board. Drag images to arrange, drag background to pan. Scroll to move, control-scroll to zoom."
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const api = transform.current;
        const directions: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (api && directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; api.setTransform(api.state.positionX + x, api.state.positionY + y, api.state.scale, 0); }
      }}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDrop(true); } }}
      onDragLeave={() => setDrop(false)} onDrop={event => { event.preventDefault(); setDrop(false); if (!locked) void state.addFiles(event.dataTransfer.files); }}>
      <TransformWrapper ref={transform} minScale={.15} maxScale={2.5} limitToBounds={false} centerZoomedOut={false} panning={{ excluded: ["board-card"], velocityDisabled: true }} wheel={{ activationKeys: keys => keys.includes("Control") || keys.includes("Meta") }} doubleClick={{ disabled: true }} onTransform={(_api, view) => setScale(view.scale)}>
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%" }}>
          <div className={styles.plane}>{refs.map((reference, index) => <BoardCard key={reference.id} reference={reference} position={layout[reference.id] || defaultPosition(index)} scale={scale} onMove={position => update(reference.id, position)} onStop={reportPersistence} onPreview={() => setPreviewId(reference.id)} onMention={() => { onMention(reference); setExpanded(false); }} onError={() => state.setError("Image unavailable. Reopen this project to refresh image links.")} disabled={locked} />)}</div>
        </TransformComponent>
      </TransformWrapper>
      {!refs.length && <button className={styles.empty} disabled={state.busy || locked} onClick={() => input.current?.click()}><span>+</span>Add images<small>Drop images or browse</small></button>}
    </div>
    <div className={styles.toolbar}><Tooltip content="Fit all references" side="top"><button onClick={fitAll}>Fit all</button></Tooltip><div><button aria-label="Zoom out" onClick={() => transform.current?.zoomOut()}>−</button><span>{Math.round(scale * 100)}%</span><button aria-label="Zoom in" onClick={() => transform.current?.zoomIn()}>+</button></div></div>
    {(state.busy || state.error) && <div className={styles.notice} role={state.error ? "alert" : "status"}>{state.error || "Uploading..."}</div>}
    {preview && <ReferencePreview key={preview.id} reference={preview} disabled={state.busy || locked} onClose={() => setPreviewId(null)} onRename={name => {
      const position = layout[preview.id] || defaultPosition(refs.findIndex(ref => ref.id === preview.id));
      update(preview.id, { ...position, name }); reportPersistence();
    }} onMention={() => { onMention(preview); setPreviewId(null); setExpanded(false); }} onRemove={() => { void state.removeReference(preview.id); setPreviewId(null); }} />}
  </aside>;
}
