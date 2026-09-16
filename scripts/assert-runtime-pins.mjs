#!/usr/bin/env node
/**
 * IR-04 step 1 and 2 — runtime pins and dependency integrity.
 *
 * The cheapest checks run first so a wrong Node or a drifted lockfile fails in
 * a second rather than after a full build. This is not a substitute for CI's
 * `pnpm install --frozen-lockfile`; it is the local equivalent of noticing the
 * problem before spending four minutes not noticing it.
 */
import { error, log, warn } from "node:console";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(relativePath) {
  return readFileSync(join(rootDir, relativePath), "utf8").trim();
}

// --- step 1: runtime/version ------------------------------------------------

const pkg = JSON.parse(readText("package.json"));
const range = pkg.engines?.node;
if (typeof range !== "string" || range.length === 0) {
  fail("package.json engines.node is missing");
}

/** Compare two dotted versions numerically. */
function compare(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

const warnings = [];

if (typeof range === "string") {
  const minimum = />=\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(range)?.[1];
  const maximum = /<\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(range)?.[1];
  const current = process.versions.node;
  if (minimum !== undefined && compare(current, minimum) < 0) {
    // Below the minimum the code cannot be expected to run at all.
    fail(
      `Node ${current} is below the required ${minimum} (engines: ${range})`,
    );
  }
  if (maximum !== undefined && compare(current, maximum) >= 0) {
    // Above the range the *pins* are still what matters; the running version
    // is reported rather than fatal, because the exact pinned runtime is CI's
    // job and refusing to verify anywhere else would make the gate unusable on
    // any machine that has moved on. This is a warning the operator must see,
    // not a licence to claim Node 22 evidence.
    warnings.push(
      `running Node ${current}, outside the pinned range ${range}; this run is development evidence, not the pinned-runtime evidence CI provides`,
    );
  }

  // The canonical Alpha runtime is the pinned exact version, not the range.
  // The range describes what may run; the pins describe what must.
  for (const pinFile of [".node-version", ".nvmrc"]) {
    if (!existsSync(join(rootDir, pinFile))) {
      fail(`${pinFile} is missing`);
      continue;
    }
    const pinned = readText(pinFile);
    if (compare(pinned, minimum ?? pinned) < 0) {
      fail(
        `${pinFile} (${pinned}) is below engines.node's minimum (${minimum})`,
      );
    }
    if (maximum !== undefined && compare(pinned, maximum) >= 0) {
      fail(`${pinFile} (${pinned}) is outside engines.node (${range})`);
    }
  }

  const nodeVersionPin = readText(".node-version");
  const nvmPin = readText(".nvmrc");
  if (nodeVersionPin !== nvmPin) {
    fail(`.node-version (${nodeVersionPin}) and .nvmrc (${nvmPin}) disagree`);
  }

  const workflow = readText(join(".github", "workflows", "ci.yml"));
  const ciNode = /node-version:\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(workflow)?.[1];
  if (ciNode === undefined) {
    fail("ci.yml does not pin an exact node-version");
  } else if (ciNode !== nodeVersionPin) {
    fail(`ci.yml pins Node ${ciNode} but .node-version pins ${nodeVersionPin}`);
  }
}

const packageManager = pkg.packageManager;
if (typeof packageManager !== "string" || !packageManager.startsWith("pnpm@")) {
  fail("package.json packageManager must pin a pnpm version");
} else {
  const pinnedPnpm = packageManager.slice("pnpm@".length);
  if (pkg.engines?.pnpm !== undefined && pkg.engines.pnpm !== pinnedPnpm) {
    fail(
      `engines.pnpm (${pkg.engines.pnpm}) and packageManager (${pinnedPnpm}) disagree`,
    );
  }
}

// --- step 2: dependency/lockfile integrity ----------------------------------

if (!existsSync(join(rootDir, "pnpm-lock.yaml"))) {
  fail("pnpm-lock.yaml is missing; the install is not reproducible");
}

if (!existsSync(join(rootDir, "pnpm-workspace.yaml"))) {
  fail("pnpm-workspace.yaml is missing");
}

if (failures.length > 0) {
  error("runtime pins / dependency integrity FAIL");
  for (const failure of failures) error(`  - ${failure}`);
  process.exit(1);
}

for (const warning of warnings) warn(`[warn] ${warning}`);

log(
  `runtime pins PASS (node ${process.versions.node}, ${packageManager}, pins agree, lockfile present)`,
);
