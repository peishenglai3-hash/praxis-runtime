import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Concurrency, CorpusType, Ladder } from "./manifest.js";

/**
 * Scenario definition and registry.
 *
 * ## Why `scenarioVersion` is required and not optional
 *
 * The OSS counterevidence scan records that four independent evaluation
 * projects — SWE-bench Verified, τ³-bench, Inspect Evals, LongMemEval — all
 * arrived at the same three-part ritual: **bump a version, re-grade the
 * leaderboard, and declare the old and new results non-comparable**. τ³-bench
 * states it outright: *"results produced with tau2-bench < 1.0.1 are not
 * comparable with >= 1.0.1"*, and keeps a `pre-v1.0.1` tag reachable.
 *
 * Praxis had no such field. The concrete consequence the scan names is this
 * phase: 6V-1's findings will change what 6V-2 measures, and without a version
 * there is no way to say so in the record. A reader comparing a 6V-1 manifest
 * to a 6V-2 manifest would have no signal that the scenario text underneath
 * them had moved.
 *
 * So a scenario id without a version is not loadable, and the version is part
 * of the run id.
 *
 * ## The oracle
 *
 * Each episode declares, **before it runs**, what the environment says the
 * right behaviour was — including the case §6 of the brief singles out:
 *
 *   "必须包含：正确行为 = 不反思 / 不升级 / 不形成 Asset 的负样本"
 *
 * `shouldIntervene: false` is therefore a first-class expectation, not the
 * absence of one. Without it, `FalseResidualRate` has no denominator and the
 * only measurable outcome is success — which is exactly the measurement the
 * brief says is not the point.
 */

export type ArmId =
  | "base"
  | "state"
  | "reflection"
  | "full"
  | "full-no-asset"
  | "full-stale-asset";

export interface FieldPlacement {
  readonly taskType: string;
  readonly externalVerification: "strong" | "medium" | "weak";
  readonly consequence: "low" | "medium" | "high";
  readonly reversibility: "easy" | "partial" | "hard";
  readonly feedbackLatency: "short" | "medium" | "long";
  readonly actors: readonly {
    readonly type: "human" | "model" | "agent" | "tool" | "system";
    readonly id: string;
  }[];
  readonly placementRationale: string;
}

export interface VerifierSpec {
  readonly kind:
    | "test-runner"
    | "compiler"
    | "filesystem"
    | "external-api"
    | "human"
    | "model"
    | "none";
  readonly reference: string;
  readonly independent: boolean;
  readonly criterion?: Record<string, unknown>;
}

export interface CorpusProvenance {
  readonly sourceLocation: string;
  readonly sourceLicence: string;
  readonly privacyStatus:
    "public" | "internal" | "personal" | "redacted" | "unknown";
  readonly redactionRequired: boolean;
  readonly provenanceQuality:
    "primary" | "derived" | "reconstructed" | "unverified";
  readonly inRepository: boolean;
}

/**
 * What the environment — not the runtime, and not the operator — says the
 * correct behaviour was. Written before the episode runs.
 */
export interface OracleExpectation {
  /** Whether the task itself was solvable as posed. */
  readonly taskOutcome: "succeed" | "fail" | "either";
  /**
   * Ground truth for the false-positive measurement. `null` means the
   * environment cannot adjudicate this episode, and the episode is excluded
   * from `FalseResidualRate`'s denominator rather than counted as a true
   * negative. Excluding it is recorded, because a silently shrunk denominator
   * is the same defect as a zero one.
   */
  readonly residualIsReal: boolean | null;
  /** Should the runtime have intervened (residual, reflection, escalation)? */
  readonly shouldIntervene: boolean;
  /** Should a candidate asset have emerged? `false` is a real expectation. */
  readonly shouldProduceCandidate: boolean;
  /** Required. An oracle without a stated reason cannot be audited. */
  readonly rationale: string;
}

export interface Episode {
  readonly episodeId: string;
  /** The task text handed to the subject. */
  readonly task: string;
  /**
   * Frozen ground truth. `oracleCommands`, where present, are run by the
   * verifier to decide success — the environment is the judge, not the
   * runtime's own assessment.
   */
  readonly oracle: OracleExpectation;
  /** Shell-free argv the verifier runs. Exit 0 is success. */
  readonly oracleCommands?: readonly (readonly string[])[];
  /** Text the episode is expected to recall from a *previous* episode, if any. */
  readonly recalls?: string;
}

