import { browserOptions } from "./browser-options.mjs";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { recordVideo } from "./deterministic-video.mjs";
const root = path.resolve(".autov-local/benchmarks"),
  trialRoot = path.resolve(".autov-local/trials"),
  dataset = path.resolve(
    process.env.AUTOV_BENCHMARK_DATASET ||
      "../../benchmark-verified-2026-09-13",
  );
await mkdir(trialRoot, { recursive: true });
// Evaluation media is attached only to the completed trial archive, never sent to generation.
const specs = await readFile(
  path.join(dataset, "evaluation/case_specs.json"),
  "utf8",
)
  .then(JSON.parse)
  .catch(() => []);
const { chromium } = await import(
  process.env.AUTOV_PLAYWRIGHT_MODULE || "playwright"
);
const built = await build({
  stdin: {
    contents:
      'export {render} from "./scripts/benchmark-browser"; export {exportHtml} from "./src/lib/vfx-lab/export";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "Archive",
  write: false,
  platform: "browser",
  minify: true,
});
const browser = await chromium.launch(browserOptions());
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(
  new URL(
    "/api/local-vfx",
    process.env.AUTOV_TEST_URL || "http://127.0.0.1:3031",
  ).href,
);
await page.addScriptTag({ content: built.outputFiles[0].text });
const decode = (data) =>
  Buffer.from(data.substring(data.indexOf(",") + 1), "base64");
let saved = 0;
try {
  for (const run of await readdir(root, { withFileTypes: true })) {
    if (!run.isDirectory()) continue;
    const runDir = path.join(root, run.name);
    for (const entry of await readdir(runDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(runDir, entry.name);
      let pipeline;
      try {
        pipeline = JSON.parse(
          await readFile(path.join(dir, "pipeline.json"), "utf8"),
        );
      } catch {
        continue;
      }
      const historicalRuntime = await readFile(
        path.join(runDir, "runtime.js"),
        "utf8",
      ).catch(() => undefined);
      if (historicalRuntime)
        await page.addScriptTag({ content: historicalRuntime });
      // A v2 run archives its own player bundle next to the v1 one.
      const historicalRuntimeV2 = await readFile(
        path.join(runDir, "runtime-v2.js"),
        "utf8",
      ).catch(() => undefined);
      let input;
      try {
        input = JSON.parse(
          await readFile(path.join(dir, "input.json"), "utf8"),
        );
      } catch {
        input = JSON.parse(
          await readFile(
            path.join(dataset, "inputs/cases", entry.name, "text_image.json"),
            "utf8",
          ),
        );
      }
      input.case_id = entry.name;
      const sourceVideo = specs.find(
        (s) => s.case_id === entry.name,
      )?.source_video;
      const referenceVideo =
        typeof sourceVideo === "string" &&
        /^references\/videos\/[A-Za-z0-9_-]+\.mp4$/.test(sourceVideo)
          ? await readFile(path.join(dataset, sourceVideo)).catch(() => null)
          : null;
      for (const candidate of pipeline.candidates) {
        if (!/^[a-zA-Z0-9-]{1,100}$/.test(candidate.id))
          throw Error("Invalid candidate ID");
        const dest = path.join(trialRoot, candidate.id);
        try {
          const old = JSON.parse(
            await readFile(path.join(dest, "summary.json"), "utf8"),
          );
          if (old.video && old.player && old.videoFps === 30) {
            if (referenceVideo && !old.referenceVideo) {
              await writeFile(path.join(dest, "reference.mp4"), referenceVideo);
              old.referenceVideo = true;
              await writeFile(
                path.join(dest, "summary.json"),
                JSON.stringify(old, null, 2),
              );
            }
            continue;
          }
        } catch {}
        await mkdir(dest, { recursive: true, mode: 0o700 });
        if (referenceVideo)
          await writeFile(path.join(dest, "reference.mp4"), referenceVideo);
        await writeFile(
          path.join(dest, "document.json"),
          JSON.stringify(candidate.document),
        );
        await writeFile(
          path.join(dest, "sheet.jpg"),
          decode(candidate.evidence.sheet),
        );
        const references = [];
        const sources = input.references || input.reference_images || [];
        for (let i = 0; i < sources.length; i++) {
          const file = sources[i],
            bytes = file.startsWith("data:")
              ? decode(file)
              : await readFile(path.join(dataset, file));
          await writeFile(path.join(dest, `reference-${i}`), bytes);
          references.push({ filename: `reference-${i}` });
        }
        await writeFile(
          path.join(dest, "input.json"),
          JSON.stringify({ prompt: input.prompt, references }, null, 2),
        );
        const isV2Document = candidate.document.schemaVersion === "autov.lab/2";
        const playerBundle = isV2Document
          ? historicalRuntimeV2
          : historicalRuntime;
        const videoCapture = await recordVideo(
          page,
          candidate.document,
          path.join(dest, "video.webm"),
          playerBundle,
        );
        const html = await page.evaluate(
          async ({ doc, bundle }) => Archive.exportHtml(doc, bundle),
          { doc: candidate.document, bundle: playerBundle },
        );
        await writeFile(path.join(dest, "player.html"), html);
        const summary = {
          id: candidate.id,
          name: candidate.document.name,
          created: (
            await stat(path.join(dir, "pipeline.json"))
          ).mtime.toISOString(),
          caseId: input.case_id,
          source: "openai-live",
          origin: candidate.origin,
          selected: candidate.id === pipeline.selected.id,
          duration: candidate.document.duration,
          layers: candidate.document.layers.length,
          references: references.length,
          prompt: input.prompt,
          review: candidate.review,
          runUsageUsd: pipeline.usages.reduce((n, u) => n + u.usd, 0),
          video: true,
          videoFps: videoCapture.fps,
          videoFrames: videoCapture.frames,
          player: true,
          referenceVideo: Boolean(referenceVideo),
          run: run.name,
        };
        await writeFile(
          path.join(dest, "summary.json"),
          JSON.stringify(summary, null, 2),
        );
        saved++;
        console.log(`Archived ${input.case_id}: ${candidate.document.name}`);
      }
    }
  }
  // A static local index survives server restarts and works from Finder.
  const all = [];
  for (const e of await readdir(trialRoot, { withFileTypes: true })) {
    if (e.isDirectory())
      try {
        all.push(
          JSON.parse(
            await readFile(
              path.join(trialRoot, e.name, "summary.json"),
              "utf8",
            ),
          ),
        );
      } catch {}
  }
  const escape = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  await writeFile(
    path.join(trialRoot, "index.html"),
    `<!doctype html><html lang="ja"><meta charset="utf-8"><title>autoV generation trials</title><style>body{background:#101613;color:#d9e5de;font:15px system-ui;padding:32px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:24px}article{border:1px solid #ffffff20;border-radius:10px;overflow:hidden;background:#19211d}article>div{padding:18px}img{width:100%}a{color:#b7d7ae}p{color:#a2aea6;line-height:1.6}details{white-space:pre-wrap}h2{font-size:19px}</style><h1>autoV · 生成トライアル</h1><p>${all.length}案を保存。画像は実際に描画した時間順のフレームです。各案の動画・3D再生・元のプロンプトを確認できます。</p><main>${all
      .sort((a, b) => b.created.localeCompare(a.created))
      .map(
        (t) =>
          `<article><img src="${t.id}/sheet.jpg"><div><small>${escape(t.caseId || "Studio")} · ${t.origin === "refined" ? "改善案" : "生成案"}</small><h2>${escape(t.name)}</h2><p>${t.duration}s · ${t.layers} layers</p>${t.player ? `<a href="${t.id}/player.html">3Dで再生・スクラブ ↗</a> · ` : ""}${t.video ? `<a href="${t.id}/video.webm">動画 ↗</a> · ` : ""} <a href="${t.id}/document.json">JSON ↓</a>${t.referenceVideo ? ` · <a href="${t.id}/reference.mp4">元動画 ↗</a>` : ""}<details><summary>プロンプト・参照</summary><p>${escape(t.prompt)}</p>${Array.from({ length: t.references }, (_, i) => `<img src="${t.id}/reference-${i}">`).join("")}</details><p>${escape(t.review?.verdict || "見た目の評価は未記入です。生成・描画の成功は再現度の合格を意味しません。")}</p></div></article>`,
      )
      .join("")}</main></html>`,
  );
  console.log(
    JSON.stringify({
      saved,
      total: all.length,
      index: path.join(trialRoot, "index.html"),
    }),
  );
} finally {
  await browser.close();
}
