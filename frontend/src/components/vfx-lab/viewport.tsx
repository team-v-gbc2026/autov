"use client";
import { useEffect, useRef, useState } from "react";
import type { VfxDocument } from "@/lib/vfx-lab/schema";
import type { VfxRuntime } from "@/lib/vfx-lab/runtime";
export default function Viewport({
  doc,
  time,
  solo,
  onReady,
}: {
  doc: VfxDocument;
  time: number;
  solo?: string;
  onReady: (runtime: VfxRuntime | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<VfxRuntime | null>(null),
    latest = useRef({ doc, time, solo, onReady });
  useEffect(() => {
    latest.current = { doc, time, solo, onReady };
  });
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false,
      frame = 0;
    let runtime: VfxRuntime | undefined;
    import("@/lib/vfx-lab/runtime")
      .then(async ({ VfxRuntime }) => {
        if (cancelled || !host.current) return;
        runtime = new VfxRuntime(host.current, setError);
        instance.current = runtime;
        await runtime.prepare(latest.current.doc);
        if (cancelled) return;
        runtime.setDocument(latest.current.doc);
        latest.current.onReady(runtime);
        const draw = () => {
          if (cancelled) return;
          try {
            runtime!.render(latest.current.time, latest.current.solo);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Preview failed.");
            return;
          }
          frame = requestAnimationFrame(draw);
        };
        draw();
      })
      .catch(() =>
        setError(
          "WebGL2 is unavailable. Enable browser hardware acceleration.",
        ),
      );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      runtime?.dispose();
      instance.current = null;
      latest.current.onReady(null);
    };
  }, []);
  // Decode assets before installing the document; ignore superseded async work.
  useEffect(() => {
    let cancelled = false;
    const current = instance.current;
    if (current) void current.prepare(doc).then(() => {
      if (!cancelled) current.setDocument(doc);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Invalid effect."); });
    return () => { cancelled = true; };
  }, [doc]);
  return (
    <div className="scene-container scene-interactive">
      <div className="scene-host" ref={host} />
      <div className="scene-navigation-hint">
        DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM
      </div>
      {error && (
        <div className="scene-status scene-error" role="alert">
          <strong>Preview unavailable</strong>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
