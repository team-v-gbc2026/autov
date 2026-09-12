"use client";
import Image from "next/image";
import { useRef } from "react";
import Draggable from "react-draggable";
import type { Reference } from "@/lib/project-types";
import type { BoardItem } from "./board-store";
import Tooltip from "@/components/ui/tooltip";
import styles from "./board.module.css";

export default function BoardCard({ reference, position, scale, onMove, onStop, onPreview, onMention, onError, disabled }: {
  reference: Reference; position: BoardItem; scale: number; onMove: (position: BoardItem) => void; onStop: () => void;
  onPreview: () => void; onMention: () => void; onError: () => void; disabled: boolean;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  return <Draggable nodeRef={nodeRef} position={position} scale={scale} cancel=".board-no-drag" onStart={() => { moved.current = false; }} onDrag={(_event, data) => { if (Math.abs(data.deltaX) + Math.abs(data.deltaY) > 0) moved.current = true; onMove({ ...position, x: data.x, y: data.y }); }} onStop={onStop}>
    <div ref={nodeRef} className={`${styles.card} board-card`} onClickCapture={event => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; } }}>
      <button className={styles.imageButton} onClick={onPreview} aria-label={`Preview ${reference.name}`}>
        <Image src={reference.url} alt={reference.name} width={160} height={116} unoptimized draggable={false} onError={onError} />
      </button>
      <div className={styles.cardFooter}><button className={styles.name} onClick={onPreview} title={reference.name}>{reference.name}</button>
        <Tooltip content="Mention in chat" side="top"><button className={`${styles.mention} board-no-drag`} onClick={onMention} aria-label={`Mention ${reference.name} in chat`} disabled={disabled}>@</button></Tooltip>
      </div>
    </div>
  </Draggable>;
}
