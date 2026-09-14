import { spawnSync } from "node:child_process";
import { log } from "node:console";
import { execPath, stderr, stdout } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = resolve(rootDir, "tests/fixtures/forbidden-boundaries");
const dependencyCruiser = resolve(
  rootDir,
  "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);
const config = resolve(rootDir, ".dependency-cruiser.cjs");
const result = spawnSync(
  execPath,
  [dependencyCruiser, "--config", config, "packages", "apps"],
  { cwd: fixtureDir, encoding: "utf8" },
);

if (result.stdout) stdout.write(result.stdout);
if (result.stderr) stderr.write(result.stderr);

if (result.error || result.status === null) {
  throw result.error ?? new Error("dependency-cruiser did not start");
}

const output = `${result.stdout}\n${result.stderr}`;
const expectedRules = [
  "store-does-not-depend-on-upstream",
  "residual-does-not-depend-on-reflection",
  "reflection-does-not-depend-on-agents-or-store",
  "assets-does-not-depend-on-agents-or-store",
  "context-does-not-depend-on-residual",
  "apps-use-runtime-boundary",
];

if (result.status === 0) {
  throw new Error("The forbidden dependency fixture was not rejected");
}

const missingRules = expectedRules.filter((rule) => !output.includes(rule));
if (missingRules.length > 0) {
  throw new Error(
    `Expected boundary rules were not reported: ${missingRules.join(", ")}`,
  );
}

log("Forbidden dependency directions rejected as expected");
