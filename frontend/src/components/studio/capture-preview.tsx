"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { agentHeaders } from "@/lib/agent/client";
import styles from "./board/board.module.css";

export default function CapturePreview({ projectId, referenceId, onClose }: {
  projectId: string; referenceId: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ name: string; url: string }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/studio/preview?referenceId=${encodeURIComponent(referenceId)}`, {
          headers: await agentHeaders(projectId), cache: "no-store", signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not open preview.");
        if (!controller.signal.aborted) setPreview(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not open preview.");
      }
    })();
    return () => controller.abort();
  }, [projectId, referenceId, attempt]);
  return <dialog ref={dialog} className={styles.preview} onCancel={onClose} aria-label="Saved effect preview">
    <header className={styles.previewHeader}>
      <span>{preview?.name || "Saved effect preview"}</span>
      <button type="button" className={styles.previewAction} onClick={onClose} aria-label="Close preview">×</button>
    </header>
    <div className={styles.previewStage}>
      {error ? <div role="alert">{error}<button type="button" onClick={() => { setError(""); setPreview(undefined); setAttempt(value => value + 1); }}>Retry preview</button></div>
        : preview ? <Image src={preview.url} alt={preview.name} width={1280} height={1212} unoptimized onError={() => setError("Preview image could not load. Try again.")} />
        : <p role="status">Loading saved preview…</p>}
    </div>
  </dialog>;
}
