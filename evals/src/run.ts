import { spawnSync } from "node:child_process";

import {
  buildManifest,
  gitFacts,
  writeManifest,
  type Concurrency,
  type CorpusType,
  type GitFacts,
  type Ladder,
} from "./manifest.js";
import {
  computeMetrics,
  type EpisodeRecord,
  type MetricSet,
} from "./metrics.js";
import { MECHANISMS_NOT_YET_WIRED } from "./arms.js";
import {
  createArmRuntime,
  HoldoutAccessError,
  type HumanControl,
  type Subject,
} from "./runner.js";
import type {
  ArmId,
  Episode,
  OracleExpectation,
  Scenario,
} from "./scenario.js";

/**
 * Running one scenario against one arm, and recording what happened.
 *
 * The division of labour here is deliberate: the *verifier* decides whether the
 * task succeeded, the *oracle* says what should have happened, and the runner
 * records both without adjudicating either. A runner that decided its own
 * success would be the runtime grading its own homework, which is the thing
 * `INV-09` exists to prevent.
 */

export interface RunOptions {
  readonly scenario: Scenario;
  readonly arm: ArmId;
  readonly subject: Subject;
  /** Where manifests and records go. Git-ignored; never the repository root. */
  readonly resultsDirectory: string;
  /**
   * Runs the scenario's `oracleCommands` and returns whether they passed.
   * Overridable so the oracle self-test can supply a scripted verdict with no
   * shell and no filesystem.
   */
  readonly verifier?: (
    episode: Episode,
    output: string,
    holdout?: HoldoutEntry,
  ) => Promise<boolean | null>;
  /** Evaluator-only material. Never passed to the subject. */
  readonly holdout?: ReadonlyMap<string, HoldoutEntry>;
  /** Explicit human decision hook; absent means no promotion or challenge. */
  readonly humanControl?: HumanControl;
  /** Injected so a test can pin the git facts. Defaults to reading the repo. */
  readonly gitFacts?: GitFacts;
}

export interface HoldoutEntry {
  readonly reference: string;
  readonly value: unknown;
}

export interface RunResult {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly arm: ArmId;
  readonly records: readonly EpisodeRecord[];
  readonly metrics: MetricSet;
  readonly manifestPath: string;
  /** Episodes whose mechanism threw. Non-empty means the arm did not fully run. */
  readonly armErrors: readonly string[];
  /** Whether the evaluator-only holdout boundary was maintained. */
  readonly holdoutIsolation: "PASS" | "FAIL" | "NOT_APPLICABLE";
  readonly holdoutLeakageCount: number;
}

/**
 * The default verifier: run the episode's declared commands.
 *
 * `shell: false` and an argv array, for the same reason `scripts/gate.mjs` uses
 * them — a shell can substitute a downstream exit status, and a verifier that
 * can be lied to by its own pipeline is not a verifier.
 *
 * An episode with no `oracleCommands` returns `null`, not `false`. "The
 * environment could not adjudicate" and "the environment says this failed" are
 * different facts, and collapsing them would put a fabricated failure into the
 * task-success denominator.
 */
