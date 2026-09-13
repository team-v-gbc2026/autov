"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { createProject, renameProject } from "@/app/workspace/actions";
import type { Project } from "@/lib/project-types";
import styles from "./projects.module.css";

export type ProjectDialogState = { mode: "create" } | { mode: "rename" | "delete"; project: Project };
type Result = { error?: string; success?: boolean; warning?: string };

export default function ProjectDialog({ selection, onClose, onSaved }: {
  selection: ProjectDialogState; onClose: () => void; onSaved: (warning?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const deleting = selection.mode === "delete";
  const [createRenameResult, action, pending] = useActionState<Result, FormData>(async (_previous, form) => {
    try {
      if (selection.mode === "create") return await createProject(form) || {};
      return await renameProject(selection.project.id, String(form.get("name") || ""));
    } catch (error) {
      unstable_rethrow(error);
      return { error: "The change could not be saved. Please try again." };
    }
  }, {});
  const [deleteResult, setDeleteResult] = useState<Result>({});
  const [deletingPending, setDeletingPending] = useState(false);

  const isSubmitting = pending || deletingPending;
  const result = deleting ? deleteResult : createRenameResult;
  const pendingText = deleting ? "Deleting..." : "Saving...";
  const submitLabel = deleting ? "Delete project" : selection.mode === "rename" ? "Save name" : "Create project";

  const onDelete = async () => {
    if (isSubmitting || selection.mode !== "delete") return;
    setDeleteResult({});
    setDeletingPending(true);
    try {
      const response = await fetch(`/api/projects/${selection.project.id}/delete`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "accept": "application/json" },
      });
      const data = await response.json().catch(() => ({ error: "Could not delete this project. Please try again." }));
      if (!response.ok) {
        setDeleteResult({ error: data?.error || "Could not delete this project. Please try again." });
        return;
      }
      setDeleteResult(data || { success: true });
    } catch {
      setDeleteResult({ error: "Could not delete this project. Please try again." });
    } finally {
      setDeletingPending(false);
    }
  };

  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => { if (result.success) onSaved(result.warning); }, [result, onSaved]);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="project-dialog-title" onCancel={(event) => { event.preventDefault(); if (!isSubmitting) onClose(); }}>
    <form action={action} onSubmit={(event) => {
      if (!deleting) return;
      event.preventDefault();
      void onDelete();
    }}>
      <h2 id="project-dialog-title">{deleting ? "Delete project?" : selection.mode === "rename" ? "Rename project" : "New project"}</h2>
      {deleting ? <p><strong>{selection.project.name}</strong> and its saved prompts, references, and effects will be deleted. This cannot be undone.</p> : <label>Project name<input autoFocus name="name" required maxLength={120} defaultValue={selection.mode === "rename" ? selection.project.name : ""} placeholder="Untitled exploration" disabled={pending} /></label>}
      {result.error && <p className={styles.error} role="alert">{result.error}</p>}
      <div className={styles.dialogActions}><button type="button" onClick={onClose} disabled={isSubmitting} autoFocus={deleting}>Cancel</button><button className={deleting ? styles.deleteButton : styles.primary} disabled={isSubmitting} type="submit">{isSubmitting ? pendingText : submitLabel}</button></div>
    </form>
  </dialog>;
}
