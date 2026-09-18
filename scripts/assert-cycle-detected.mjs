import { spawnSync } from "node:child_process";
import { log } from "node:console";
import { execPath, stderr, stdout } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const dependencyCruiser = resolve(
  repositoryRoot,
  "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);
const result = spawnSync(
  execPath,
  [
    dependencyCruiser,
    "--config",
    resolve(repositoryRoot, ".dependency-cruiser.cjs"),
    resolve(repositoryRoot, "tests/fixtures/dependency-cycle"),
  ],
  { encoding: "utf8" },
);

if (result.stdout) stdout.write(result.stdout);
if (result.stderr) stderr.write(result.stderr);

if (result.error || result.status === null) {
  throw result.error ?? new Error("dependency-cruiser did not start");
}

if (result.status === 0) {
  throw new Error("The intentional dependency cycle was not rejected");
}
const diagnostics = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (!diagnostics.includes("no-circular")) {
  throw new Error(
    "The intentional cycle failed for an unexpected dependency-cruiser reason",
  );
}

log("Intentional dependency cycle rejected as expected");
