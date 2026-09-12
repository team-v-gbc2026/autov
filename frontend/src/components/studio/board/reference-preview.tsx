"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Reference } from "@/lib/project-types";
import styles from "./board.module.css";

export default function ReferencePreview({ reference, onClose, onRename, onMention, onRemove, disabled }: {
  reference: Reference; onClose: () => void; onRename: (name: string) => void;
  onMention: () => void; onRemove: () => void; disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(reference.name);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={dialog} className={styles.preview} onCancel={onClose} aria-label="Reference preview">
    <button className={styles.previewClose} aria-label="Close preview" onClick={onClose}>×</button>
    <Image src={reference.url} alt={reference.name} width={900} height={650} unoptimized />
    <form onSubmit={event => { event.preventDefault(); if (name.trim()) onRename(name.trim()); }}>
      <label>Reference name<input value={name} onChange={event => setName(event.target.value)} required maxLength={60} onBlur={() => { if (name.trim()) onRename(name.trim()); }} /></label>
      <button type="button" onClick={onMention} disabled={disabled}>@ Mention in chat</button>
    </form>
    <div className={styles.previewFooter}>{confirm ? <><span>Remove from the board?</span><button disabled={disabled} onClick={onRemove}>Remove</button><button onClick={() => setConfirm(false)}>Cancel</button></> : <button onClick={() => setConfirm(true)} disabled={disabled}>Remove reference</button>}</div>
  </dialog>;
}
