import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
const archive = path.resolve(".autov-local/trials"),
  out = path.resolve(
    process.env.AUTOV_REVIEW_OUT || ".autov-local/morning-review",
  );
const dataset = path.resolve(
  process.env.AUTOV_BENCHMARK_DATASET || "../../benchmark-verified-2026-09-13",
);
await mkdir(out, { recursive: true });
const all = [];
for (const entry of await readdir(archive, { withFileTypes: true }))
  if (entry.isDirectory() && /^[a-zA-Z0-9-]+$/.test(entry.name)) {
    try {
      all.push(
        JSON.parse(
          await readFile(
            path.join(archive, entry.name, "summary.json"),
            "utf8",
          ),
        ),
      );
    } catch {}
  }
const cases = (await readdir(path.join(dataset, "inputs/cases")))
  .filter((id) => /^fx\d\d-[a-z0-9-]+$/.test(id))
  .sort();
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const link = (t, file) =>
  esc(encodeURI(path.relative(out, path.join(archive, t.id, file))));
const weighted = (r) =>
  r && r.sufficientEvidence
    ? (
        r.semantic * 0.35 +
        r.motion * 0.25 +
        r.hierarchy * 0.25 +
        r.finish * 0.15
      ).toFixed(2)
    : "未評価";
const css = `*{box-sizing:border-box}body{margin:0;background:#101613;color:#e1e9e2;font:15px/1.65 system-ui}main{max-width:1440px;margin:auto;padding:36px}a{color:#d0e9c0}button{background:#304734;color:#e1e9e2;border:1px solid #fff3;padding:10px 16px;border-radius:8px;cursor:pointer;font:inherit}h1{font-size:34px;letter-spacing:-1px;margin:12px 0}h2{font-size:20px;margin:10px 0}small,.muted{color:#a1b0a5}.stats{display:flex;gap:24px;flex-wrap:wrap;margin:28px 0}.stat{padding:18px 25px;border:1px solid #fff2;border-radius:12px}.stat b{display:block;font-size:30px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px}article{border:1px solid #fff2;border-radius:12px;background:#19221c;overflow:hidden}article img{width:100%;display:block}article>div{padding:18px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:20px}video{width:100%;aspect-ratio:16/9;background:#060907}details{margin:20px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #fff2;padding:10px}.pill{display:inline-block;background:#2d4030;padding:5px 10px;border-radius:8px;margin:4px 6px 4px 0}.prompt{white-space:pre-wrap}.refs{display:flex;gap:10px}.refs img{width:31%;object-fit:contain}@media(max-width:800px){main{padding:18px}.compare{grid-template-columns:1fr}.grid{grid-template-columns:1fr}h1{font-size:27px}}`;
const page = (title, body) =>
  `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style><main>${body}</main></html>`;
const variant = (t) =>
  t.id.endsWith("-structural")
    ? "構造修正"
    : t.id.endsWith("-refined")
      ? "パラメーター修正"
      : /-\d+$/.test(t.id)
        ? `生成案 ${Number(t.id.match(/-(\d+)$/)[1]) + 1}`
        : "生成案";
const timeLabel = (t) =>
  new Date(t.created).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const completed = [];
