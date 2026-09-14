/** Local viewer configuration; effect documents and exported runtimes stay portable. */
export function viewerGpuPreference(): "high-performance" | "low-power" {
  return process.env.NEXT_PUBLIC_VFX_GPU_PREFERENCE === "low-power"
    ? "low-power"
    : "high-performance";
}
