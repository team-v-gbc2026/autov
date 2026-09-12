"use client";

import { useActionState, useEffect, useRef } from "react";
import { unstable_rethrow } from "next/navigation";
import { createProject, renameProject } from "@/app/workspace/actions";
import { deleteProject } from "@/app/workspace/delete-project";
import type { Project } from "@/lib/project-types";
import styles from "./projects.module.css";

export type ProjectDialogState = { mode: "create" } | { mode: "rename" | "delete"; project: Project };
type Result = { error?: string; success?: boolean; warning?: string };
export default function ProjectDialog({ selection, onClose, onSaved }: {
  selection: ProjectDialogState; onClose: () => void; onSaved: (warning?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const deleting = selection.mode === "delete";
  const [result, action, pending] = useActionState<Result, FormData>(async (_previous, form) => {
    try {
      if (selection.mode === "create") return await createProject(form) || {};
      if (selection.mode === "delete") return await deleteProject(selection.project.id);
      return await renameProject(selection.project.id, String(form.get("name") || ""));
    } catch (error) {
      unstable_rethrow(error);
      return { error: "The change could not be saved. Please try again." };
    }
  }, {});
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => { if (result.success) onSaved(result.warning); }, [result, onSaved]);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="project-dialog-title" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <form action={action}>
      
      <h2 id="project-dialog-title">{deleting ? "Delete project?" : selection.mode === "rename" ? "Rename project" : "New project"}</h2>
      {deleting ? <p><strong>{selection.project.name}</strong> and its saved prompts, references, and effects will be deleted. This cannot be undone.</p> : <label>Project name<input autoFocus name="name" required maxLength={120} defaultValue={selection.mode === "rename" ? selection.project.name : ""} placeholder="Untitled exploration" disabled={pending} /></label>}
      {result.error && <p className={styles.error} role="alert">{result.error}</p>}
      <div className={styles.dialogActions}><button type="button" onClick={onClose} disabled={pending} autoFocus={deleting}>Cancel</button><button className={deleting ? styles.deleteButton : styles.primary} disabled={pending} type="submit">{pending ? "Saving..." : deleting ? "Delete project" : selection.mode === "rename" ? "Save name" : "Create project"}</button></div>
    </form>
  </dialog>;
}
