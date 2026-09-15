import type { VfxDocumentV2 } from "@/lib/vfx-lab/schema-v2";

/** Color/timing edits preserve the user's orbit; authored camera edits do not. */
export function needsWorkspaceFraming(previous: VfxDocumentV2 | null, next: VfxDocumentV2, framed: boolean) {
  if (!framed || !previous) return true;
  if (!previous.layers.some(layer => layer.enabled) && next.layers.some(layer => layer.enabled)) return true;
  return (["azimuth", "elevation", "fov", "framing"] as const)
    .some(key => previous.camera[key] !== next.camera[key]);
}

/** CSS-pixel area shared by initial framing and the explicit Focus action. */
export function workspaceVisibleArea(host: HTMLElement) {
  const canvas = host.getBoundingClientRect();
  const studio = host.closest(".studio");
  let left = 0, right = canvas.width, top = 0, bottom = canvas.height;
  let occupied = false;
  for (const panel of studio?.querySelectorAll<HTMLElement>("aside, #playback-timeline") ?? []) {
    if (!panel.getClientRects().length) continue;
    const rect = panel.getBoundingClientRect();
    occupied = true;
    if (panel.id === "playback-timeline") bottom = Math.min(bottom, rect.top - canvas.top - 16);
    else if (panel.classList.contains("chat-panel")) right = Math.min(right, rect.left - canvas.left - 16);
    else left = Math.max(left, rect.right - canvas.left + 16);
  }
  if (occupied) {
    const strip = studio?.querySelector(".lab-environment-strip")?.getBoundingClientRect();
    top = strip ? strip.bottom - canvas.top + 16 : 0;
  }
  if (right - left < 32 || bottom - top < 32) return null;
  return { left, top, width: right - left, height: bottom - top };
}
