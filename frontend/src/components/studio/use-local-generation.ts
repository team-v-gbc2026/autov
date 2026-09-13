"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generatePipeline, type Candidate } from "@/lib/vfx-lab/pipeline";
import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";

export type LocalBudget = {
  limit: number;
  used: number;
  remaining: number;
  calls: number;
  pending: number;
};

type LocalStatus = {
  configured: boolean;
  model: string;
  budget: LocalBudget;
};

/**
 * Client-side orchestration of the v2 generation pipeline, lifted out of the
 * local lab studio (`components/vfx-lab/studio.tsx`) so the product studio can
 * run the same transport, capture, budget and abort handling. The lab studio
 * pins `schema: "v1"`; the product studio is v2 only.
 *
 * Availability is what `GET /api/local-vfx` reports. That endpoint is
 * localhost-only, so a deployed workspace simply gets `available: false` and
 * the chat keeps saving prompts exactly as before.
 */
export function useLocalGeneration({
  onDocument,
  onProgress,
}: {
  onDocument: (doc: VfxDocumentV2) => void;
  onProgress?: (message: string) => void;
}) {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const callbacks = useRef({ onDocument, onProgress });
  useEffect(() => {
    callbacks.current = { onDocument, onProgress };
  });

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/local-vfx");
      const data = await response.json();
      // 403 (not a local request) and a missing key are both "unavailable", not
      // an error worth showing in the product chat.
      setStatus(response.ok ? data : null);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    // Availability is external state read from the local API; the setState
    // happens in the fetch continuation, not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStatus();
    return () => abort.current?.abort();
  }, [refreshStatus]);

  const request = useCallback(
    async (body: Record<string, unknown>, signal: AbortSignal) => {
      const response = await fetch("/api/local-vfx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const data = await response.json();
      if (data.budget)
        setStatus((current) =>
          current ? { ...current, budget: data.budget } : current,
        );
      if (!response.ok) throw new Error(data.error || "Generation failed.");
      return data;
    },
    [],
  );

  const run = useCallback(
    async (
      prompt: string,
      references: string[],
      mode: "fast" | "quality" = "fast",
    ) => {
      if (!prompt.trim() || busy || !status?.configured) return false;
      const { captureV2 } = await import("@/lib/vfx-lab/capture-v2");
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      setError("");
      const progress = (message: string) =>
        callbacks.current.onProgress?.(message);
      try {
        const result = await generatePipeline({
          schema: "v2",
          prompt,
          references,
          mode,
          candidateCount: 1,
          signal: controller.signal,
          request,
          // Off-screen capture: the product preview keeps rendering the author's
          // document while the pipeline renders evidence for the reviewer.
          capture: (document, solo, diagnostic) =>
            captureV2(document, { solo, diagnostic }),
          progress,
          candidate: (candidate: Candidate<VfxDocumentV2>) => {
            progress(
              candidate.error
                ? `A candidate failed: ${candidate.error}`
                : `Rendered ${candidate.document.name}.`,
            );
          },
        });
        callbacks.current.onDocument(result.selected.document);
        progress(`Generated ${result.selected.document.name}.`);
        return true;
      } catch (problem) {
        const message = controller.signal.aborted
          ? "Stopped. Your current effect is preserved."
          : problem instanceof Error
            ? problem.message
            : "Generation failed. Previous effect preserved.";
        setError(message);
        progress(message);
        return false;
      } finally {
        setBusy(false);
        abort.current = null;
        void refreshStatus();
      }
    },
    [busy, refreshStatus, request, status?.configured],
  );

  return {
    available: Boolean(status?.configured),
    budget: status?.budget,
    model: status?.model,
    busy,
    error,
    status,
    run,
    abort: () => abort.current?.abort(),
  };
}
