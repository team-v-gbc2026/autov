"use client";

import { useEffect, useRef } from "react";
import type { BackdropController, BackdropSnapshot } from "@/lib/vfx-lab/backdrop-controller";
import { BackdropPanel } from "../vfx-lab/backdrop-panel";
import { SplatGenerationPanel } from "../vfx-lab/splat-generation-panel";
import styles from "./studio-backdrop.module.css";

export default function StudioBackdrop({ open, onClose, controller, snapshot, cleanImageStorageKey, onUseDescription }: {
  open: boolean;
  onClose: () => void;
  controller: BackdropController | null;
  snapshot: BackdropSnapshot;
  onUseDescription?: (description: string) => void;
  cleanImageStorageKey: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return <dialog ref={dialog} id="studio-backdrop" className={styles.dialog} aria-labelledby="studio-backdrop-title" onClose={onClose} onCancel={onClose}>
    <header className={styles.header}>
      <div><h2 id="studio-backdrop-title">Workspace backdrop</h2><p>A scene reference saved for this workspace, separate from your effect.</p></div>
      <button type="button" autoFocus onClick={onClose} aria-label="Close backdrop settings">Close</button>
    </header>
    <div className={styles.body}>
      <SplatGenerationPanel controller={controller} cleanImageStorageKey={cleanImageStorageKey} onUseDescription={onUseDescription} />
      <section className={styles.settings} aria-label="Import and place a backdrop">
        <h3>Import and place a Gaussian splat</h3>
        <p>Import a Gaussian splat PLY file or URL. Close this panel to inspect it in the scene.</p>
        {!controller && <p role="status">Waiting for the scene to become ready.</p>}
        <BackdropPanel controller={controller} snapshot={snapshot} />
      </section>
    </div>
  </dialog>;
}
