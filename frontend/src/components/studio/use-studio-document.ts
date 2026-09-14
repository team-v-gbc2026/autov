"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { agentHeaders } from "@/lib/agent/client";
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
          if (state.enabled === false) {
            current.disabled = true;
            current.initialized = true;
            setReady(true);
            return;
          }
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
          if (!claimed || claimed.status !== "running") continue;
          handled.add(operation.id);
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
            await studioRequest(projectId, {
              action: "ack",
              id: operation.id,
              leaseId,
              ...result,
            });
          } catch (cause) {
            await studioRequest(projectId, {
              action: "ack",
              id: operation.id,
              leaseId,
              error:
                cause instanceof Error
                  ? cause.message
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
    const interval = setInterval(() => void synchronize(), 1000);
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
      .subscribe();
    return () => {
      active = false;
      clearInterval(interval);
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