export interface Scenario {
  readonly scenarioId: string;
  /** Required. See the file header. */
  readonly scenarioVersion: string;
  readonly title: string;
  readonly corpusType: CorpusType;
  readonly ladder: Ladder;
  readonly concurrency: Concurrency;
  readonly field: FieldPlacement;
  readonly verifier: VerifierSpec;
  /** Required by the manifest schema when corpusType is corpus-i or corpus-e. */
  readonly corpusProvenance?: CorpusProvenance;
  /** When the expectations below were frozen. Written before any run. */
  readonly frozenAt: string;
  readonly episodes: readonly Episode[];
  readonly notes?: string;
}

export class ScenarioLoadError extends Error {
  constructor(source: string, problems: readonly string[]) {
    super(
      `scenario ${source} is not loadable:\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "ScenarioLoadError";
  }
}

function requireString(
  raw: Record<string, unknown>,
  key: string,
  problems: string[],
  where: string,
): string {
  const value = raw[key];
  if (typeof value !== "string" || value.length === 0) {
    problems.push(`${where}.${key} must be a non-empty string`);
    return "";
  }
  return value;
}

function requireEnum<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  problems: string[],
  where: string,
): T {
  const value = raw[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    problems.push(`${where}.${key} must be one of ${allowed.join(", ")}`);
    return allowed[0]!;
  }
  return value as T;
}

export function parseScenario(source: string, raw: unknown): Scenario {
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ScenarioLoadError(source, ["the scenario must be a JSON object"]);
  }
  const r = raw as Record<string, unknown>;

  const scenarioId = requireString(r, "scenarioId", problems, "scenario");
  const scenarioVersion = requireString(
    r,
    "scenarioVersion",
    problems,
    "scenario",
  );
  const title = requireString(r, "title", problems, "scenario");
  const corpusType = requireEnum(
    r,
    "corpusType",
    ["corpus-i", "corpus-e", "corpus-p", "corpus-c"] as const,
    problems,
    "scenario",
  );
  const ladder = requireEnum(
    r,
    "ladder",
    ["6V-0", "6V-1", "6V-2", "6V-3", "6V-4", "6V-5"] as const,
    problems,
    "scenario",
  );
  const concurrency = requireEnum(
    r,
    "concurrency",
    ["C0", "C1", "C2", "C3", "C4"] as const,
    problems,
    "scenario",
  );
  const frozenAt = requireString(r, "frozenAt", problems, "scenario");

  const fieldRaw = r["field"];
  if (typeof fieldRaw !== "object" || fieldRaw === null) {
    problems.push("scenario.field is required and must be an object");
  }
  const field = (fieldRaw ?? {}) as Record<string, unknown>;
  const placementRationale = requireString(
    field,
    "placementRationale",
    problems,
    "field",
  );

  const verifierRaw = r["verifier"];
  if (typeof verifierRaw !== "object" || verifierRaw === null) {
    problems.push("scenario.verifier is required and must be an object");
  }
  const verifier = (verifierRaw ?? {}) as Record<string, unknown>;

  const episodesRaw = r["episodes"];
  const episodes: Episode[] = [];
  if (!Array.isArray(episodesRaw) || episodesRaw.length === 0) {
    problems.push("scenario.episodes must be a non-empty array");
  } else {
    episodesRaw.forEach((episodeRaw, index) => {
      const where = `episodes[${index}]`;
      if (typeof episodeRaw !== "object" || episodeRaw === null) {
        problems.push(`${where} must be an object`);
        return;
      }
      const e = episodeRaw as Record<string, unknown>;
      const episodeId = requireString(e, "episodeId", problems, where);
      const task = requireString(e, "task", problems, where);
      const oracleRaw = e["oracle"];
      if (typeof oracleRaw !== "object" || oracleRaw === null) {
        problems.push(
          `${where}.oracle is required — an episode without frozen ground truth cannot be scored`,
        );
        return;
      }
      const o = oracleRaw as Record<string, unknown>;
      if (
        typeof o["residualIsReal"] !== "boolean" &&
        o["residualIsReal"] !== null
      ) {
        problems.push(
          `${where}.oracle.residualIsReal must be true, false, or null (null = the environment cannot adjudicate)`,
        );
      }
      if (typeof o["shouldIntervene"] !== "boolean") {
        problems.push(`${where}.oracle.shouldIntervene must be a boolean`);
      }
      if (typeof o["shouldProduceCandidate"] !== "boolean") {
        problems.push(
          `${where}.oracle.shouldProduceCandidate must be a boolean`,
        );
      }
      const rationale = requireString(
        o,
        "rationale",
        problems,
        `${where}.oracle`,
      );

      episodes.push({
        episodeId,
        task,
        oracle: {
          taskOutcome: (o["taskOutcome"] ??
            "either") as OracleExpectation["taskOutcome"],
          residualIsReal: (o["residualIsReal"] ?? null) as boolean | null,
          shouldIntervene: o["shouldIntervene"] === true,
          shouldProduceCandidate: o["shouldProduceCandidate"] === true,
          rationale,
        },
        ...(Array.isArray(e["oracleCommands"])
          ? { oracleCommands: e["oracleCommands"] as string[][] }
          : {}),
        ...(typeof e["recalls"] === "string" ? { recalls: e["recalls"] } : {}),
      });
    });
  }

  // The manifest schema requires provenance for material that came from
  // somewhere else. Enforced at load time so the failure is a bad scenario
  // file rather than an unwritable manifest six episodes in.
  const provenanceRaw = r["corpusProvenance"];
  let corpusProvenance: CorpusProvenance | undefined;
  if (provenanceRaw !== undefined) {
    const p = provenanceRaw as Record<string, unknown>;
    corpusProvenance = {
      sourceLocation: requireString(
        p,
        "sourceLocation",
        problems,
        "corpusProvenance",
      ),
      sourceLicence: requireString(
        p,
        "sourceLicence",
        problems,
        "corpusProvenance",
      ),
      privacyStatus: requireEnum(
        p,
        "privacyStatus",
        ["public", "internal", "personal", "redacted", "unknown"] as const,
        problems,
        "corpusProvenance",
      ),
      redactionRequired: p["redactionRequired"] === true,
      provenanceQuality: requireEnum(
        p,
        "provenanceQuality",
        ["primary", "derived", "reconstructed", "unverified"] as const,
        problems,
        "corpusProvenance",
      ),
      inRepository: p["inRepository"] === true,
    };
  } else if (corpusType === "corpus-i" || corpusType === "corpus-e") {
    problems.push(
      `corpusProvenance is required for ${corpusType}: the manifest schema will ` +
        `reject a run of sourced material that does not say where it came from, ` +
        `under what licence, and whether it may be in a public repository`,
    );
  }

  if (problems.length > 0) throw new ScenarioLoadError(source, problems);

  return {
    scenarioId,
    scenarioVersion,
    title,
    corpusType,
    ladder,
    concurrency,
    field: {
      taskType:
        typeof field["taskType"] === "string"
          ? field["taskType"]
          : "unspecified",
      externalVerification: requireEnum(
        field,
        "externalVerification",
        ["strong", "medium", "weak"] as const,
        [],
        "field",
      ),
      consequence: requireEnum(
        field,
        "consequence",
        ["low", "medium", "high"] as const,
        [],
        "field",
      ),
      reversibility: requireEnum(
        field,
        "reversibility",
        ["easy", "partial", "hard"] as const,
        [],
        "field",
      ),
      feedbackLatency: requireEnum(
        field,
        "feedbackLatency",
        ["short", "medium", "long"] as const,
        [],
        "field",
      ),
      actors: Array.isArray(field["actors"])
        ? (field["actors"] as FieldPlacement["actors"])
        : [],
      placementRationale,
    },
    verifier: {
      kind: requireEnum(
        verifier,
        "kind",
        [
          "test-runner",
          "compiler",
          "filesystem",
          "external-api",
          "human",
          "model",
          "none",
        ] as const,
        [],
        "verifier",
      ),
      reference:
        typeof verifier["reference"] === "string" ? verifier["reference"] : "",
      independent: verifier["independent"] === true,
      ...(typeof verifier["criterion"] === "object" &&
      verifier["criterion"] !== null
        ? { criterion: verifier["criterion"] as Record<string, unknown> }
        : {}),
    },
    ...(corpusProvenance === undefined ? {} : { corpusProvenance }),
    frozenAt,
    episodes,
    ...(typeof r["notes"] === "string" ? { notes: r["notes"] } : {}),
  };
}

/** Scenario files live next to the code that runs them, versioned in git. */
export const scenariosDirectory = resolve(
  fileURLToPath(new URL("../scenarios", import.meta.url)),
);

export interface LoadedScenario {
  readonly file: string;
  readonly scenario: Scenario;
}

export function loadScenarios(
  directory: string = scenariosDirectory,
): LoadedScenario[] {
  const entries = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return entries.map((name) => {
    const path = resolve(directory, name);
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return { file: name, scenario: parseScenario(name, parsed) };
  });
}

export function loadScenario(
  scenarioId: string,
  directory?: string,
): LoadedScenario {
  const all = loadScenarios(directory);
  const found = all.find((entry) => entry.scenario.scenarioId === scenarioId);
  if (found === undefined) {
    throw new Error(
      `no scenario "${scenarioId}" in ${directory ?? scenariosDirectory}; ` +
        `available: ${all.map((e) => e.scenario.scenarioId).join(", ") || "(none)"}`,
    );
  }
  return found;
}
