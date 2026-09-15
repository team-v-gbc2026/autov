import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
test("$30 cumulative ledger survives processes and reserves before calls", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "autov-budget-test-"));
  const budgetModule = resolve("src/lib/vfx-lab/budget.ts"),
    tsx = resolve("node_modules/tsx/dist/cli.mjs");
  const execute = (code: string) =>
    spawnSync(
      process.execPath,
      [
        tsx,
        "-e",
        `import {reserve,settle,budgetStatus} from ${JSON.stringify(budgetModule)}; (async()=>{${code}})().catch(e=>{console.error(e.message);process.exit(1)})`,
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          AUTOV_DATA_DIR: join(cwd, ".autov-local"),
          OPENAI_VFX_BUDGET_USD: "30",
        },
      },
    );
  try {
    assert.equal(
      execute("await reserve(0,300000); await reserve(0,280000);").status,
      0,
    );
    const denied = execute("await reserve(0,40000)");
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /\$30/);
    const read = execute("console.log(JSON.stringify(await budgetStatus()))");
    const status = JSON.parse(read.stdout);
    assert.equal(status.used, 29);
    assert.equal(status.pending, 2);
    assert.equal(status.remaining, 1);
    const settled = execute(
      "const id=await reserve(0,10000); await settle(id,0,1000);console.log(JSON.stringify(await budgetStatus()))",
    );
    assert.equal(settled.status, 0);
    assert.equal(JSON.parse(settled.stdout).used, 29.05);
    assert.equal(execute("await reserve(-1,100)").status, 1);
    const overrun = execute(
      "const id=await reserve(0,5000); await settle(id,0,6000)",
    );
    assert.equal(overrun.status, 1);
    assert.match(overrun.stderr, /generation is stopped/);
    assert.equal(execute("await reserve(0,1)").status, 1);
    const halted = JSON.parse(
      execute("console.log(JSON.stringify(await budgetStatus()))").stdout,
    );
    assert.equal(halted.halted, true);
    assert.equal(halted.remaining, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("authorized $80 increase preserves previous usage and pending reservations", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "autov-budget-upgrade-"));
  const testModule = resolve("src/lib/vfx-lab/budget.ts"),
    tsx = resolve("node_modules/tsx/dist/cli.mjs");
  const execute = (limit: string, code: string) =>
    spawnSync(
      process.execPath,
      [
        tsx,
        "-e",
        `import {reserveUsd,budgetStatus} from ${JSON.stringify(testModule)};(async()=>{${code}})().catch(e=>{console.error(e.message);process.exit(1)})`,
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          AUTOV_DATA_DIR: join(cwd, "shared"),
          OPENAI_VFX_BUDGET_USD: limit,
        },
      },
    );
  try {
    assert.equal(execute("30", "await reserveUsd(29)").status, 0);
    const upgraded = execute(
      "80",
      "await reserveUsd(50);console.log(JSON.stringify(await budgetStatus()))",
    );
    assert.equal(upgraded.status, 0, upgraded.stderr);
    assert.deepEqual(JSON.parse(upgraded.stdout), {
      limit: 80,
      used: 79,
      remaining: 1,
      halted: false,
      calls: 2,
      pending: 2,
    });
    assert.equal(execute("80", "await reserveUsd(2)").status, 1);
    const lowered = JSON.parse(
      execute("30", "console.log(JSON.stringify(await budgetStatus()))").stdout,
    );
    assert.equal(lowered.used, 79);
    assert.equal(lowered.remaining, 0);
    for (const invalid of ["81", "0", "NaN", "Infinity"])
      assert.equal(execute(invalid, "await reserveUsd(1)").status, 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
