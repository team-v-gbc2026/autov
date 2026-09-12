import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Default remains $30. Explicit local configuration may authorize up to $60, never an unlimited budget.
export const SPEND_LIMIT_USD = Number(process.env.OPENAI_VFX_BUDGET_USD || 30);
if (
  !Number.isFinite(SPEND_LIMIT_USD) ||
  SPEND_LIMIT_USD <= 0 ||
  SPEND_LIMIT_USD > 60
)
  throw new Error("Budget must be greater than zero and at most $60.");
export const DATA_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.AUTOV_DATA_DIR ||
    path.join(process.cwd(), ".autov-local"),
);
const file = path.join(DATA_DIR, "budget.json");
type Entry = {
  id: string;
  state: "reserved" | "settled";
  usd: number;
  input: number;
  output: number;
  at: string;
};
type Ledger = { version: 1; limit: number; entries: Entry[]; halted?: boolean };
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const lock = await open(
    path.join(DATA_DIR, "budget.lock"),
    "wx",
    0o600,
  ).catch(() => {
    throw new Error("Budget ledger busy. Retry shortly.");
  });
  try {
    return await fn();
  } finally {
    await lock.close();
    await unlink(path.join(DATA_DIR, "budget.lock"));
  }
}
async function read(): Promise<Ledger> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as Ledger;
    if (
      value.version !== 1 ||
      !Number.isFinite(value.limit) ||
      value.limit <= 0 ||
      value.limit > 60 ||
      !Array.isArray(value.entries) ||
      value.entries.some((e) => !Number.isFinite(e.usd) || e.usd < 0)
    )
      throw new Error("Invalid budget ledger.");
    return { ...value, limit: SPEND_LIMIT_USD };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, limit: SPEND_LIMIT_USD, entries: [] };
    throw new Error("Budget ledger cannot be read; generation is stopped.");
  }
}
async function write(value: Ledger) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
export async function budgetStatus() {
  const ledger = await read();
  const used = ledger.entries.reduce((n, e) => n + e.usd, 0);
  return {
    limit: SPEND_LIMIT_USD,
    used,
    remaining: ledger.halted ? 0 : Math.max(0, SPEND_LIMIT_USD - used),
    halted: Boolean(ledger.halted),
    calls: ledger.entries.length,
    pending: ledger.entries.filter((e) => e.state === "reserved").length,
  };
}
// Conservative: cache-write input rate, no caching discount. Standard tier, no tools.
export const cost = (input: number, output: number) =>
  (input * 12.5 + output * 50) / 1_000_000;
export async function reserve(inputUpperBound: number, maxOutput: number) {
  return reserveUsd(
    cost(inputUpperBound, maxOutput),
    inputUpperBound,
    maxOutput,
  );
}
export async function reserveUsd(
  usd: number,
  inputUpperBound = 0,
  maxOutput = 0,
) {
  return locked(async () => {
    const ledger = await read();
    if (ledger.halted)
      throw new Error(
        "Budget accounting requires review; generation is stopped.",
      );
    if (
      ![usd, inputUpperBound, maxOutput].every(
        (n) => Number.isFinite(n) && n >= 0,
      )
    )
      throw new Error("Invalid token reservation.");
    if (ledger.entries.reduce((n, e) => n + e.usd, 0) + usd > SPEND_LIMIT_USD)
      throw new Error(
        `The $${SPEND_LIMIT_USD} local spending limit would be exceeded. Generation stopped.`,
      );
    const id = randomUUID();
    ledger.entries.push({
      id,
      state: "reserved",
      usd,
      input: inputUpperBound,
      output: maxOutput,
      at: new Date().toISOString(),
    });
    await write(ledger);
    return id;
  });
}
export async function settle(id: string, input: number, output: number) {
  return settleUsd(id, cost(input, output), input, output);
}
export async function settleUsd(
  id: string,
  actual: number,
  input = 0,
  output = 0,
) {
  await locked(async () => {
    const ledger = await read(),
      entry = ledger.entries.find((e) => e.id === id);
    if (!entry || entry.state !== "reserved")
      throw new Error("Unknown budget reservation.");
    if (
      !Number.isFinite(actual) ||
      actual < 0 ||
      input < 0 ||
      output < 0 ||
      actual > entry.usd
    ) {
      ledger.halted = true;
      if (Number.isFinite(actual) && actual > entry.usd) entry.usd = actual;
      await write(ledger);
      throw new Error(
        "Token bound exceeded or invalid usage; generation is stopped until accounting is reviewed.",
      );
    }
    entry.state = "settled";
    entry.usd = actual;
    entry.input = input;
    entry.output = output;
    await write(ledger);
  });
}
