// Re-render a saved document with the current renderer; never overwrite the original trial.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
const [source, destination] = process.argv.slice(2);
if (!source || !destination)
  throw Error(
    "Usage: node scripts/rerender-trial.mjs source.json new-output-directory",
  );
const out = path.resolve(destination);
try {
  await access(path.join(out, "result.json"));
  throw Error("Choose a new output directory; comparisons are immutable");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await mkdir(out, { recursive: true });
const doc = JSON.parse(await readFile(source, "utf8"));
const { chromium } = await import(
  process.env.AUTOV_PLAYWRIGHT_MODULE || "playwright"
);
const bundle = await build({
  entryPoints: ["scripts/benchmark-browser.ts"],
  bundle: true,
  format: "iife",
  globalName: "Probe",
  write: false,
  platform: "browser",
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AUTOV_CHROME_PATH
    ? { executablePath: process.env.AUTOV_CHROME_PATH }
    : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(
    new URL(
      "/api/local-vfx",
      process.env.AUTOV_TEST_URL || "http://127.0.0.1:3031",
    ).href,
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(
    async (doc) => Probe.render(doc, true),
    doc,
  );
  const decode = (data) =>
    Buffer.from(data.substring(data.indexOf(",") + 1), "base64");
  await writeFile(path.join(out, "document.json"), JSON.stringify(doc));
  await writeFile(
    path.join(out, "contact-sheet.jpg"),
    decode(result.evidence.sheet),
  );
  if (result.webm)
    await writeFile(path.join(out, "video.webm"), decode(result.webm));
  for (const [i, f] of result.frames.entries())
    await writeFile(path.join(out, `frame-${i}.png`), decode(f.png));
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        ...result,
        evidence: { ...result.evidence, sheet: undefined },
        frames: result.frames.map((f, i) => ({
          time: f.time,
          file: `frame-${i}.png`,
        })),
        webm: undefined,
        source: path.resolve(source),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      out,
      gates: result.gates,
      performance: result.performance,
    }),
  );
} finally {
  await browser.close();
}
