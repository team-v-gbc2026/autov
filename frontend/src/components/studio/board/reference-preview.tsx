"use client";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Reference } from "@/lib/project-types";
import styles from "./board.module.css";

function PreviewAction({ label, children, onClick, disabled, destructive = false }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; destructive?: boolean;
}) {
  return <button type="button" className={`${styles.previewAction} ${destructive ? styles.destructive : ""}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function ReferencePreview({ reference, onClose, onRename, onMention, onRemove, disabled }: {
  reference: Reference | null; onClose: () => void; onRename: (name: string) => void;
  onMention: () => void; onRemove: () => void; disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(reference?.name || "");
  const [confirm, setConfirm] = useState(false);
  const [promptOpen, setPromptOpen] = useState(!reference);
  const [editPrompt, setEditPrompt] = useState("");
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  const saveName = () => {
    if (!reference) return;
    const next = name.trim();
    if (next) { setName(next); if (next !== reference.name) onRename(next); }
    else setName(reference.name);
  };
  return <dialog ref={dialog} className={styles.preview} onCancel={onClose} aria-label={reference ? `Preview ${reference.name}` : "Generate image"}>
    <header className={styles.previewHeader}>
      {reference ? <form className={styles.previewTag} onSubmit={event => { event.preventDefault(); input.current?.blur(); }}>
        <span aria-hidden="true">@</span>
        <input ref={input} aria-label="Reference tag" value={name} onChange={event => setName(event.target.value)} required maxLength={60} disabled={disabled} onBlur={saveName} />
      </form> : <span className={styles.previewTitle}>Generate image</span>}
      <PreviewAction label="Close preview" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></PreviewAction>
    </header>
    <div className={`${styles.previewStage} ${!reference ? styles.emptyPreviewStage : ""}`}>{reference ? <Image src={reference.url} alt={reference.name} width={1200} height={900} unoptimized /> : <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 6-6 4 4 3-3 5 5" /></svg>}</div>
    <footer className={styles.previewDetails} aria-label="Image tools">
      {promptOpen ? <form className={styles.imageEditPrompt} aria-label="Image edit prompt" onSubmit={event => event.preventDefault()}>
        <textarea autoFocus rows={1} aria-label={reference ? "Describe your image edit" : "Describe the image to generate"} placeholder={reference ? "Describe the changes you want..." : "Describe the image you want to create..."} value={editPrompt} onChange={event => setEditPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPromptOpen(false); } }} />
        <button type="button" className={styles.previewAction} aria-label={reference ? "Generate image edit (coming soon)" : "Generate image (coming soon)"} title="Image generation is not connected yet" aria-disabled="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>
        <PreviewAction label="Close edit prompt" onClick={() => setPromptOpen(false)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></PreviewAction>
      </form> : <button type="button" className={styles.generateButton} aria-expanded={false} onClick={() => setPromptOpen(true)} disabled={disabled}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /></svg>Generate</button>}

      {reference && <div className={styles.previewActions}>
        <PreviewAction label="Mention in chat" onClick={onMention} disabled={disabled}><span aria-hidden="true">@</span></PreviewAction>
        <span className={styles.previewDivider} />
        <PreviewAction label="Remove reference" onClick={() => setConfirm(true)} disabled={disabled} destructive><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg></PreviewAction>
      </div>}
    </footer>
    {confirm && <div className={styles.removeConfirmation} role="alert"><span>Remove this reference from the board?</span><div><button type="button" onClick={() => setConfirm(false)}>Cancel</button><button type="button" disabled={disabled} onClick={onRemove}>Remove</button></div></div>}
  </dialog>;
}
