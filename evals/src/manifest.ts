import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAgainst, type SchemaViolation } from "./schema.js";

/**
 * `RunManifest` construction, with conformance as an assertion rather than a
 * hope.
 *
 * ## What this file exists because of
 *
 * The first 6V-0 run wrote nine manifest documents, all nine of which were
 * **invalid**: the schema is `additionalProperties: false`, the run recorded a
 * `runtime` key the schema does not declare, and nothing said so. Every test
 * was green. The JSON looked correct. The records were evidence of nothing, and
 * the only reason it was caught is that a person read the schema.
 *
 * That is the whole of VF-01 in one incident, and the OSS counterevidence scan
 * found the same shape fixed independently by four projects. SWE-bench's
 * `--gold`, Terminal-Bench's `--agent oracle` and Inspect Evals' `mockllm`
 * end-to-end test all exist so that "the harness itself is broken" is *loud*.
 *
 * So: `buildManifest` returns a document that has already been validated
 * against `schemas/eval/run-manifest.v1.schema.json`, and throws with the
 * violation list if it is not conformant. Nothing in this package writes a
 * manifest by any other route.
 */

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

export const manifestSchemaPath = resolve(
  repositoryRoot,
  "schemas/eval/run-manifest.v1.schema.json",
);

export type CorpusType = "corpus-i" | "corpus-e" | "corpus-p" | "corpus-c";
export type Ladder = "6V-0" | "6V-1" | "6V-2" | "6V-3" | "6V-4" | "6V-5";
export type Concurrency = "C0" | "C1" | "C2" | "C3" | "C4";

export interface GitFacts {
  /** 40 hex characters. The schema requires a full hash and a short one fails. */
  readonly commit: string;
  readonly dirty: boolean;
}

/**
 * Read the repository's git facts.
 *
 * `commit` is the full hash on purpose. The schema's pattern is
 * `^[0-9a-f]{40}$` and a 7-character abbreviation — the thing a person
 * habitually writes down — fails it. That is the schema being right: a run
 * recorded against `6b7dcdc` cannot be re-executed against `6b7dcdc`, because
 * that is not a commit.
 */
export function gitFacts(cwd: string = repositoryRoot): GitFacts {
  const read = (args: string[]): string => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      shell: false,
    });
    if (result.status !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed in ${cwd}: ${result.stderr || "no stderr"}. ` +
          `A manifest without git facts cannot be written.`,
      );
    }
    return (result.stdout ?? "").trim();
  };
  const commit = read(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      `git rev-parse HEAD returned "${commit}", which is not a full 40-character ` +
        `hash. The manifest schema will not accept it.`,
    );
  }
  return { commit, dirty: read(["status", "--porcelain"]) !== "" };
}

/** The schema annotates `format: date-time`; this asserts the shape it names. */
export function assertIsoTimestamp(value: string, where: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    throw new Error(`${where} is not an ISO-8601 timestamp: "${value}"`);
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${where} parses to an invalid date: "${value}"`);
  }
}

let cachedSchema: Record<string, unknown> | undefined;

export function manifestSchema(): Record<string, unknown> {
  cachedSchema ??= JSON.parse(
    readFileSync(manifestSchemaPath, "utf8"),
  ) as Record<string, unknown>;
  return cachedSchema;
}

export class ManifestConformanceError extends Error {
  readonly violations: readonly SchemaViolation[];
  constructor(violations: readonly SchemaViolation[]) {
    super(
      `the run manifest does not satisfy run-manifest.v1.schema.json:\n` +
        violations.map((v) => `  ${v.path || "/"}: ${v.message}`).join("\n"),
    );
    this.name = "ManifestConformanceError";
    this.violations = violations;
  }
}

/** Build, validate, and only then return. Throws rather than returning an invalid document. */
export function buildManifest(
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof candidate["startedAt"] === "string") {
    assertIsoTimestamp(candidate["startedAt"] as string, "startedAt");
  }
  if (typeof candidate["endedAt"] === "string") {
    assertIsoTimestamp(candidate["endedAt"] as string, "endedAt");
  }
  const violations = validateAgainst(manifestSchema(), candidate);
  if (violations.length > 0) {
    throw new ManifestConformanceError(violations);
  }
  return candidate;
}

/**
 * Write a manifest, validating first.
 *
 * Validation happens *before* the write, so a rejected manifest leaves no file
 * behind. A half-written evidence directory is worse than an empty one: it
 * looks like a run happened.
 */
export function writeManifest(
  directory: string,
  runId: string,
  candidate: Record<string, unknown>,
): string {
  const manifest = buildManifest(candidate);
  const target = resolve(directory, `${runId}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return target;
}
