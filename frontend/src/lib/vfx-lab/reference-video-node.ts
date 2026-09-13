// ---------------------------------------------------------------------------
// Reference clip decoding, node side.
//
// The measure stage runs in the capture browser, and a headless Chromium has no
// proprietary video codecs: handing it an H.264 clip and hoping is not a plan.
// So a local run decodes the clip here, with the ffmpeg the benchmark already
// requires, and sends the browser a short strip of frames instead.
//
// Local-only by construction: nothing in this file is reachable unless
// AUTOV_LOCAL_MODE is set and the request came from localhost.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Frames are decoded at the resolution the render's features are measured at. */
export const REFERENCE_DECODE_SIZE: [number, number] = [640, 360];
export const REFERENCE_DECODE_FPS = 10;
/** Enough for a twelve-second clip at 10 fps; fx01's replays beyond that. */
export const REFERENCE_DECODE_MAX_FRAMES = 120;
export const MAX_REFERENCE_VIDEO_BYTES = 128_000_000;
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const DATA_URL = /^data:video\/(mp4|webm|quicktime);base64,([A-Za-z0-9+/=]+)$/;

export interface ReferenceFrames {
  kind: "frames";
  fps: number;
  frames: string[];
}

export const localModeEnabled = () =>
  process.env.AUTOV_LOCAL_MODE === "1" ||
  process.env.AUTOV_LOCAL_MODE === "true";

/**
 * Resolve a caller-supplied reference clip to a readable file. A path is only
 * honoured in local mode; it must stay inside the working directory tree or be
 * an absolute path the operator gave us, and it must look like a video.
 */
async function resolveClip(
  input: string,
  scratch: string,
): Promise<string> {
  const asData = input.match(DATA_URL);
  if (asData) {
    const bytes = Buffer.from(asData[2], "base64");
    if (bytes.length > MAX_REFERENCE_VIDEO_BYTES)
      throw new Error("Reference clip is too large.");
    const file = path.join(scratch, `reference.${asData[1] === "webm" ? "webm" : "mp4"}`);
    await writeFile(file, bytes);
    return file;
  }
  if (input.startsWith("data:"))
    throw new Error("Unsupported reference clip data URL.");
  if (!localModeEnabled())
    throw new Error("A reference clip path is only accepted in local mode.");
  const file = path.resolve(process.cwd(), input);
  if (!VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()))
    throw new Error("Reference clip must be an mp4, webm or mov file.");
  const info = await stat(file);
  if (!info.isFile()) throw new Error("Reference clip is not a file.");
  if (info.size > MAX_REFERENCE_VIDEO_BYTES)
    throw new Error("Reference clip is too large.");
  return file;
}

/**
 * Decode a reference clip into ascending JPEG data URLs at a fixed rate. The
 * browser reconstructs the times from `fps`, exactly as
 * scripts/calibrate-v2.mjs does.
 */
export async function decodeReferenceVideo(
  input: string,
  options: { fps?: number; maxFrames?: number } = {},
): Promise<ReferenceFrames> {
  const fps = options.fps ?? REFERENCE_DECODE_FPS;
  const maxFrames = options.maxFrames ?? REFERENCE_DECODE_MAX_FRAMES;
  const scratch = await mkdtemp(path.join(tmpdir(), "autov-reference-"));
  try {
    const file = await resolveClip(input, scratch);
    const frames = path.join(scratch, "frames");
    await run(process.env.AUTOV_FFMPEG_PATH || "ffmpeg", [
      "-v", "error",
      "-i", file,
      "-vf", `fps=${fps},scale=${REFERENCE_DECODE_SIZE[0]}:${REFERENCE_DECODE_SIZE[1]}`,
      "-frames:v", String(maxFrames),
      "-q:v", "4",
      "-y", `${frames}-%05d.jpg`,
    ]);
    const names = (await readdir(scratch))
      .filter((name) => name.startsWith("frames-") && name.endsWith(".jpg"))
      .sort();
    if (names.length < 4)
      throw new Error("The reference clip decoded to fewer than four frames.");
    const out: string[] = [];
    for (const name of names)
      out.push(
        `data:image/jpeg;base64,${(
          await readFile(path.join(scratch, name))
        ).toString("base64")}`,
      );
    return { kind: "frames", fps, frames: out };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
