"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { createProject, renameProject } from "@/app/workspace/actions";
import type { Project } from "@/lib/project-types";
import { VFX_PRESET_BASE, presetThumbnailUrl } from "@/lib/vfx-lab/asset-urls";
import styles from "./projects.module.css";

export type ProjectDialogState = { mode: "create" } | { mode: "rename" | "delete"; project: Project };
type Result = { error?: string; success?: boolean; warning?: string };
type Preset = { id: string; caseId: string; name: string; duration: number; layers: number; latest: boolean; selected: boolean };

const categoryName = (caseId: string) => caseId.replace(/^fx\d+-/, "").replaceAll("-", " ");

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
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(selection.mode === "create");

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
  useEffect(() => {
    if (selection.mode !== "create") return;
    const controller = new AbortController();
    fetch(`${VFX_PRESET_BASE}/manifest.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(manifest => setPresets((manifest.trials as Preset[]).filter(preset => preset.latest && preset.selected)))
      .catch(() => { if (!controller.signal.aborted) setPresets([]); })
      .finally(() => { if (!controller.signal.aborted) setPresetsLoading(false); });
    return () => controller.abort();
  }, [selection.mode]);
  useEffect(() => { if (result.success) onSaved(result.warning); }, [result, onSaved]);

  return <dialog ref={dialog} className={`${styles.dialog} ${selection.mode === "create" ? styles.createDialog : ""}`} aria-labelledby="project-dialog-title" onCancel={(event) => { event.preventDefault(); if (!isSubmitting) onClose(); }}>
    <form action={action} onSubmit={(event) => {
      if (!deleting) return;
      event.preventDefault();
      void onDelete();
    }}>
      <div className={styles.dialogHeading}><div><h2 id="project-dialog-title">{deleting ? "Delete project?" : selection.mode === "rename" ? "Rename project" : "Start a project"}</h2>{selection.mode === "create" && <p>Create an empty canvas or begin with an effect you can make your own.</p>}</div>{selection.mode === "create" && <button className={styles.closeButton} type="button" aria-label="Close" onClick={onClose} disabled={isSubmitting}>×</button>}</div>
      {deleting ? <p><strong>{selection.project.name}</strong> and its saved prompts, references, and effects will be deleted. This cannot be undone.</p> : selection.mode === "rename" ? <label>Project name<input autoFocus name="name" required maxLength={120} defaultValue={selection.project.name} placeholder="Untitled exploration" disabled={pending} /></label> : <div className={styles.creationChoices}>
        <section className={styles.blankProject} aria-labelledby="blank-project-title"><div className={styles.blankIcon} aria-hidden="true"><span>+</span></div><div><h3 id="blank-project-title">New project</h3><p>Start with a clean scene and build an effect from scratch.</p></div><label><span>Project name</span><div className={styles.nameRow}><input autoFocus name="name" required maxLength={120} placeholder="Untitled exploration" disabled={pending} /><button className={styles.primary} disabled={pending} type="submit">{pending ? "Creating..." : "Create blank"}</button></div></label></section>
        <div className={styles.presetHeading}><div><span>Or start with a preset</span><small>{presetsLoading ? "Loading…" : `${presets.length} effects`}</small></div><p>Every layer stays editable after you create the project.</p></div>
        <div className={styles.presetGrid}>{presets.map(preset => <button key={preset.id} className={styles.presetCard} type="submit" name="presetId" value={preset.id} disabled={pending} formNoValidate onClick={(event) => { const input = event.currentTarget.form?.elements.namedItem("name") as HTMLInputElement | null; if (input && !input.value.trim()) input.value = preset.name; }}><span className={styles.presetImage}><img src={presetThumbnailUrl(preset.id)} alt="" /><span className={styles.usePreset}>Use preset <b aria-hidden="true">→</b></span></span><span className={styles.presetMeta}><strong>{preset.name}</strong><span><i>{categoryName(preset.caseId)}</i><small>{preset.duration}s · {preset.layers} layers</small></span></span></button>)}</div>
      </div>}
      {result.error && <p className={styles.error} role="alert">{result.error}</p>}
      {selection.mode !== "create" && <div className={styles.dialogActions}><button type="button" onClick={onClose} disabled={isSubmitting} autoFocus={deleting}>Cancel</button><button className={deleting ? styles.deleteButton : styles.primary} disabled={isSubmitting} type="submit">{isSubmitting ? pendingText : submitLabel}</button></div>}
    </form>
  </dialog>;
}
