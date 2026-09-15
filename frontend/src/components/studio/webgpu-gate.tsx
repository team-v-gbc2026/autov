"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./webgpu-gate.module.css";

type Check = "checking" | "ready" | "unsupported" | "unavailable";

/** Chrome/Edge ship WebGPU by default; Firefox and Safari do not yet. */
function browserSupportsWebGpu() {
  return typeof navigator !== "undefined" && /Chrome|Chromium|Edg\//.test(navigator.userAgent);
}

async function detect(): Promise<Check> {
  if (typeof navigator === "undefined" || !navigator.gpu) return "unsupported";
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    return adapter ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Blocks the workspace behind a modal until WebGPU is confirmed available.
 * The studio's renderer requires WebGPU with no WebGL fallback, so a missing
 * or disabled adapter must stop the page rather than fail inside the canvas.
 */
export default function WebGpuGate({ children }: { children: ReactNode }) {
  const [check, setCheck] = useState<Check>("checking");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let cancelled = false;
    void detect().then(result => { if (!cancelled) setCheck(result); });
    return () => { cancelled = true; };
  }, []);

  const blocked = check === "unsupported" || check === "unavailable";
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (blocked && !node.open) node.showModal();
    if (!blocked && node.open) node.close();
  }, [blocked]);

  return (
    <>
      {check === "ready" && children}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-label="WebGPU required"
        onCancel={event => event.preventDefault()}
      >
        <h2>WebGPU is required</h2>
        {check === "unsupported" && !browserSupportsWebGpu() ? (
          <>
            <p>This browser doesn&rsquo;t support WebGPU, which the studio needs to render effects.</p>
            <p>Switch to the latest <strong>Google Chrome</strong> (or another Chromium-based browser, such as Edge) and reopen this page.</p>
          </>
        ) : (
          <>
            <p>WebGPU is supported here but isn&rsquo;t turned on, so the studio can&rsquo;t render effects yet.</p>
            <p>To enable it in Chrome:</p>
            <ol>
              <li>
                Open <code>chrome://flags/#enable-unsafe-webgpu</code> in a new tab.
              </li>
              <li>Set <strong>Unsafe WebGPU</strong> to <strong>Enabled</strong>.</li>
              <li>Click <strong>Relaunch</strong> at the bottom of the page.</li>
              <li>Come back to this tab and reload.</li>
            </ol>
            <p>If it&rsquo;s still unavailable, check that hardware acceleration is on under <code>chrome://settings/system</code>.</p>
          </>
        )}
        <button type="button" onClick={() => { setCheck("checking"); void detect().then(setCheck); }}>
          Check again
        </button>
      </dialog>
    </>
  );
}
