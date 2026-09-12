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
