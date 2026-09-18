import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AssetEpisodeEvidence,
  AssetPromotionReview,
  EventEnvelope,
  WriterContext,
} from "../../packages/contracts/src/index.js";
import { permissionScopes } from "../../packages/contracts/src/index.js";
import type { ContextSource } from "../../packages/context/src/index.js";
import type { FieldContext } from "../../packages/residual/src/index.js";
import { Phase3Runtime } from "../../packages/runtime/src/index.js";
import { Phase4Runtime } from "../../packages/runtime/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

import type { ArmId, Episode, Scenario } from "./scenario.js";

/**
 * The runner: one scenario, one arm, one subject.
 *
 * ## The rule this file exists to keep
 *
 * An arm must never silently degrade into a simpler arm. If `reflection`'s
 * residual engine is not wired, the correct output is a refusal, not a run that
 * quietly behaved like `state` and was recorded under the label `reflection`.
 * That failure — a run whose *label* is doing the work its *mechanism* was
 * supposed to do — is VF-01's shape applied to the ablation, and an ablation
 * with it is worse than no ablation, because it produces a difference and the
 * difference is an artefact of the harness.
 *
 * So each arm assembles a specific runtime class, the mechanism it claims is
 * the mechanism that ran, and anything that throws is recorded as an episode
 * error rather than swallowed.
 *
 * ## What a subject is
 *
 * A `Subject` is deliberately narrower than a `ModelAdapter`. It answers one
 * question — given this text, what comes back — and reports what it cost. The
 * adapter boundary is a *runtime contract* with negotiation, capability
 * declaration and a twelve-kind error taxonomy; an evaluation subject needs
 * none of that and should not pretend to. Keeping them separate is what lets
 * the oracle self-test drive the whole pipeline with no model and no network.
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

export interface SubjectIdentity {
  readonly provider: string;
  readonly model: string;
  readonly adapterId: string;
  readonly scaffold: string;
  readonly modelVersion?: string;
  readonly counterfactual: boolean;
}

export interface SubjectOutput {
  readonly text: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

/**
 * The only holdout surface a subject receives. It deliberately carries no
 * value or reference: an attempted read is an evaluation failure, not a
 * request that the harness may satisfy.
 */
export interface SubjectEpisodeContext {
  readonly episodeId: string;
  readonly holdout: {
    read(): never;
  };
}

export class HoldoutAccessError extends Error {
  constructor(episodeId: string) {
    super(`subject attempted to read the future holdout for ${episodeId}`);
    this.name = "HoldoutAccessError";
  }
}

export interface Subject {
  identity(): SubjectIdentity;
  generate(
    prompt: string,
    context?: SubjectEpisodeContext,
  ): Promise<SubjectOutput>;
}

export interface EpisodeContext {
  /** What is sent to the subject: the task, plus whatever the arm exposed. */
  readonly prompt: string;
  readonly contextItemsExposed: number;
  /**
   * Set when context assembly threw.
   *
   * This field exists because the first version of this method caught that
   * throw with an empty `catch {}` and set `contextItemsExposed = 0`. The
   * effect was that the STATE arm reported exposing nothing while its planner
   * was failing on every episode — an arm silently degraded into BASE, which is
   * the one thing the header of this file says must never happen. The empty
   * catch is what made it invisible to the tests that were supposed to catch
   * it.
   */
  readonly contextError?: string;
}

export interface EpisodeVerdict {
  /** `null` when the verifier could not adjudicate. Never coerced. */
  readonly succeeded: boolean | null;
  readonly output: string;
  readonly error?: string;
}

export interface EpisodeObservation {
  /**
   * Set when the arm's own mechanism threw partway through.
   *
   * The first version of `#observeWithReflection` caught its throw and returned
   * an observation with a comment claiming the error was "recorded, not
   * swallowed" — while recording nothing. The comment was false and the catch
   * was silent, which is the exact defect this file's header says must never
   * happen. An arm that throws has not run, and the caller has to be able to
   * say so.
   */
  readonly mechanismError?: string;
  readonly residualDetected: boolean;
  readonly residualKinds: readonly string[];
  readonly reflectionDecision: "STOP" | "CONTINUE" | "ESCALATE" | "none";
  readonly candidateCreated: boolean;
  readonly assetPromoted: boolean;
  readonly challengeRaised: boolean;
  readonly humanIntervened: boolean;
  /** Episode whose lesson produced the candidate later activated in this episode. */
  readonly assetPromotionSourceEpisodeId?: string;
}

