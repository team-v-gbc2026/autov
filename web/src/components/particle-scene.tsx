"use client";

import { useEffect, useRef } from "react";

export default function ParticleScene({ time = 0, animated = false }: { time?: number; animated?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef(time);
  useEffect(() => { clock.current = time; }, [time]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (now: number) => {
      const { width, height } = element.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
        element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const t = animated && !reduced ? now / 2200 : clock.current * .48;
      const radius = Math.min(width * .27, height * .32, 270);
      const cx = width / 2; const cy = height * .46;
      const glow = context.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.5);
      glow.addColorStop(0, "rgba(155,166,174,.07)"); glow.addColorStop(1, "rgba(100,110,120,0)");
      context.fillStyle = glow; context.fillRect(0, 0, width, height);
      for (let i = 0; i < 4200; i++) {
        const a = i * 2.399963;
        const b = Math.acos(1 - 2 * (i + .5) / 4200);
        const ripple = 1 + .09 * Math.sin(b * 12 + a * 3 + t);
        const x = Math.sin(b) * Math.cos(a + t * .16) * ripple;
        const z = Math.sin(b) * Math.sin(a + t * .16) * ripple;
        const y = Math.cos(b) * ripple;
        const px = x * .93 + y * .28;
        const py = y * .77 - x * .23 + z * .18;
        const perspective = 1 + z * .16;
        context.fillStyle = `rgba(218,225,229,${.13 + (z + 1) * .31})`;
        context.beginPath(); context.arc(cx + px * radius * perspective, cy + py * radius * perspective, .45 + (z + 1) * .47, 0, Math.PI * 2); context.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [animated]);
  return <canvas ref={canvas} className="particle-canvas" aria-label="Animated silver particle sphere concept preview" role="img" />;
}
