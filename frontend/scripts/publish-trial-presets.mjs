import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateDocument } = require("../src/lib/vfx-lab/schema.ts");
const args = process.argv.slice(2),
  arg = (n, f) => (args.includes(n) ? args[args.indexOf(n) + 1] : f);
if (!args.includes("--publish"))
  throw Error(
    "Explicit --publish required: generated output files will be copied into public/.",
  );
const archive = path.resolve(arg("--archive", ".autov-local/trials")),
  out = path.resolve(arg("--out", "public/trial-presets"));
const ledger = JSON.parse(
  await readFile(arg("--ledger", ".autov-local/budget.json"), "utf8"),
);
const notes = await readFile(
  ".autov-local/morning-review/visual-notes.json",
  "utf8",
)
  .then(JSON.parse)
  .catch(() => ({}));
const settled = ledger.entries.filter((e) => e.state === "settled"),
  pending = ledger.entries.filter((e) => e.state === "reserved");
const usage = {
  inputTokens: settled.reduce((a, e) => a + e.input, 0),
  outputTokens: settled.reduce((a, e) => a + e.output, 0),
  settledEstimateUsd: settled.reduce((a, e) => a + e.usd, 0),
  reservedUsd: pending.reduce((a, e) => a + e.usd, 0),
  limitUsd: ledger.limit,
  pendingRequests: pending.length,
};
if (Object.values(usage).some((v) => !Number.isFinite(v) || v < 0))
  throw Error("Invalid usage totals");
const trials = [];
for (const entry of await readdir(archive, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[-a-zA-Z0-9]{1,100}$/.test(entry.name))
    continue;
  const dir = path.join(archive, entry.name),
    s = JSON.parse(await readFile(path.join(dir, "summary.json"), "utf8"));
  if (s.source !== "openai-live" || !s.video || !s.caseId) continue;
  if (s.id !== entry.name || !/^fx\d\d-[a-z0-9-]+$/.test(s.caseId))
    throw Error("Invalid trial identity");
  const raw = await readFile(path.join(dir, "document.json"));
  const doc = validateDocument(JSON.parse(raw));
  const dest = path.join(out, "effects", s.id);
  await mkdir(dest, { recursive: true });
  await writeFile(path.join(dest, "document.json"), raw);
  const note = notes[s.id];
  trials.push({
    id: s.id,
    caseId: s.caseId,
    name: doc.name,
    created: s.created,
    origin: s.origin,
    selected: !!s.selected,
    duration: doc.duration,
    layers: doc.layers.length,
    documentSha256: createHash("sha256").update(raw).digest("hex"),
    score: s.review?.sufficientEvidence
      ? s.review.semantic * 0.35 +
        s.review.motion * 0.25 +
        s.review.hierarchy * 0.25 +
        s.review.finish * 0.15
      : null,
    note: note ? { finding: note.finding, remaining: note.remaining } : null,
  });
}
trials.sort(
  (a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id),
);
const latest = new Map();
for (const t of trials) {
  const previous = latest.get(t.caseId);
  if (!previous || (!previous.selected && t.selected)) latest.set(t.caseId, t);
}
for (const t of trials) t.latest = latest.get(t.caseId)?.id === t.id;
const manifest = {
  schemaVersion: "autov.shared-trials/1",
  created: new Date().toISOString(),
  draft: true,
  runtime: "autov.lab/1-three-r186-flow11",
  cases: latest.size,
  candidates: trials.length,
  usage,
  trials,
};
await mkdir(out, { recursive: true });
await writeFile(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cards = trials
  .map(
    (t) =>
      `<article data-case="${escape(t.caseId)}" data-latest="${t.latest}" ${t.latest ? "" : "hidden"}><div><small>${escape(t.caseId)} · ${t.latest ? "最新の試行内採用" : "過去の候補"}</small><h2>${escape(t.name)}</h2><p>${t.duration}s · ${t.layers}レイヤー · ${t.score === null ? "AI評価なし" : `生成時AI評価 ${t.score.toFixed(2)}/5`}</p><a href="/workspace?sharedTrial=${t.id}">スタジオで3D再生 →</a> · <a href="effects/${t.id}/document.json" download>JSON ↓</a></div></article>`,
  )
  .join("");
let html = await readFile("scripts/shared-trials/index.html", "utf8");
html = html
  .replace("<!--CARDS-->", cards)
  .replace(
    "<!--CASES-->",
    [...latest.keys()]
      .sort()
      .map((c) => `<option>${escape(c)}</option>`)
      .join(""),
  )
  .replace("<!--COUNT-->", `${latest.size}ケース / ${trials.length}候補`)
  .replace(
    "<!--USAGE-->",
    `入力 ${usage.inputTokens.toLocaleString("en-US")} / 出力 ${usage.outputTokens.toLocaleString("en-US")} tokens · 使用・予約額 $${(usage.settledEstimateUsd + usage.reservedUsd).toFixed(2)} / $${usage.limitUsd}`,
  );
await writeFile(path.join(out, "index.html"), html);
for (const f of ["style.css", "gallery.js"])
  await copyFile(path.join("scripts/shared-trials", f), path.join(out, f));
console.log(
  JSON.stringify({
    cases: manifest.cases,
    candidates: trials.length,
    out,
    usage,
  }),
);
