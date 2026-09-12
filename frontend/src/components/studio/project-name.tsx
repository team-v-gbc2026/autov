"use client";

import { useRef, useState } from "react";
import { renameProject } from "@/app/workspace/actions";
import Tooltip from "@/components/ui/tooltip";
import styles from "./project-name.module.css";

export default function ProjectName({ projectId, name }: { projectId: string; name: string }) {
  const [savedName, setSavedName] = useState(name);
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cancel = useRef(false);
  const pending = useRef(false);

  async function save() {
    if (cancel.current) { cancel.current = false; return; }
    if (pending.current) return;
    const next = draft.trim();
    setEditing(false);
    if (next === savedName) return;
    if (!next || next.length > 120) {
      setError("Use a name between 1 and 120 characters.");
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await renameProject(projectId, next);
      if (result.error) setError(result.error);
      else { setSavedName(next); setDraft(next); }
    } catch { setError("Could not save the name. Click edit to retry."); }
    finally { pending.current = false; setSaving(false); }
  }

  return <div className={styles.root}>
    {editing ? <input
      autoFocus
      className={styles.input}
      aria-label="Project name"
      maxLength={120}
      value={draft}
      onFocus={event => event.currentTarget.select()}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => { void save(); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") {
          event.preventDefault(); cancel.current = true; setDraft(savedName);
          event.currentTarget.blur(); setEditing(false); setError("");
        }
      }}
    /> : <>
      <span className={styles.name} title={savedName}>{savedName}</span>
      <span className={styles.edit}>
        <Tooltip content="Edit project name" side="bottom">
          <button className={styles.editButton} type="button" aria-label="Edit project name" disabled={saving} onClick={() => {
            if (!error) setDraft(savedName);
            cancel.current = false; setError(""); setEditing(true);
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" /></svg>
          </button>
        </Tooltip>
      </span>
    </>}
    {saving && <span className={styles.status} role="status">Saving...</span>}
    {error && <span className={styles.error} role="alert">{error}</span>}
  </div>;
}
