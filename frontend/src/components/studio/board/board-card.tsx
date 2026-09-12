"use client";
import Image from "next/image";
import ImageResizeHandle, { type ResizeCorner } from "./image-resize-handle";
import { useRef, useState } from "react";
import Draggable from "react-draggable";
import type { Reference } from "@/lib/project-types";
import type { BoardItem } from "./board-store";
import Tooltip from "@/components/ui/tooltip";
import styles from "./board.module.css";

export default function BoardCard({ reference, position, size, scale, onSize, onResize, onMove, onStop, onPreview, onMention, onRename, onError, disabled }: {
  reference: Reference; position: BoardItem; scale: number; onMove: (position: BoardItem) => void; onStop: () => void;
  size: { width: number; height: number }; onSize: (size: { width: number; height: number }) => void;
  onPreview: () => void; onMention: () => void; onError: () => void; disabled: boolean;
  onRename: (name: string) => void; onResize: (size: { width: number; height: number }, corner: ResizeCorner) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const distance = useRef({ x: 0, y: 0 });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(reference.name);
  const cancelEdit = useRef(false);
  const saveName = () => { if (!cancelEdit.current && name.trim()) onRename(name.trim()); setEditing(false); };
  return <Draggable nodeRef={nodeRef} position={position} scale={scale} cancel=".board-no-drag" onStart={() => { moved.current = false; distance.current = { x: 0, y: 0 }; }} onDrag={(_event, data) => { distance.current.x += data.deltaX; distance.current.y += data.deltaY; if (Math.hypot(distance.current.x, distance.current.y) * scale >= 6) moved.current = true; if (moved.current) onMove({ ...position, x: data.x, y: data.y }); }} onStop={onStop}>
    <div ref={nodeRef} style={{ width: size.width + 2 }} className={`${styles.card} board-card`} onClickCapture={event => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; } }}>
      <button className={styles.imageButton} onClick={onPreview} aria-label={`Preview ${reference.name}`}>
        <Image src={reference.url} alt={reference.name} width={size.width} height={size.height} unoptimized draggable={false} onLoad={event => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) onSize({ width: image.naturalWidth, height: image.naturalHeight }); }} onError={onError} />
      </button>
      <div className={`${styles.cardActions} board-no-drag`} role="toolbar" aria-label={`Actions for ${reference.name}`} style={{ transform: `translateX(-50%) scale(${1 / scale}) translateY(-8px)` }}>
        <Tooltip content="Regenerate image (coming soon)"><button type="button" aria-label="Regenerate image (coming soon)" aria-disabled="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /></svg></button></Tooltip>
        <Tooltip content="Mention in chat" side="top"><button className={`${styles.mention} board-no-drag`} onClick={onMention} aria-label={`Mention ${reference.name} in chat`} disabled={disabled}>@</button></Tooltip>
      </div>
      <div className={`${styles.cardCaption} board-no-drag`} style={{ transform: `translateX(-50%) scale(${1 / scale}) translateY(8px)` }}>
        <span className={styles.tagPrefix} aria-hidden="true">@</span>
        {editing ? <input className={`${styles.tagInput} board-no-drag`} aria-label="Reference tag" autoFocus maxLength={60} value={name} onChange={event => setName(event.target.value)} onBlur={saveName} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { cancelEdit.current = true; setEditing(false); } }} /> : <button type="button" className={styles.editableTag} title="Double-click to edit tag" aria-label={`Edit tag ${reference.name}`} disabled={disabled} onDoubleClick={() => { cancelEdit.current = false; setName(reference.name); setEditing(true); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); cancelEdit.current = false; setName(reference.name); setEditing(true); } }}>{reference.name}</button>}
      </div>
      {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => <ImageResizeHandle key={corner} corner={corner} size={size} scale={scale} disabled={disabled} onResize={onResize} onCommit={onStop} />)}
    </div>
  </Draggable>;
}
