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

/** V2 uses native WebGPU. Linux CI software mode requires xvfb-run. */
export function webgpuBrowserOptions() {
  const software = process.env.AUTOV_WEBGPU_SOFTWARE === "1";
  // Headless chromium on Linux hands back no WebGPU adapter at all until
  // Vulkan is turned on explicitly. On a laptop with two GPUs the loader
  // enumerates both and the device is lost mid-render, so pin one ICD:
  //   VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json
  if (!software && process.platform === "linux")
    return {
      headless: true,
      ...(process.env.AUTOV_CHROME_PATH
        ? { executablePath: process.env.AUTOV_CHROME_PATH }
        : {}),
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--use-angle=vulkan",
      ],
    };
  return {
    headless: !software,
    ...(process.env.AUTOV_CHROME_PATH
      ? { executablePath: process.env.AUTOV_CHROME_PATH }
      : {}),
    args: software
      ? [
          "--enable-unsafe-webgpu",
          "--enable-gpu",
          "--enable-features=Vulkan",
          "--use-vulkan=swiftshader",
          "--disable-vulkan-surface",
          "--use-angle=vulkan",
          "--use-webgpu-adapter=swiftshader",
        ]
      : [],
  };
}
