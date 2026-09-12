import { build } from "esbuild";
import { spawn, execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { rename, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
let bundle;
// Rendering speed never changes the effect's timing: every video frame is sampled at n/30.
export async function recordVideo(page, doc, filename, runtimeBundle) {
  const fps = 30,
    frames = Math.round(doc.duration * fps) + 1;
  bundle ||= await build({
    entryPoints: ["scripts/video-capture-browser.ts"],
    bundle: true,
    format: "iife",
    globalName: "VideoCapture",
    write: false,
    platform: "browser",
    minify: true,
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  if (runtimeBundle) await page.addScriptTag({ content: runtimeBundle });
  await page.evaluate(
    async ({ doc, historical }) =>
      VideoCapture.begin(doc, historical ? AutoV.VfxRuntime : undefined),
    { doc, historical: Boolean(runtimeBundle) },
  );
  const temp = filename + "." + randomUUID() + ".partial";
  const encoder = spawn(
    process.env.AUTOV_FFMPEG_PATH || "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "image2pipe",
      "-framerate",
      String(fps),
      "-vcodec",
      "png",
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "28",
      "-b:v",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-f",
      "webm",
      temp,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  encoder.stderr.on("data", (b) => {
    stderr = (stderr + b).slice(-4000);
  });
  const complete = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`Video encoding failed: ${stderr}`)),
    );
  });
  async function* images() {
    for (let i = 0; i < frames; i++) {
      const data = await page.evaluate(
        (t) => VideoCapture.frame(t),
        Math.min(doc.duration, i / fps),
      );
      yield Buffer.from(data.substring(data.indexOf(",") + 1), "base64");
    }
  }
  try {
    await Promise.all([
      pipeline(Readable.from(images()), encoder.stdin),
      complete,
    ]);
    await rename(temp, filename);
    const probe = JSON.parse(
      execFileSync(
        process.env.AUTOV_FFPROBE_PATH || "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=avg_frame_rate,nb_read_frames,width,height",
          "-of",
          "json",
          filename,
        ],
        { encoding: "utf8" },
      ),
    ).streams[0];
    if (
      probe.avg_frame_rate !== "30/1" ||
      Number(probe.nb_read_frames) !== frames
    )
      throw Error("Encoded video frame count/rate mismatch");
    const result = {
      fps,
      frames,
      width: probe.width,
      height: probe.height,
      method: "deterministic time samples, not measured real-time performance",
    };
    await writeFile(filename + ".json", JSON.stringify(result, null, 2));
    return result;
  } finally {
    encoder.kill();
    await page.evaluate(() => VideoCapture.end()).catch(() => {});
    await unlink(temp).catch(() => {});
  }
}
