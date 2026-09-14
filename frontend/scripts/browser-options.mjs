// Prefer the real Metal GPU on macOS; portable CI can explicitly select SwiftShader.
export function browserOptions() {
  const angle =
    process.env.AUTOV_BROWSER_ANGLE ||
    (process.platform === "darwin" ? "metal" : "swiftshader");
  if (!["metal", "swiftshader", "default"].includes(angle))
    throw Error("Unsupported AUTOV_BROWSER_ANGLE");
  return {
    headless: true,
    ...(process.env.AUTOV_CHROME_PATH
      ? { executablePath: process.env.AUTOV_CHROME_PATH }
      : {}),
    args:
      angle === "default"
        ? []
        : [
            "--use-angle=" + angle,
            ...(angle === "swiftshader" ? ["--enable-unsafe-swiftshader"] : []),
          ],
  };
}

/** V2 uses native WebGPU. Linux CI software mode requires xvfb-run.
 *
 * Hardware runs need the full Chromium build: Playwright's default headless
 * shell reports `navigator.gpu` but hands out no adapter, and forcing WebGPU on
 * there falls back to a software path that fails to build these shaders.
 */
export function webgpuBrowserOptions() {
  const software = process.env.AUTOV_WEBGPU_SOFTWARE === "1";
  return {
    headless: !software,
    ...(software || process.env.AUTOV_CHROME_PATH
      ? {}
      : { channel: "chromium" }),
    ...(process.env.AUTOV_CHROME_PATH
      ? { executablePath: process.env.AUTOV_CHROME_PATH }
      : {}),
    // Headless Chromium exposes navigator.gpu but hands out no adapter until
    // WebGPU is explicitly enabled; hardware runs stay headless with it.
    args: software
      ? [
          "--enable-unsafe-webgpu",
          "--enable-gpu",
          "--enable-features=Vulkan",
          "--use-vulkan=swiftshader",
          "--disable-vulkan-surface",
          "--use-angle=vulkan",
          "--use-webgpu-adapter=swiftshader",
          // Compiling/rasterizing the full preview on a CPU can exceed the
          // GPU watchdog deadline. Hardware verification keeps its defaults.
          "--disable-gpu-watchdog",
        ]
      : [],
  };
}
