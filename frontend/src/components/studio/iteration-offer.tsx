"use client";
import { useEffect, useState } from "react";
import { agentHeaders } from "@/lib/agent/client";
import styles from "./chat.module.css";
export type IterationOfferValue = { operationId: string; revision: number };
export default function IterationOffer({
  projectId,
  busy,
  onContinue,
}: {
  projectId: string;
  busy: boolean;
  onContinue: (offer: IterationOfferValue) => Promise<boolean>;
}) {
  const [offer, setOffer] = useState<IterationOfferValue | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    let pending = false;
    async function poll() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/studio/iteration", {
          headers: await agentHeaders(projectId),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw Error("Iteration status unavailable");
        const next = await response.json();
        if (!controller.signal.aborted) setOffer(next);
      } catch {
        if (!controller.signal.aborted) setOffer(null);
      } finally {
        pending = false;
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [projectId, busy]);
  if (!offer || busy) return null;
  return (
    <div className={styles.iterationOffer}>
      <p>Continue iterating on this effect?</p>
      <button
        type="button"
        disabled={sending}
        onClick={async () => {
          if (sending) return;
          setSending(true);
          setError("");
          try {
            if (await onContinue(offer)) setOffer(null);
            else
              setError("Could not start iteration. Reconnect and try again.");
          } catch {
            setError("Could not start iteration. Reconnect and try again.");
          } finally {
            setSending(false);
          }
        }}
      >
        {sending ? "Continuing…" : "Continue"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
