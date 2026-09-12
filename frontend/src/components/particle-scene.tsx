"use client";

import { useEffect, useRef, useState } from "react";

export default function ParticleScene({ time = 0, animated = false }: { time?: number; animated?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const clock = useRef(time);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { clock.current = time; }, [time]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    const fail = (message: string) => {
      if (controller.signal.aborted) return;
      setError(message); setStatus("error");
    };
    import("@/lib/vfx/scene-runtime").then(async ({ createSceneRuntime }) => {
      if (controller.signal.aborted) return;
      dispose = await createSceneRuntime({
        host: element, signal: controller.signal, interactive: !animated,
        animated, getTime: () => clock.current, onError: fail,
      });
      if (!controller.signal.aborted && dispose) setStatus("ready");
    }).catch(error => fail(error instanceof Error ? error.message : "Unable to start the graphics renderer."));
    return () => { controller.abort(); dispose?.(); };
  }, [animated, attempt]);
  return <div className={`scene-container ${animated ? "scene-decorative" : "scene-interactive"}`}>
    <div ref={host} className="scene-host" />
    {status === "loading" && <div className="scene-status" role="status"><span className="scene-loader" /> Preparing the scene</div>}
    {status === "error" && <div className="scene-status scene-error" role="alert"><strong>Scene unavailable</strong><p>{error}</p><button onClick={() => { setStatus("loading"); setError(""); setAttempt(value => value + 1); }}>Reload scene</button></div>}
  </div>;
}
