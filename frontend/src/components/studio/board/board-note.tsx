"use client";
import { useRef } from "react";
import Draggable from "react-draggable";
import ImageResizeHandle from "./image-resize-handle";
import type { BoardNote as Note } from "./use-board-notes";
import styles from "./board.module.css";

export default function BoardNote({ note, scale, autoFocus, disabled, onChange, onRemove }: {
  note: Note; scale: number; autoFocus: boolean; disabled: boolean;
  onChange: (patch: Partial<Pick<Note, "text" | "x" | "y" | "width" | "height">>) => void; onRemove: () => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const width = note.width && Number.isFinite(note.width) && note.width > 0 ? note.width : 240;
  const height = note.height && Number.isFinite(note.height) && note.height > 0 ? note.height : 190;
  const fontSize = note.fontSize && Number.isFinite(note.fontSize) && note.fontSize > 0 ? note.fontSize : 14;
  return <Draggable nodeRef={nodeRef} position={{ x: note.x, y: note.y }} scale={scale} handle=".note-drag" cancel="button" disabled={disabled} onDrag={(_event, data) => onChange({ x: data.x, y: data.y })}>
    <div ref={nodeRef} style={{ width, height, fontSize }} className={`${styles.note} board-card`}>
      <div className={`${styles.noteHeader} note-drag`}>
        <button type="button" className={`${styles.noteGrip} note-drag`} aria-label="Move note with arrow keys" title="Drag header to move" disabled={disabled} onKeyDown={event => {
          const moves: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
          const move = moves[event.key];
          if (!move) return;
          event.preventDefault(); event.stopPropagation(); onChange({ x: note.x + move[0] / scale, y: note.y + move[1] / scale });
        }}><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1" /><circle cx="11" cy="4" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="11" cy="12" r="1" /></svg></button>
        <button type="button" className={styles.noteRemove} title="Delete note" aria-label="Delete note" onClick={onRemove} disabled={disabled}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </div>
      <textarea autoFocus={autoFocus} aria-label="Board note" placeholder="Write a note..." value={note.text} maxLength={5000} rows={6} disabled={disabled} onChange={event => onChange({ text: event.target.value })} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.blur(); } }} />
      {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(corner => <ImageResizeHandle key={corner} corner={corner} size={{ width, height }} scale={scale} disabled={disabled} onResize={(size, edge) => onChange({ ...size, x: note.x + (edge.endsWith("left") ? width - size.width : 0), y: note.y + (edge.startsWith("top") ? height - size.height : 0) })} onCommit={() => {}} label="note" />)}
    </div>
  </Draggable>;
}