export interface HumanControlRequest {
  readonly action: "activate" | "challenge";
  readonly assetId: string;
  readonly episodeId: string;
}

export type HumanControl = (request: HumanControlRequest) => boolean;

export interface ArmRuntime {
  readonly arm: ArmId;
  /** Build the prompt and, for arms that need it, register the expectation. */
  beforeEpisode(episode: Episode, index: number): EpisodeContext;
  /** Observe what the episode produced. */
  afterEpisode(episode: Episode, verdict: EpisodeVerdict): EpisodeObservation;
  /** Install any pre-existing asset state. Arms E and F differ only here. */
  seed(scenario: Scenario): void;
  close(): void;
}

const evaluationWriter: WriterContext = {
  writerId: "eval:harness",
  kind: "runtime",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

const evaluationHumanWriter: WriterContext = {
  ...evaluationWriter,
  writerId: "eval:human",
  kind: "human",
};

function nowIso(): string {
  return new Date().toISOString();
}

function describe(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function assetIdFromEvent(record: { payload: unknown }): string | undefined {
  if (typeof record.payload !== "object" || record.payload === null) {
    return undefined;
  }
  const payload = record.payload as {
    assetId?: unknown;
    id?: unknown;
    asset?: { id?: unknown };
  };
  if (typeof payload.asset?.id === "string") return payload.asset.id;
  if (typeof payload.assetId === "string") return payload.assetId;
  return typeof payload.id === "string" ? payload.id : undefined;
}

/**
 * BASE — the model and nothing else.
 *
 * There is no store, no ledger and no runtime object here. That is the point:
 * if this class had one, the baseline would be paying a cost the comparison is
 * supposed to measure.
 */
export class BaseArmRuntime implements ArmRuntime {
  readonly arm: ArmId = "base";

  beforeEpisode(episode: Episode): EpisodeContext {
    return { prompt: episode.task, contextItemsExposed: 0 };
  }

  afterEpisode(): EpisodeObservation {
    return {
      residualDetected: false,
      residualKinds: [],
      reflectionDecision: "none",
      candidateCreated: false,
      assetPromoted: false,
      challengeRaised: false,
      humanIntervened: false,
    };
  }

  seed(): void {
    /* BASE has no historical state to seed. */
  }

  close(): void {
    /* nothing to close */
  }
}

interface RuntimeArmOptions {
  readonly scenario: Scenario;
  /** Which runtime class to assemble. Determines what the arm can actually do. */
  readonly level: "state" | "reflection" | "full";
  readonly seededAssets: "none" | "empty-registry" | "superseded";
  readonly humanControl?: HumanControl;
}

/**
 * The runtime-backed arms.
 *
 * `level` selects the boundary:
 *
 * - `state` → `Phase3Runtime`'s parent behaviour with only ledger, projections
 *   and `ContextPlanner` exercised. Residual detection is never called.
 * - `reflection` → adds `recordExpectation` / `detectResiduals` /
 *   `recordResiduals` / `runReflection` / `recordReflectionProposal`.
 * - `full` → adds `proposeAsset` / `promoteAsset`.
 *
 * The runtime classes are used exactly as shipped. Nothing in `packages/` is
 * modified to make an arm possible; that is what keeps the ablation inside the
 * Practice Freeze, and it is also why the comparison is fair — the arms differ
 * by which product code paths run, not by a harness-side reimplementation of
 * them.
 */
export class PraxisArmRuntime implements ArmRuntime {
  readonly arm: ArmId;
  readonly #level: "state" | "reflection" | "full";
  readonly #scenario: Scenario;
  readonly #directory: string;
  readonly #store: SqliteEventStore;
  readonly #runtime: Phase3Runtime | Phase4Runtime;
  readonly #seededAssets: RuntimeArmOptions["seededAssets"];
  readonly #humanControl: HumanControl | undefined;
  readonly #sourceEventIds = new Map<string, string>();
  readonly #assetEvidence: AssetEpisodeEvidence[] = [];
  #candidateId: string | undefined;
  #candidateSourceEpisodeId: string | undefined;
  #assetValidated = false;
  #assetPromoted = false;
  #episodeIndex = 0;

  constructor(options: RuntimeArmOptions) {
    this.#level = options.level;
    this.#scenario = options.scenario;
    this.#seededAssets = options.seededAssets;
    this.#humanControl = options.humanControl;
    this.arm = options.level;
    this.#directory = mkdtempSync(
      join(tmpdir(), `praxis-eval-${options.level}-`),
    );
    this.#store = new SqliteEventStore({
      filename: join(this.#directory, "events.db"),
      migrationsDir,
    });
    const ports = {
      events: this.#store,
      projections: this.#store,
      clock: { now: () => new Date() },
      ids: { next: () => randomUUID() },
      actor:
        options.level === "full"
          ? { type: "human" as const, id: "eval-human" }
          : { type: "system" as const, id: "eval-harness" },
      writer:
        options.level === "full" ? evaluationHumanWriter : evaluationWriter,
    };
    this.#runtime =
      options.level === "full"
        ? new Phase4Runtime(ports)
        : new Phase3Runtime(ports);
  }

  get runtime(): Phase3Runtime | Phase4Runtime {
    return this.#runtime;
  }

  #fieldContext(): FieldContext {
    const field = this.#scenario.field;
    return {
      taskType: field.taskType,
      externalVerification: field.externalVerification,
      consequence: field.consequence,
      reversibility: field.reversibility,
      feedbackLatency: field.feedbackLatency,
      actors: [...field.actors],
      explicitRules: [],
    };
  }

  /** Append the episode's task as an observed interaction, so it has ledger evidence. */
  #recordTask(episode: Episode, index: number): string {
    const at = nowIso();
    const id = `eval-source-${this.#scenario.scenarioId}-${index}`;
    const envelope: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id,
      type: "interaction.observed",
      occurredAt: at,
      observedAt: at,
      recordedAt: at,
      actor: { type: "human", id: "scenario" },
      source: { kind: "eval-scenario", ref: episode.episodeId },
      payload: { task: episode.task },
      provenance: { origin: "direct", confidence: 1 },
      links: {},
    };
    this.#store.append(envelope, evaluationWriter);
    this.#sourceEventIds.set(episode.episodeId, id);
    return id;
  }

  seed(scenario: Scenario): void {
    if (this.#level !== "full" || this.#seededAssets !== "superseded") return;
    const runtime = this.#runtime;
    if (!(runtime instanceof Phase4Runtime) || scenario.episodes.length === 0) {
      return;
    }
    const at = nowIso();
    const seedEvents = ["a", "b"].map((suffix) => {
      const id = `eval-seed-${scenario.scenarioId}-${suffix}`;
      this.#store.append(
        {
          schemaVersion: "1",
          eventVersion: "1",
          id,
          type: "interaction.observed",
          occurredAt: at,
          observedAt: at,
          recordedAt: at,
          actor: { type: "human", id: "seed-fixture" },
          source: { kind: "eval-seed", ref: id },
          payload: { task: "[seed] obsolete workflow evidence" },
          provenance: { origin: "direct", confidence: 1 },
          links: {},
        },
        evaluationWriter,
      );
      return id;
    });
    const assetId = `eval-stale-${scenario.scenarioId}`;
    runtime.proposeAsset({
      id: assetId,
      kind: "workflow",
      version: "1",
      body: { instruction: "use the obsolete workflow" },
      derivedFrom: seedEvents.map((eventId) => ({
        eventId,
        origin: "direct" as const,
      })),
      createdAt: at,
    });
    const seedReview: AssetPromotionReview = {
      targetStatus: "validated",
      episodes: seedEvents.map((eventId, index) => ({
        episodeId: `seed-${index}`,
        evidence: [{ eventId, origin: "direct" as const }],
        exposureInfluenced: false,
      })),
      counterexamples: [],
      validation: {
        validatorId: "eval-seed-validator",
        passed: true,
        evidence: [{ eventId: seedEvents[0]!, origin: "direct" }],
      },
    };
    runtime.promoteAsset(assetId, seedReview, at);
    runtime.promoteAsset(
      assetId,
      { ...seedReview, targetStatus: "active", humanConfirmed: true },
      at,
    );
  }

  beforeEpisode(episode: Episode, index: number): EpisodeContext {
    this.#episodeIndex = index;
    this.#recordTask(episode, index);

    // Ledger, projections and context planning are what `state` and above add.
    let contextItemsExposed = 0;
    let prompt = episode.task;
    try {
      this.#runtime.catchUpCoreProjections();
      const plan = this.#runtime.buildContextPlan({
        // `reindex`, not `reuse`. `reuse` requires a `previousPlan`, which the
        // first episode of a run does not have, and the planner says so by
        // throwing. Building each episode's plan from the ledger is also the
        // more conservative choice for an evaluation: nothing is inherited
        // between episodes except what is literally in the ledger.
        mode: "reindex",
        stateSeq: this.#store.getLastSeq(),
        budget: { maxItems: 8, maxTokens: 2_000 },
        candidates: this.#ledgerCandidates(episode.assetExpectation),
      });
      const selected = plan.selected;
      contextItemsExposed = selected.length;
      const exposed = selected.map((item) => item.text).join("\n");
      if (exposed.length > 0) {
        prompt = `${exposed}\n\n---\n\n${episode.task}`;
      }
      try {
        // Recorded through the runtime's own use-case, so the exposure is in
        // the ledger rather than a harness-side tally.
        this.#runtime.recordContextPlan(plan);
      } catch (error) {
        // The exposure count stands. The items were built and shown to the
        // subject; failing to *record* that is a fact about the ledger, and
        // reporting less exposure than happened would understate the cost this
        // arm is being charged for.
        return {
          prompt,
          contextItemsExposed,
          contextError: `recordContextPlan threw: ${describe(error)}`,
        };
      }
    } catch (error) {
      // Named, not swallowed. See `EpisodeContext.contextError`.
      return {
        prompt: episode.task,
        contextItemsExposed: 0,
        contextError: `buildContextPlan threw: ${describe(error)}`,
      };
    }

    return { prompt, contextItemsExposed };
  }

  /**
   * Candidate context, derived from the ledger.
   *
   * **The ranking factors below are chosen by this harness, not by the
   * runtime.** `ContextPlanner` takes the five factors as input and ranks by
   * them; it does not compute them. That is a real finding for the architecture
   * self-review, and it is recorded here rather than hidden: an evaluation that
   * supplied its own relevance scores has measured the planner's *sort*, not
   * its *judgement*, and no run in this package can claim more than that.
   *
   * What is derived honestly: every candidate is a real ledger event, ordered
   * by real sequence, and `recency` is computed from actual sequence distance.
   * What is not: `taskRelevance` and `projectRelevance` are scenario-scoped
   * booleans here, which is the strongest claim the harness can currently
   * evidence.
   */
  #ledgerCandidates(
    assetExpectation: Episode["assetExpectation"],
  ): ContextSource[] {
    const records = this.#store.getSince(0);
    const latest = records.length === 0 ? 1 : records[records.length - 1]!.seq;
    const interactionCandidates = records
      .filter((record) => record.type === "interaction.observed")
      .map((record) => {
        const payload = record.payload as { task?: unknown } | null;
        const text = typeof payload?.task === "string" ? payload.task : "";
        const distance = latest - record.seq;
        return {
          id: `eval-context-source-${record.id}`,
          sourceEventId: record.id,
          seq: record.seq,
          text,
          // Earlier episodes of this same scenario are relevant; the planner is
          // being asked to prefer history over the current task's own echo.
          taskRelevance: record.seq === latest ? 0 : 1,
          projectRelevance: 1,
          // Linear decay over the recorded window. A real implementation would
          // use elapsed time; a replay cannot, because replay has no clock.
          recency: Math.max(0, 1 - distance / Math.max(1, latest)),
          explicitPriority: 0,
          activeRuleRelevance: this.#activeAssetEvents.has(record.id) ? 1 : 0,
          sourceOrigin: "direct" as const,
        };
      })
      .filter(
        (candidate) =>
          candidate.text.length > 0 && !candidate.text.startsWith("[episode"),
      );

    if (assetExpectation === "ignore") return interactionCandidates;

    const activeAssetCandidates = this.#store
      .listAssets()
      .filter((asset) => asset.status === "active")
      .flatMap((asset) => {
        const source = [...records]
          .reverse()
          .find((record) => assetIdFromEvent(record) === asset.id);
        if (source === undefined) return [];
        this.#activeAssetEvents.add(source.id);
        return [
          {
            id: `eval-active-asset-${asset.id}`,
            sourceEventId: source.id,
            seq: source.seq,
            text: `[active asset ${asset.id}] ${JSON.stringify(asset.body)}`,
            taskRelevance: assetExpectation === "help" ? 1 : 0,
            projectRelevance: 1,
            recency: Math.max(
              0,
              1 - (latest - source.seq) / Math.max(1, latest),
            ),
            explicitPriority: 0,
            activeRuleRelevance: 1,
            sourceOrigin: source.provenance.origin,
          } satisfies ContextSource,
        ];
      });

    return [...interactionCandidates, ...activeAssetCandidates];
  }

  /** Ledger event ids belonging to an active reusable asset, for `activeRuleRelevance`. */
  readonly #activeAssetEvents = new Set<string>();

  afterEpisode(episode: Episode, verdict: EpisodeVerdict): EpisodeObservation {
    const base: EpisodeObservation = {
      residualDetected: false,
      residualKinds: [],
      reflectionDecision: "none",
      candidateCreated: false,
      assetPromoted: false,
      challengeRaised: false,
      humanIntervened: false,
    };
    if (this.#level === "state") return base;

    return this.#observeWithReflection(episode, verdict, base);
  }

  #observeWithReflection(
    episode: Episode,
    verdict: EpisodeVerdict,
    base: EpisodeObservation,
  ): EpisodeObservation {
    const at = nowIso();
    const expectationId = `eval-expectation-${this.#episodeIndex}`;
    const evidenceId = `eval-source-${this.#scenario.scenarioId}-${this.#episodeIndex}`;
    const traceId = `eval-trace-${this.#scenario.scenarioId}-${this.#episodeIndex}`;

    // The expectation is declared as "the task succeeds". The observation is
    // what the verifier said. A residual therefore exists exactly when the
    // verifier and the expectation disagree — which is the runtime's own
    // definition and not a harness-side reinterpretation of it.
    const expectation = {
      id: expectationId,
      traceId,
      subject: { kind: "task", id: episode.episodeId },
      expected: { status: "complete" },
      verification: "exact" as const,
      createdAt: at,
      evidence: [{ eventId: evidenceId, origin: "direct" as const }],
    };

    // An independent verifier returning `null` means that the environment did
    // not adjudicate the episode. It is not a failed task. Register the
    // expectation so the unresolved state remains in the ledger, but do not
    // manufacture an observation, residual, reflection, or asset lesson from
    // missing evidence. This is the evaluator-side counterpart of the
    // metrics contract that keeps unadjudicated episodes out of success-rate
    // denominators.
    if (verdict.succeeded === null) {
      try {
        this.#runtime.recordExpectation(expectation);
      } catch (error) {
        return {
          ...base,
          mechanismError: describe(error),
        };
      }
      if (this.#level !== "full") return base;
      const challenge = this.#maybeChallengeAsset(episode, at);
      return {
        ...base,
        challengeRaised: challenge.raised,
        humanIntervened: challenge.humanIntervened,
        ...(challenge.error === undefined
          ? {}
          : { mechanismError: challenge.error }),
      };
    }

    const observation = {
      id: `${expectationId}-observation`,
      traceId,
      subject: { kind: "task", id: episode.episodeId },
      actual: { status: verdict.succeeded === true ? "complete" : "failed" },
      observedAt: at,
      evidence: [{ eventId: evidenceId, origin: "direct" as const }],
    };

    let residualKinds: string[] = [];
    let reflectionDecision: EpisodeObservation["reflectionDecision"] = "none";
    let candidateCreated = false;
    let assetPromoted = false;
    let challengeRaised = false;
    let humanIntervened = false;
    let mechanismError: string | undefined;

    try {
      this.#runtime.recordExpectation(expectation);
      const residuals = this.#runtime.detectResiduals({
        outcomes: [
          {
            expectation,
            observation,
            field: this.#fieldContext(),
            detectedAt: at,
          },
        ],
      });
      residualKinds = residuals.map((r) => r.kind);
      if (residuals.length > 0) {
        const recorded = this.#runtime.recordResiduals(residuals);
        const residual = residuals[0]!;
        const residualSeq = recorded[0]?.record.seq ?? 0;
        const feedback = this.#store.append(
          {
            schemaVersion: "1",
            eventVersion: "1",
            id: `${evidenceId}-feedback`,
            type: "task.completed",
            occurredAt: at,
            observedAt: at,
            recordedAt: at,
            actor: { type: "system", id: "eval-harness" },
            source: { kind: "eval-scenario", ref: episode.episodeId },
            payload: { verified: verdict.succeeded === true },
            provenance: { origin: "direct", confidence: 1 },
            links: {},
          },
          evaluationWriter,
        ).record;
        const proposal = this.#runtime.runReflection({
          residual,
          budget: {
            maxDepth: 2,
            maxHypotheses: 3,
            maxToolCalls: 0,
            maxElapsedMs: 5_000,
          },
          evidenceDelta: {
            fromSeq: residualSeq,
            toSeq: feedback.seq,
            evidence: [{ eventId: feedback.id, origin: "direct" }],
          },
        });
        reflectionDecision = proposal.decision;
        this.#runtime.recordReflectionProposal(residual, proposal);

        if (this.#level === "full" && proposal.decision !== "STOP") {
          const proposed = this.#proposeCandidate(residual, proposal, at, [
            recorded[0]!.record.id,
          ]);
          candidateCreated = proposed.created;
          if (proposed.error !== undefined) {
            mechanismError = `proposeAsset: ${proposed.error}`;
          }
        }
      }
    } catch (error) {
      // Recorded, not swallowed — and this time the comment is true.
      mechanismError = describe(error);
    }

    if (this.#level === "full") {
      this.#recordAssetEvidence(episode);
      const promotion = this.#maybePromoteAsset(episode, at);
      assetPromoted = promotion.promoted;
      humanIntervened ||= promotion.humanIntervened;
      if (promotion.error !== undefined) mechanismError = promotion.error;

      const challenge = this.#maybeChallengeAsset(episode, at);
      challengeRaised = challenge.raised;
      humanIntervened ||= challenge.humanIntervened;
      if (challenge.error !== undefined) mechanismError = challenge.error;
    }

    return {
      ...base,
      ...(mechanismError === undefined ? {} : { mechanismError }),
      residualDetected: residualKinds.length > 0,
      residualKinds,
      reflectionDecision,
      candidateCreated,
      assetPromoted,
      challengeRaised,
      humanIntervened,
      ...(this.#candidateSourceEpisodeId === undefined
        ? {}
        : { assetPromotionSourceEpisodeId: this.#candidateSourceEpisodeId }),
    };
  }

  #recordAssetEvidence(episode: Episode): void {
    if (this.#candidateId === undefined || this.#assetPromoted) return;
    const eventId = this.#sourceEventIds.get(episode.episodeId);
    if (eventId === undefined) return;
    if (
      this.#assetEvidence.some((item) => item.episodeId === episode.episodeId)
    ) {
      return;
    }
    this.#assetEvidence.push({
      episodeId: episode.episodeId,
      evidence: [{ eventId, origin: "direct" }],
      exposureInfluenced: false,
    });
  }

  #maybePromoteAsset(
    episode: Episode,
    at: string,
  ): { promoted: boolean; humanIntervened: boolean; error?: string } {
    if (
      this.#candidateId === undefined ||
      this.#assetPromoted ||
      this.#assetEvidence.length < 2
    ) {
      return { promoted: false, humanIntervened: false };
    }
    const runtime = this.#runtime;
    if (!(runtime instanceof Phase4Runtime)) {
      return {
        promoted: false,
        humanIntervened: false,
        error: "asset activation requested on a non-Phase4 runtime",
      };
    }
    const validationEvent = this.#assetEvidence[0]?.evidence[0]?.eventId;
    if (validationEvent === undefined) {
      return {
        promoted: false,
        humanIntervened: false,
        error: "asset activation has no validation evidence",
      };
    }
    const review: AssetPromotionReview = {
      targetStatus: "validated",
      episodes: this.#assetEvidence.map((item) => ({
        episodeId: item.episodeId,
        evidence: item.evidence,
        exposureInfluenced: item.exposureInfluenced,
      })),
      counterexamples: [],
      validation: {
        validatorId: "eval-scenario-validator",
        passed: true,
        evidence: [{ eventId: validationEvent, origin: "direct" }],
      },
    };
    try {
      if (!this.#assetValidated) {
        runtime.promoteAsset(this.#candidateId, review, at);
        this.#assetValidated = true;
      }
    } catch (error) {
      return {
        promoted: false,
        humanIntervened: false,
        error: `validateAsset: ${describe(error)}`,
      };
    }

    const confirmed = this.#humanControl?.({
      action: "activate",
      assetId: this.#candidateId,
      episodeId: episode.episodeId,
    });
    if (confirmed !== true) {
      return {
        promoted: false,
        humanIntervened: this.#humanControl !== undefined,
      };
    }

    try {
      const activated = runtime.promoteAsset(
        this.#candidateId,
        { ...review, targetStatus: "active", humanConfirmed: true },
        at,
      );
      this.#assetPromoted = true;
      this.#activeAssetEvents.add(activated.record.id);
      return { promoted: true, humanIntervened: true };
    } catch (error) {
      return {
        promoted: false,
        humanIntervened: true,
        error: `promoteAsset: ${describe(error)}`,
      };
    }
  }

  #maybeChallengeAsset(
    episode: Episode,
    at: string,
  ): { raised: boolean; humanIntervened: boolean; error?: string } {
    if (episode.assetExpectation !== "challenge") {
      return { raised: false, humanIntervened: false };
    }
    const runtime = this.#runtime;
    if (!(runtime instanceof Phase4Runtime)) {
      return { raised: false, humanIntervened: false };
    }
    for (const asset of this.#store.listAssets()) {
      if (asset.status !== "active") continue;
      const confirmed = this.#humanControl?.({
        action: "challenge",
        assetId: asset.id,
        episodeId: episode.episodeId,
      });
      if (confirmed !== true) continue;
      try {
        runtime.contestAsset(
          asset.id,
          "scenario supplied a counterexample to the active asset",
          at,
        );
        this.#activeAssetEvents.delete(asset.id);
        return { raised: true, humanIntervened: true };
      } catch (error) {
        return {
          raised: false,
          humanIntervened: true,
          error: `contestAsset: ${describe(error)}`,
        };
      }
    }
    return {
      raised: false,
      humanIntervened: this.#humanControl !== undefined,
    };
  }

  #proposeCandidate(
    residual: { id: string },
    proposal: { decision: string; reasons: readonly string[] },
    at: string,
    derivedFrom: readonly string[],
  ): { created: boolean; error?: string } {
    const runtime = this.#runtime;
    if (!(runtime instanceof Phase4Runtime)) {
      return {
        created: false,
        error: "the arm's runtime is not a Phase4Runtime",
      };
    }
    try {
      runtime.proposeAsset({
        id: `eval-candidate-${this.#scenario.scenarioId}`,
        kind: "pattern",
        version: "1",
        body: {
          rationale: proposal.reasons.join(" "),
          fromResidual: residual.id,
        },
        derivedFrom: derivedFrom.map((eventId) => ({
          eventId,
          origin: "inferred" as const,
        })),
        createdAt: at,
      });
      this.#candidateId = `eval-candidate-${this.#scenario.scenarioId}`;
      this.#candidateSourceEpisodeId =
        this.#scenario.episodes[this.#episodeIndex]?.episodeId;
      return { created: true };
    } catch (error) {
      return { created: false, error: describe(error) };
    }
  }

  close(): void {
    this.#store.close();
    rmSync(this.#directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

export function createArmRuntime(
  arm: ArmId,
  scenario: Scenario,
  humanControl?: HumanControl,
): ArmRuntime {
  switch (arm) {
    case "base":
      return new BaseArmRuntime();
    case "state":
      return new PraxisArmRuntime({
        scenario,
        level: "state",
        seededAssets: "none",
      });
    case "reflection":
      return new PraxisArmRuntime({
        scenario,
        level: "reflection",
        seededAssets: "none",
      });
    case "full":
      return new PraxisArmRuntime({
        scenario,
        level: "full",
        seededAssets: "none",
        ...(humanControl === undefined ? {} : { humanControl }),
      });
    case "full-no-asset":
      return new PraxisArmRuntime({
        scenario,
        level: "full",
        seededAssets: "empty-registry",
        ...(humanControl === undefined ? {} : { humanControl }),
      });
    case "full-stale-asset":
      return new PraxisArmRuntime({
        scenario,
        level: "full",
        seededAssets: "superseded",
        ...(humanControl === undefined ? {} : { humanControl }),
      });
    default: {
      const never: never = arm;
      throw new Error(`no runtime is defined for arm "${String(never)}"`);
    }
  }
}