export async function commandVerifier(
  episode: Episode,
): Promise<boolean | null> {
  const commands = episode.oracleCommands;
  if (commands === undefined || commands.length === 0) return null;
  for (const argv of commands) {
    const [command, ...args] = argv;
    if (command === undefined) return null;
    const result = spawnSync(command, args, {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) return false;
  }
  return true;
}

function corpusProvenanceOf(
  scenario: Scenario,
): Record<string, unknown> | undefined {
  const p = scenario.corpusProvenance;
  if (p === undefined) return undefined;
  return {
    sourceLocation: p.sourceLocation,
    sourceLicence: p.sourceLicence,
    privacyStatus: p.privacyStatus,
    redactionRequired: p.redactionRequired,
    provenanceQuality: p.provenanceQuality,
    inRepository: p.inRepository,
  };
}

function socialPlurality(
  actors: readonly unknown[],
): "single-actor" | "few" | "many" {
  if (actors.length <= 1) return "single-actor";
  if (actors.length <= 4) return "few";
  return "many";
}

export async function runScenario(options: RunOptions): Promise<RunResult> {
  const { scenario, arm, subject } = options;
  const facts = options.gitFacts ?? gitFacts();
  const verify = options.verifier ?? ((episode) => commandVerifier(episode));

  const runtime = createArmRuntime(arm, scenario, options.humanControl);
  const identity = subject.identity();
  const records: EpisodeRecord[] = [];
  const armErrors: string[] = [];
  let holdoutLeakageCount = 0;
  const startedAt = new Date().toISOString();

  try {
    runtime.seed(scenario);
    for (const [index, episode] of scenario.episodes.entries()) {
      const episodeStarted = Date.now();
      const context = runtime.beforeEpisode(episode, index);
      if (context.contextError !== undefined) {
        // A context failure is an arm failure. Recording it here rather than
        // letting the arm quietly behave like a simpler one is the whole point
        // of `EpisodeContext.contextError`.
        armErrors.push(
          `${episode.episodeId} (context): ${context.contextError}`,
        );
      }
      let verdictError: string | undefined;
      let succeeded: boolean | null = null;
      let output = "";
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;

      try {
        const produced = await subject.generate(context.prompt, {
          episodeId: episode.episodeId,
          holdout: {
            read: () => {
              throw new HoldoutAccessError(episode.episodeId);
            },
          },
        });
        output = produced.text;
        inputTokens = produced.inputTokens;
        outputTokens = produced.outputTokens;
        succeeded = await verify(
          episode,
          output,
          options.holdout?.get(episode.episodeId),
        );
      } catch (error) {
        verdictError = error instanceof Error ? error.message : String(error);
        if (error instanceof HoldoutAccessError) holdoutLeakageCount += 1;
        armErrors.push(`${episode.episodeId}: ${verdictError}`);
      }

      const observation = runtime.afterEpisode(episode, {
        succeeded,
        output,
        ...(verdictError === undefined ? {} : { error: verdictError }),
      });
      if (observation.mechanismError !== undefined) {
        armErrors.push(
          `${episode.episodeId} (mechanism): ${observation.mechanismError}`,
        );
      }

      records.push({
        arm,
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.scenarioVersion,
        episodeId: episode.episodeId,
        oracle: episode.oracle,
        taskSucceeded: succeeded,
        residualDetected: observation.residualDetected,
        residualKinds: observation.residualKinds,
        reflectionDecision: observation.reflectionDecision,
        candidateCreated: observation.candidateCreated,
        assetPromoted: observation.assetPromoted,
        challengeRaised: observation.challengeRaised,
        // From the *context*, not the observation. The observation is what
        // happened after the call and knows nothing about what was exposed;
        // the first version of this line read it from there and every arm
        // reported exposing nothing.
        contextItemsExposed: context.contextItemsExposed,
        humanIntervened: observation.humanIntervened,
        ...(observation.assetPromotionSourceEpisodeId === undefined
          ? {}
          : {
              assetPromotionSourceEpisodeId:
                observation.assetPromotionSourceEpisodeId,
            }),
        latencyMs: Date.now() - episodeStarted,
        inputTokens,
        outputTokens,
        ...(verdictError === undefined ? {} : { error: verdictError }),
      });
    }
  } finally {
    runtime.close();
  }

  const metrics = computeMetrics(records);
  const endedAt = new Date().toISOString();
  const runId = `${scenario.scenarioId}@${scenario.scenarioVersion}--${arm}`;
  const holdoutIsolation =
    holdoutLeakageCount > 0
      ? "FAIL"
      : options.holdout === undefined
        ? "NOT_APPLICABLE"
        : "PASS";

  const provenance = corpusProvenanceOf(scenario);
  const manifest = buildManifest({
    schemaVersion: "1",
    runId,
    scenarioId: scenario.scenarioId,
    ladder: scenario.ladder as Ladder,
    corpusType: scenario.corpusType as CorpusType,
    runtimeCommit: facts.commit,
    runtimeDirty: facts.dirty,
    holdoutIsolation,
    holdoutLeakageCount,
    concurrency: scenario.concurrency as Concurrency,
    subject: {
      kind: "model",
      provider: identity.provider,
      model: identity.model,
      adapterId: identity.adapterId,
      scaffold: identity.scaffold,
      ...(identity.modelVersion === undefined
        ? {}
        : { modelVersion: identity.modelVersion }),
      counterfactual: identity.counterfactual,
    },
    field: {
      taskType: scenario.field.taskType,
      externalVerification: scenario.field.externalVerification,
      consequence: scenario.field.consequence,
      reversibility: scenario.field.reversibility,
      feedbackLatency: scenario.field.feedbackLatency,
      actors: [...scenario.field.actors],
      socialPlurality: socialPlurality(scenario.field.actors),
      placementRationale: scenario.field.placementRationale,
    },
    expectation: {
      frozenAt: scenario.frozenAt,
      registered: [],
      expectedOutcome: `scenario ${scenario.scenarioId} v${scenario.scenarioVersion} under arm ${arm}`,
    },
    verifier: {
      kind: scenario.verifier.kind,
      reference: scenario.verifier.reference,
      independent: scenario.verifier.independent,
      ...(scenario.verifier.criterion === undefined
        ? {}
        : { criterion: scenario.verifier.criterion }),
    },
    counts: {
      subjectCalls: records.length,
      toolCalls: 0,
      expectationsRegistered: 0,
      expectationsResolved: 0,
      residualsDetected: records.filter((r) => r.residualDetected).length,
      residualsByKind: records
        .flatMap((r) => r.residualKinds)
        .reduce<Record<string, number>>((acc, kind) => {
          acc[kind] = (acc[kind] ?? 0) + 1;
          return acc;
        }, {}),
      reflectionsProposed: records.filter(
        (r) => r.reflectionDecision !== "none",
      ).length,
      reflectionsByDecision: records
        .filter((r) => r.reflectionDecision !== "none")
        .reduce<Record<string, number>>((acc, r) => {
          acc[r.reflectionDecision] = (acc[r.reflectionDecision] ?? 0) + 1;
          return acc;
        }, {}),
      candidateAssetsProposed: records.filter((r) => r.candidateCreated).length,
      assetsPromoted: records.filter((r) => r.assetPromoted).length,
      humanInterventions: records.filter((r) => r.humanIntervened).length,
      concurrencyAnomalies: 0,
    },
    reproducibility: {
      replayable: identity.counterfactual,
      nondeterminism: identity.counterfactual
        ? []
        : [
            "model sampling",
            "provider-side model changes",
            "wall-clock latency",
          ],
    },
    ...(provenance === undefined ? {} : { corpusProvenance: provenance }),
    startedAt,
    endedAt,
    notes:
      `arm=${arm}; episodes=${records.length}; ` +
      `armErrors=${armErrors.length}` +
      (armErrors.length === 0 ? "" : `: ${armErrors.join(" | ")}`) +
      (MECHANISMS_NOT_YET_WIRED.length === 0
        ? ""
        : `; NOT-YET-WIRED: ${MECHANISMS_NOT_YET_WIRED.join("; ")}`),
  });

  const manifestPath = writeManifest(options.resultsDirectory, runId, manifest);

  return {
    scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion,
    arm,
    records,
    metrics,
    manifestPath,
    armErrors,
    holdoutIsolation,
    holdoutLeakageCount,
  };
}

export interface ScenarioSweepResult {
  readonly scenarioId: string;
  readonly runs: Readonly<Partial<Record<ArmId, RunResult>>>;
  readonly errors: readonly string[];
}

export async function sweepScenario(
  options: Omit<RunOptions, "arm">,
  arms: readonly ArmId[],
): Promise<ScenarioSweepResult> {
  const runs: Partial<Record<ArmId, RunResult>> = {};
  const errors: string[] = [];
  for (const arm of arms) {
    try {
      runs[arm] = await runScenario({ ...options, arm });
    } catch (error) {
      // An arm that could not run is named. It is not omitted from the result,
      // because an omitted arm and an unscored arm read identically later.
      errors.push(
        `${arm}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { scenarioId: options.scenario.scenarioId, runs, errors };
}

/** Re-exported so callers do not need to reach into the oracle type. */
export type { OracleExpectation };
