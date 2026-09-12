import { createHash } from "node:crypto";
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2),
  files = args.filter((a) => !a.startsWith("--"));
if (!files.length)
  throw Error(
    "Pass one or more effect JSON paths; optional --software uses SwiftShader.",
  );
const { chromium } = await import(
  process.env.AUTOV_PLAYWRIGHT_MODULE || "playwright"
);
const bundle = await build({
  entryPoints: ["scripts/profile-playback-browser.ts"],
  bundle: true,
  format: "iife",
  globalName: "Profiler",
  write: false,
  platform: "browser",
  minify: true,
});
const software = args.includes("--software");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AUTOV_CHROME_PATH
    ? { executablePath: process.env.AUTOV_CHROME_PATH }
    : {}),
  args: software
    ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : process.platform === "darwin"
      ? ["--use-angle=metal"]
      : [],
});
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(
    new URL(
      "/api/local-vfx",
      process.env.AUTOV_TEST_URL || "http://127.0.0.1:3031",
    ).href,
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const file of files) {
    const raw = await readFile(file, "utf8"),
      doc = JSON.parse(raw);
    const result = await page.evaluate((doc) => Profiler.profile(doc), doc);
    results.push({
      file,
      documentSha256: createHash("sha256").update(raw).digest("hex"),
      ...result,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await browser.close();
}
const out = path.resolve(
  process.env.AUTOV_PROFILE_OUT || ".autov-local/playback-profile.json",
);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify({ created: new Date().toISOString(), results }, null, 2),
);