for (const entry of await readdir(path.resolve(".autov-local/benchmarks"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  try {
    const report = JSON.parse(
      await readFile(
        path.resolve(".autov-local/benchmarks", entry.name, "report.json"),
        "utf8",
      ),
    );
    if (report.endBudget) completed.push(report);
  } catch {}
}
const latestBudget = completed.sort((a, b) =>
  b.created.localeCompare(a.created),
)[0]?.endBudget;
const visualNotes = await readFile(path.join(out, "visual-notes.json"), "utf8")
  .then(JSON.parse)
  .catch(() => ({}));
const cards = [];
let covered = 0;
for (const id of cases) {
  const trials = all
    .filter((t) => t.caseId === id)
    .sort((a, b) => b.created.localeCompare(a.created));
  const chosen = trials.find((t) => t.selected) || trials[0];
  if (!chosen) {
    cards.push(
      `<article><div><small>${esc(id)}</small><h2>生成待ち</h2><p class="muted">まだ実生成の記録はありません。</p></div></article>`,
    );
    continue;
  }
  covered++;
  const input = JSON.parse(
    await readFile(
      path.join(dataset, "inputs/cases", id, "text_image.json"),
      "utf8",
    ),
  );
  const baseline =
    [...trials].reverse().find((t) => t.origin === "generated") || chosen;
  const versions = trials
    .map(
      (t) =>
        `<tr><td>${esc(t.name)}<br><small>${variant(t)} · ${esc(timeLabel(t))}${t.id === chosen.id ? " · 現在の採用案" : t.selected ? " · 過去の試行内採用" : ""}</small></td><td>${weighted(t.review)}</td><td>${t.video ? `<a href="${link(t, "video.webm")}">動画</a> · ` : ""}${t.player ? `<a href="${link(t, "player.html")}">3D再生</a> · ` : ""}<a href="${link(t, "document.json")}">JSON</a></td></tr>`,
    )
    .join("");
  const comparison = `${chosen.video && chosen.referenceVideo ? `<p><button id="play-both">両方を先頭から再生</button> <button id="pause-both">両方を停止</button></p>` : ""}<div class="compare"><section><h2>生成結果 · ${chosen.selected ? "最新の採用案" : "最新の保存案（選定中）"}</h2>${chosen.video ? `<video controls loop preload="metadata" src="${link(chosen, "video.webm")}"></video>` : `<img style="width:100%" src="${link(chosen, "sheet.jpg")}">`}<p>${chosen.player ? `<a class="pill" href="${link(chosen, "player.html")}">インタラクティブに再生・スクラブ ↗</a>` : ""}<a class="pill" href="${link(chosen, "document.json")}">編集用JSON</a></p></section><section><h2>元のエフェクト</h2>${chosen.referenceVideo ? `<video controls loop preload="metadata" src="${link(chosen, "reference.mp4")}"></video><p class="muted">元動画と生成側では尺・時刻が異なる場合があります。生成側のタイミングは入力プロンプトに従います。</p>` : `<p class="muted">このケースの元動画はアーカイブにありません。下の入力画像と比較してください。</p>`}</section></div><script>document.getElementById('play-both')?.addEventListener('click',()=>{for(const v of document.querySelectorAll('video')){v.currentTime=0;v.play().catch(()=>{});}});document.getElementById('pause-both')?.addEventListener('click',()=>{for(const v of document.querySelectorAll('video'))v.pause();});</script>`;
  const note = visualNotes[chosen.id];
  const visualNote = note
    ? `<h2>確認メモ</h2><p>${esc(note.finding)}</p><p><b>残る差：</b>${esc(note.remaining)}</p><small>${esc(note.reviewer)} · ${esc(note.scope)}</small>`
    : "";
  const review = chosen.review
    ? `<h2>自動レビュー</h2><p>${esc(chosen.review.verdict)}</p><p>意味 ${chosen.review.semantic} / 動き ${chosen.review.motion} / 視線誘導 ${chosen.review.hierarchy} / 仕上げ ${chosen.review.finish} · 重み付き ${weighted(chosen.review)}/5</p><details><summary>条件ごとの観測</summary>${chosen.review.observations.map((x) => `<p><b>${esc(x.result)}</b> · ${esc(x.criterion)}<br>${esc(x.evidence)}</p>`).join("")}</details>`
    : `<p>この案は視覚的な自動レビュー未実施です。</p>`;
  await writeFile(
    path.join(out, `${id}.html`),
    page(
      id,
      `<a href="index.html">← 全ケース</a><h1>${esc(id)}</h1><p>${esc(chosen.name)} · ${trials.length}案保存 · ${esc(input.split)}</p>${comparison}${visualNote}${review}<p class="muted">自動評価は候補選択の補助です。再現度の合格や人による承認を意味しません。</p><h2>最初の案と比較</h2><p>${baseline.video ? `<a href="${link(baseline, "video.webm")}">初回生成の動画 ↗</a>` : ""} · <a href="${link(baseline, "player.html")}">初回生成の3D再生 ↗</a></p><h2>保存した全バージョン</h2><table><thead><tr><th>案</th><th>AI評価</th><th>開く</th></tr></thead><tbody>${versions}</tbody></table><details><summary>入力プロンプト・参照画像</summary><p class="prompt">${esc(chosen.prompt)}</p><div class="refs">${Array.from({ length: chosen.references }, (_, i) => `<img src="${link(chosen, `reference-${i}`)}" alt="入力参照 ${i + 1}">`).join("")}</div></details>`,
    ),
  );
  cards.push(
    `<article><a href="${id}.html"><img src="${link(chosen, "sheet.jpg")}" alt="${esc(chosen.name)}の実描画フレーム"></a><div><small>${esc(id)} · ${esc(input.split)}</small><h2>${esc(chosen.name)}</h2><p>${trials.length}案 · 自動評価 ${weighted(chosen.review)}${chosen.review?.sufficientEvidence ? "/5" : ""}</p><a class="pill" href="${id}.html">生成動画と元動画を比較 ↗</a></div></article>`,
  );
}
await writeFile(
  path.join(out, "index.html"),
  page(
    "autoV · 朝のVFXレビュー",
    `<small>autoV · LOCAL GENERATION REVIEW</small><h1>生成したエフェクトを見る</h1><p class="muted">各ケースの実生成動画・元動画・編集可能な3Dプレイヤーをまとめました。採用されなかった案もケース内に残しています。この一覧はサーバーを止めても開けます。</p><div class="stats"><div class="stat"><b>${covered} / ${cases.length}</b>実生成したケース</div><div class="stat"><b>${all.length}</b>保存した案</div><div class="stat"><b>要レビュー</b>再現度の最終判断</div>${latestBudget ? `<div class="stat"><b>$${latestBudget.used.toFixed(2)} / $${latestBudget.limit}</b>最終完了試行時のAPI使用・予約額</div>` : ""}</div><p><a href="${esc(encodeURI(path.relative(out, path.join(archive, "index.html"))))}">全試行を一覧で開く</a> · <a href="http://127.0.0.1:3031/local/trials">アプリで開く（起動中）</a></p><div class="grid">${cards.join("")}</div><p class="muted">更新 ${esc(new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }))} JST · 入力画像とプロンプトをアプリに渡して生成した記録です。元動画は比較用に後から添付しています。</p>`,
  ),
);
console.log(
  JSON.stringify({
    index: path.join(out, "index.html"),
    covered,
    totalCases: cases.length,
    trials: all.length,
  }),
);
