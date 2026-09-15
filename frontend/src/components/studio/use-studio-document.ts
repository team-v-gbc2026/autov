"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { agentHeaders } from "@/lib/agent/client";
import { ownsBrowserLease } from "@/lib/studio-tools/browser-operation";
import { startHeartbeat } from "@/lib/studio-tools/heartbeat";
import { createClient } from "@/lib/supabase/client";
import {
  validateWorkspaceDocumentV2,
  type VfxDocumentV2,
} from "@/lib/vfx-lab/schema-v2";
export type BrowserOperation = {
  id: string;
  kind: string;
  expected_revision: number;
  input: Record<string, unknown>;
  expires_at: string;
};
export type BoardAsset = {
  id: string;
  name: string;
  storage_path: string;
  mime_type: string;
};
export async function studioRequest(projectId: string, body?: unknown) {
  const response = await fetch("/api/studio", {
    method: body ? "POST" : "GET",
    headers: {
      ...(await agentHeaders(projectId)),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok && body && typeof body === "object" && "action" in body &&
      body.action === "renew" && typeof result.error === "string" &&
      /discriminator/i.test(result.error))
    throw new Error("The Studio server is outdated and does not support capture renewal. Export unsaved edits, restart or deploy the updated Next.js server and Eve together, then refresh Studio.");
  if (!response.ok)
    throw new Error(result.error || "Studio synchronization failed.");
  return result;
}
export function useStudioDocument(
  projectId: string,
  initial: () => VfxDocumentV2,
  standalone: boolean,
  onOperation: (
    operation: BrowserOperation,
    document: VfxDocumentV2,
  ) => Promise<Record<string, unknown>>,
  onAssets: (assets: BoardAsset[]) => Promise<void>,
) {
  const [document, setDocument] = useState(initial);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(standalone);
  const model = useRef({
    document,
    revision: 0,
    disabled: standalone,
    dirty: false,
    initialized: standalone,
    saving: null as Promise<void> | null,
    call: null as {
      id: string;
      document: VfxDocumentV2;
      revision: number;
    } | null,
  });
  const callbacks = useRef({ onOperation, onAssets });
  useEffect(() => {
    callbacks.current = { onOperation, onAssets };
  });
  const setDoc = useCallback(
    (update: SetStateAction<VfxDocumentV2>) => {
      const current = model.current;
      if (!current.initialized) {
        setError("Wait for the effect to load before editing.");
        return;
      }
      const next = validateWorkspaceDocumentV2(
        typeof update === "function" ? update(current.document) : update,
      );
      current.document = next;
      current.dirty = !current.disabled;
      setDocument(next);
    },
    [],
  );
  const flush = useCallback(async () => {
    const current = model.current;
    if (current.disabled) return;
    if (!current.initialized)
      throw new Error("The studio has not connected yet.");
    if (current.saving) await current.saving;
    if (!current.dirty) return;
    const save = async () => {
      while (current.dirty) {
        // Retain the exact request across ambiguous network errors.
        current.call ??= {
          id: crypto.randomUUID(),
          document: current.document,
          revision: current.revision,
        };
        const sent = current.call;
        const result = await studioRequest(projectId, {
          action: "save",
          callId: sent.id,
          document: sent.document,
          expectedRevision: sent.revision,
        });
        current.revision = result.revision;
        current.call = null;
        current.dirty = current.document !== sent.document;
      }
      setError("");
    };
    current.saving = save();
    try {
      await current.saving;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed.");
      throw cause;
    } finally {
      current.saving = null;
    }
  }, [projectId]);
  useEffect(() => {
    if (standalone || !model.current.dirty) return;
    const timeout = setTimeout(() => {
      void flush().catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [document, standalone, flush]);
  useEffect(() => {
    if (standalone) return;
    let active = true,
      polling = false;
    const handled = new Set<string>();
    const synchronize = async () => {
      if (polling || !active) return;
      polling = true;
      try {
        const current = model.current;
        if (!current.initialized) {
          const state = await studioRequest(projectId, {
            action: "initialize",
            document: current.document,
          });
          if (!active) return;
          current.document = validateWorkspaceDocumentV2(state.document);
          current.revision = state.revision;
          current.initialized = true;
          setDocument(current.document);
          setReady(true);
        }
        if (current.disabled) return;
        const state = await studioRequest(projectId);
        if (!active) return;
        if (
          !current.dirty &&
          !current.saving &&
          state.revision > current.revision
        ) {
          current.document = validateWorkspaceDocumentV2(state.document);
          current.revision = state.revision;
          setDocument(current.document);
        }
        await callbacks.current.onAssets(state.assets);
        if (current.dirty || current.saving) return;
        for (const operation of state.operations as BrowserOperation[]) {
          if (!active || handled.has(operation.id)) continue;
          const leaseId = crypto.randomUUID();
          const claimed = await studioRequest(projectId, {
            action: "claim",
            id: operation.id,
            leaseId,
          });
          if (!ownsBrowserLease(claimed, leaseId)) continue;
          handled.add(operation.id);
          const stopHeartbeat = ["preview", "capture_candidate"].includes(operation.kind)
            ? startHeartbeat(async () => {
                if (!active) throw new Error("Studio closed during capture.");
                await studioRequest(projectId, { action: "renew", id: operation.id, leaseId });
              })
            : async () => {};
          try {
            if (operation.expected_revision !== current.revision)
              throw new Error("Effect changed before browser action.");
            const result = await callbacks.current.onOperation(
              operation,
              current.document,
            );
            if (
              !active ||
              current.dirty ||
              current.revision !== operation.expected_revision
            )
              throw new Error("Effect changed during browser action.");
            // The acknowledgement handler renews throughout image upload.
            await stopHeartbeat();
            const acknowledged = await studioRequest(projectId, {
              action: "ack",
              id: operation.id,
              leaseId,
              ...result,
            });
            if (acknowledged.status !== "completed")
              throw new Error(acknowledged.result?.message || "Browser acknowledgement did not complete.");
          } catch (cause) {
            await stopHeartbeat().catch(() => {});
            if (active) setError(cause instanceof Error ? cause.message : "Capture failed.");
            await studioRequest(projectId, {
              action: "ack",
              id: operation.id,
              leaseId,
              error:
                cause instanceof Error
                  ? cause.message.slice(0, 500)
                  : "Browser action failed.",
            }).catch(() => {});
          }
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Studio unavailable.",
          );
      } finally {
        polling = false;
      }
    };
    void synchronize();
    const interval = setInterval(() => void synchronize(), 5000);
    const client = createClient();
    const channel = client
      .channel(`studio-${projectId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "studio_documents",
          filter: `project_id=eq.${projectId}`,
        },
        () => void synchronize(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "studio_operations", filter: `project_id=eq.${projectId}` },
        () => void synchronize(),
      )
      .subscribe();
    const onFocus = () => void synchronize();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      void client.removeChannel(channel);
    };
  }, [projectId, standalone]);
  return {
    document,
    setDoc,
    flush,
    ready,
    error,
    revision: () => model.current.revision,
  };
}
