import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { trialDirectory } from "../src/lib/vfx-lab/trials";
test("trial identifiers cannot escape the local archive", () => {
  for (const id of ["../budget", "a/b", "%2e%2e", "", "x".repeat(101)])
    assert.throws(() => trialDirectory(id));
  assert.match(trialDirectory("a1-valid-42"), /a1-valid-42$/);
});
test("saved trials survive a new process and cannot overwrite their source document", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "autov-trials-test-")),
    testModule = resolve("src/lib/vfx-lab/trials.ts"),
    recipes = resolve("src/lib/vfx-lab/recipes.ts");
  const execute = (code: string) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        "-e",
        `const {saveTrial,listTrials}=require(${JSON.stringify(testModule)}),{createPreset}=require(${JSON.stringify(recipes)});const input={id:"test-1",source:"openai-live",origin:"generated",selected:true,prompt:"test prompt",document:createPreset("magic"),references:[],sheet:"data:image/jpeg;base64,/9j/"};(async()=>{${code}})().catch(e=>{console.error(e.message);process.exit(1)})`,
      ],
      { cwd, encoding: "utf8" },
    );
  try {
    const saved = execute("await saveTrial(input)");
    assert.equal(saved.status, 0, saved.stderr);
    const list = JSON.parse(
      execute("console.log(JSON.stringify(await listTrials()))").stdout,
    );
    assert.equal(list.length, 1);
    assert.equal(list[0].prompt, "test prompt");
    assert.equal(
      execute("await saveTrial({...input,selected:false})").status,
      0,
    );
    const changed = execute(
      "input.document.name='changed';await saveTrial(input)",
    );
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /immutable/);
    assert.equal(
      JSON.parse(
        execute("console.log(JSON.stringify(await listTrials()))").stdout,
      )[0].name,
      list[0].name,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
