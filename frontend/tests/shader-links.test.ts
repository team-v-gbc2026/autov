import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Shader link/validate regression.
//
// Every v2 program is assembled from string fragments, so a uniform used in one
// variant and declared only in another is invisible to tsc, invisible to the
// linter and invisible to every other test in this suite: the GLSL only fails
// when the browser links it. Three.js logs that and keeps going — the draw is
// skipped, a whole pass vanishes from the frame, and the only trace is the
// GL_INVALID_OPERATION (1282) the following useProgram leaves in the queue.
// That is how splashFragmentV2 shipped referencing the blob's `uShade`: every
// splash layer in every document drew nothing at all.
//
// scripts/verify-shader-links.mjs renders every exemplar through the real
// runtime on SwiftShader and exits non-zero on any shader message or non-zero
// gl.getError(). It runs as a CHILD PROCESS, not an import: the harness owns a
// browser, an http server and an esbuild service, and none of those unwind
// cleanly inside the node test runner's own child — imported in-process it
// simply never returns.
//
// It is slow (about five minutes of SwiftShader), so it is opt-out rather than
// opt-in: set AUTOV_SKIP_SHADER_LINKS=1 to skip it in a tight edit loop. It
// also skips, rather than failing the suite, where chromium cannot launch.
// ---------------------------------------------------------------------------

const SCRIPT = path.join(process.cwd(), "scripts", "verify-shader-links.mjs");
/** Five minutes of SwiftShader plus headroom for a cold browser start. */
const TIMEOUT_MS = 15 * 60 * 1000;

test("every exemplar links and validates every shader it draws", { timeout: TIMEOUT_MS + 60_000 }, (t) => {
  if (process.env.AUTOV_SKIP_SHADER_LINKS === "1") {
    t.skip("AUTOV_SKIP_SHADER_LINKS=1");
    return;
  }
  assert.ok(existsSync(SCRIPT), `missing ${SCRIPT}`);
  // tsx runs this file by injecting itself through NODE_OPTIONS. The child is
  // plain ESM and does not want that loader — inherited, it wedges before the
  // script's first line and nothing ever comes back — so the child runs with a
  // clean NODE_OPTIONS.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const run = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    cwd: process.cwd(),
    env,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  // An environment without a usable chromium is not a broken shader.
  if (/Executable doesn't exist|playwright install|Cannot find module 'playwright'/.test(output)) {
    t.skip("headless chromium unavailable");
    return;
  }
  if (run.error) {
    t.skip(`shader harness unavailable: ${run.error.message}`);
    return;
  }
  assert.equal(
    run.status,
    0,
    `a shader failed to compile, link or validate:\n${output}`,
  );
  // A silent pass would also satisfy status 0; require the per-exemplar lines.
  assert.ok(
    (output.match(/^ok\s/gm) ?? []).length >= 10,
    `expected a line per exemplar, got:\n${output}`,
  );
});
