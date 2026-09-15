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

export default function ReferencePreview({ reference, onClose, onRename, onMention, onRemove, onEdit, disabled, promptInitiallyOpen = false }: {
  reference: Reference | null; onClose: () => void; onRename: (name: string) => void;
  onMention: () => void; onRemove: () => void; onEdit?: (prompt: string) => Promise<void>; disabled: boolean; promptInitiallyOpen?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(reference?.name || "");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const submitting = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [promptOpen, setPromptOpen] = useState(!reference || promptInitiallyOpen);
  const [editPrompt, setEditPrompt] = useState("");
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  const handleDownload = async () => {
    if (!reference) return;
    try {
      const response = await fetch(reference.url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${reference.name || "image"}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch { /* ignore */ }
  };
  const saveName = () => {
    if (!reference) return;
    const next = name.trim();
    if (next) { setName(next); if (next !== reference.name) onRename(next); }
    else setName(reference.name);
  };
  return <dialog ref={dialog} className={styles.preview} onCancel={event => { if (editing) event.preventDefault(); else onClose(); }} aria-label={reference ? `Preview ${reference.name}` : "Generate image"}>
    <header className={styles.previewHeader}>
      {reference ? <form className={styles.previewTag} onSubmit={event => { event.preventDefault(); input.current?.blur(); }}>
        <span aria-hidden="true">@</span>
        <input ref={input} aria-label="Reference tag" value={name} onChange={event => setName(event.target.value)} required maxLength={60} disabled={disabled || editing} onBlur={saveName} />
      </form> : <span className={styles.previewTitle}>Generate image</span>}
      <PreviewAction label="Close preview" disabled={editing} onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></PreviewAction>
    </header>
    <div className={`${styles.previewStage} ${!reference ? styles.emptyPreviewStage : ""}`}>{reference ? <Image src={reference.url} alt={reference.name} width={1200} height={900} unoptimized /> : <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 6-6 4 4 3-3 5 5" /></svg>}</div>
    <footer className={styles.previewDetails} aria-label="Image tools">
      {promptOpen ? <form className={styles.imageEditPrompt} aria-label="Image edit prompt" onSubmit={async event => {
        event.preventDefault();
        if (!onEdit || disabled || submitting.current || !editPrompt.trim()) return;
        submitting.current = true; setEditing(true); setEditError("");
        try { await onEdit(editPrompt.trim()); onClose(); }
        catch (error) { setEditError(error instanceof Error ? error.message : "Could not edit image."); }
        finally { submitting.current = false; setEditing(false); }
      }}>
        <textarea autoFocus rows={1} maxLength={2000} disabled={editing} aria-label={reference ? "Describe your image edit" : "Describe the image to generate"} placeholder={reference ? "Describe the changes you want..." : "Describe the image you want to create..."} value={editPrompt} onChange={event => setEditPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPromptOpen(false); } }} />
        <button type="submit" className={styles.previewAction} aria-label={editing ? reference ? "Editing image" : "Generating image" : reference ? "Generate image edit" : "Generate image"} disabled={!onEdit || disabled || editing || !editPrompt.trim()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>
        <PreviewAction label="Close edit prompt" disabled={editing} onClick={() => setPromptOpen(false)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></PreviewAction>
      </form> : <button type="button" className={styles.generateButton} aria-expanded={false} onClick={() => setPromptOpen(true)} disabled={disabled || editing}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /></svg>Generate</button>}

      {reference && <div className={styles.previewActions}>
        <PreviewAction label="Download image" onClick={handleDownload} disabled={disabled || editing}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg></PreviewAction>
        <PreviewAction label="Mention in chat" onClick={onMention} disabled={disabled || editing}><span aria-hidden="true">@</span></PreviewAction>
        <span className={styles.previewDivider} />
        <PreviewAction label="Remove reference" onClick={() => setConfirm(true)} disabled={disabled || editing} destructive><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg></PreviewAction>
      </div>}
    </footer>
    {editing && <p role="status">{reference ? "Editing your image…" : "Generating your image…"} The result will appear on the board.</p>}
    {editError && <p role="alert">{editError}</p>}
    {confirm && <div className={styles.removeConfirmation} role="alert"><span>Remove this reference from the board?</span><div><button type="button" onClick={() => setConfirm(false)}>Cancel</button><button type="button" disabled={disabled || editing} onClick={onRemove}>Remove</button></div></div>}
  </dialog>;
}
