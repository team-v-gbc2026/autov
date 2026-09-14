"use client";
import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { Reference } from "@/lib/project-types";
import type { ReferenceState } from "../use-references";
import { defaultPosition, useBoardLayout } from "./board-store";
import BoardCard from "./board-card";
import BoardNote from "./board-note";
import { useBoardNotes } from "./use-board-notes";
import ReferencePreview from "./reference-preview";
import IconButton from "../icon-button";
import Tooltip from "@/components/ui/tooltip";
import styles from "./board.module.css";

export default function MoodBoard({ projectId, state, onMention, onCollapse, locked }: {
  projectId: string; state: ReferenceState; onMention: (reference: Reference) => void; onCollapse: () => void; locked: boolean;
}) {
  const { layout, update, persist } = useBoardLayout(projectId);
  const { notes, change: changeNotes } = useBoardNotes(projectId);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [nativeSizes, setNativeSizes] = useState<Record<string, { width: number; height: number }>>({});
  const viewport = useRef<HTMLDivElement>(null);
  const transform = useRef<ReactZoomPanPinchRef>(null);
  const known = useRef(new Set(state.references.map(item => item.id)));
  const refs = state.references;
  const sizes: Record<string, { width: number; height: number }> = Object.fromEntries(refs.map(ref => {
    const saved = layout[ref.id];
    const width = saved?.width;
    const height = saved?.height;
    const valid = typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    return [ref.id, valid ? { width, height } : nativeSizes[ref.id] || { width: 160, height: 116 }];
  }));
  const positions = refs.map((ref, index) => {
    if (layout[ref.id]) return layout[ref.id];
    const column = index % 3;
    const row = Math.floor(index / 3);
    let x = 24;
    let y = 24;
    for (let c = 0; c < column; c++) x += Math.max(0, ...refs.filter((_, i) => i % 3 === c).map(item => (sizes[item.id]?.width || 160) + 2)) + 20;
    for (let r = 0; r < row; r++) y += Math.max(...refs.slice(r * 3, r * 3 + 3).map(item => (sizes[item.id]?.height || 116) + 2)) + 20;
    return { x, y };
  });
  const preview = refs.find(item => item.id === previewId);
  const reportPersistence = () => { if (!persist()) state.setError("Board arrangement could not be saved in this browser."); };

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLTextAreaElement && event.target.scrollHeight > event.target.clientHeight) return;
      event.preventDefault();
      const api = transform.current;
      if (api) api.setTransform(api.state.positionX - event.deltaX, api.state.positionY - event.deltaY, api.state.scale, 0);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const occupied = refs.filter(ref => known.current.has(ref.id)).map(ref => ({ ...(positions[refs.indexOf(ref)]), width: (sizes[ref.id]?.width || 160) + 2, height: (sizes[ref.id]?.height || 116) + 2 }));
    for (const ref of refs) {
      if (known.current.has(ref.id)) continue;
      if (!nativeSizes[ref.id]) continue;
      known.current.add(ref.id);
      if (layout[ref.id]) continue;
      const view = transform.current?.state;
      let x = view ? (20 - view.positionX) / view.scale : 24;
      const y = view ? (20 - view.positionY) / view.scale : 24;
      const width = sizes[ref.id].width + 2;
      const height = sizes[ref.id].height + 2;
      let collision;
      while ((collision = occupied.find(p => x < p.x + p.width + 20 && x + width + 20 > p.x && y < p.y + p.height + 20 && y + height + 20 > p.y))) {
        x = collision.x + collision.width + 20;
      }
      occupied.push({ x, y, width, height }); update(ref.id, { x, y }); persist();
    }
  }, [refs, layout, sizes, nativeSizes, positions, update, persist]);
  function addNote() {
    const view = transform.current?.state;
    const id = crypto.randomUUID();
    const offset = (notes.length % 5) * 20;
    const note = { id, text: "", width: 240 / (view?.scale || 1), height: 190 / (view?.scale || 1), fontSize: 14 / (view?.scale || 1), x: view ? (24 + offset - view.positionX) / view.scale : 24, y: view ? (24 + offset - view.positionY) / view.scale : 24 };
    if (!changeNotes(current => [...current, note])) state.setError("Notes could not be saved in this browser.");
    setActiveNote(id);
  }
  function fitAll() {
    const api = transform.current; const el = viewport.current;
    if (!api || !el) return;
    const elements = Array.from(el.querySelectorAll<HTMLElement>(".board-card"));
    if (!elements.length) { api.resetTransform(); return; }
    const viewportRect = el.getBoundingClientRect();
    const bounds = elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { x: (rect.left - viewportRect.left - api.state.positionX) / api.state.scale, y: (rect.top - viewportRect.top - api.state.positionY) / api.state.scale, width: rect.width / api.state.scale, height: rect.height / api.state.scale };
    });
    const minX = Math.min(...bounds.map(p => p.x)); const minY = Math.min(...bounds.map(p => p.y));
    const width = Math.max(...bounds.map(p => p.x + p.width)) - minX;
    const height = Math.max(...bounds.map(p => p.y + p.height)) - minY;
    const zoom = Math.max(.001, Math.min(1, (el.clientWidth - 32) / width, (el.clientHeight - 32) / height));
    api.setTransform((el.clientWidth - width * zoom) / 2 - minX * zoom, (el.clientHeight - height * zoom) / 2 - minY * zoom, zoom, 150);
  }
  return <aside className={`glass ${styles.panel} ${expanded ? styles.expanded : ""}`}>
    <div className="panel-heading"><div><h2>Board</h2><span className="count">{refs.length + notes.length}</span></div><div>
      <Tooltip content="Generate images" side="bottom"><button type="button" className={styles.smallButton} aria-label="Generate images" disabled={state.busy || locked} onClick={() => setGenerating(true)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /></svg></button></Tooltip>
      <Tooltip content="Add note" side="bottom"><button type="button" className={styles.smallButton} aria-label="Add note" disabled={locked} onClick={addNote}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10l-7-7Z M14 3v7h7M7 14h10M7 17h6" /></svg></button></Tooltip>
      <Tooltip content={expanded ? "Minimize board" : "Expand board"} side="bottom"><button className={styles.smallButton} aria-label={expanded ? "Minimize board" : "Expand board"} onClick={() => setExpanded(!expanded)}>{expanded ? "↙" : "↗"}</button></Tooltip>
      <IconButton name="panel" label="Collapse board" onClick={onCollapse} />
    </div></div>
    <div ref={viewport} className={styles.viewport} tabIndex={0} aria-label="Reference mood board. Drag images to arrange, drag background to pan. Scroll to move, control-scroll to zoom."
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const api = transform.current;
        const directions: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (api && directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; api.setTransform(api.state.positionX + x, api.state.positionY + y, api.state.scale, 0); }
      }}
      >
      <TransformWrapper ref={transform} minScale={.001} maxScale={2.5} limitToBounds={false} centerZoomedOut={false} panning={{ excluded: ["board-card"], velocityDisabled: true }} wheel={{ step: 0.005, activationKeys: keys => keys.includes("Control") || keys.includes("Meta") }} doubleClick={{ disabled: true }} onTransform={(_api, view) => setScale(view.scale)}>
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%" }}>
          <div className={styles.plane}>{refs.map((reference, index) => <BoardCard key={reference.id} reference={reference} position={positions[index]} size={sizes[reference.id] || { width: 160, height: 116 }} onSize={size => setNativeSizes(current => current[reference.id]?.width === size.width && current[reference.id]?.height === size.height ? current : { ...current, [reference.id]: size })} scale={scale} onResize={(size, corner) => update(reference.id, { ...positions[index], ...size, x: positions[index].x + (corner.endsWith("left") ? sizes[reference.id].width - size.width : 0), y: positions[index].y + (corner.startsWith("top") ? sizes[reference.id].height - size.height : 0) })} onMove={position => update(reference.id, position)} onStop={reportPersistence} onRename={name => { update(reference.id, { ...positions[index], name }); reportPersistence(); }} onPreview={() => setPreviewId(reference.id)} onMention={() => { onMention(reference); setExpanded(false); }} onError={() => state.setError("Image unavailable. Reopen this project to refresh image links.")} disabled={locked} />)}{notes.map(note => <BoardNote key={note.id} note={note} scale={scale} autoFocus={activeNote === note.id} disabled={locked} onChange={patch => { if (!changeNotes(current => current.map(item => item.id === note.id ? { ...item, ...patch } : item))) state.setError("Notes could not be saved in this browser."); }} onRemove={() => { if (!changeNotes(current => current.filter(item => item.id !== note.id))) state.setError("Notes could not be saved in this browser."); }} />)}</div>
        </TransformComponent>
      </TransformWrapper>
      {!refs.length && !notes.length && <p className={styles.empty}>No references yet<small>Add a reference image from the Backdrop panel, or generate one above.</small></p>}
    </div>
    <div className={styles.toolbar}><Tooltip content="Fit board" side="top"><button className={styles.smallButton} onClick={fitAll} aria-label="Fit board"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" /><rect x="8" y="8" width="8" height="8" rx="1" /></svg></button></Tooltip><div><button aria-label="Zoom out" onClick={() => transform.current?.zoomOut(0.04)}>−</button><span>{Math.round(scale * 100)}%</span><button aria-label="Zoom in" onClick={() => transform.current?.zoomIn(0.04)}>+</button></div></div>
    {(state.busy || state.error) && <div className={styles.notice} role={state.error ? "alert" : "status"}>{state.error || "Uploading..."}</div>}
    {generating && <ReferencePreview reference={null} disabled={locked} onClose={() => setGenerating(false)} onRename={() => {}} onMention={() => {}} onRemove={() => {}} />}
    {preview && <ReferencePreview key={preview.id} reference={preview} disabled={state.busy || locked} onClose={() => setPreviewId(null)} onRename={name => {
      const position = positions[refs.findIndex(ref => ref.id === preview.id)] || defaultPosition(0);
      update(preview.id, { ...position, name }); reportPersistence();
    }} onMention={() => { onMention(preview); setPreviewId(null); setExpanded(false); }} onRemove={() => { void state.removeReference(preview.id); setPreviewId(null); }} />}
  </aside>;
}
