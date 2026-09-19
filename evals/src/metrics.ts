import {
  incrementalBenefit,
  rate,
  type IncrementalBenefit,
  type Rate,
} from "./rate.js";
import type { ArmId, OracleExpectation } from "./scenario.js";

/**
 * Metric definitions.
 *
 * §18 of the owner's brief lists twenty-two metrics and one instruction that
 * governs all of them:
 *
 *   "不得提前发明「优秀」阈值。第一轮先采 baseline."
 *
 * So nothing here has a threshold, a target, or a colour. Every metric returns
 * a `Rate` carrying its denominator, and a metric with no opportunities returns
 * `unscored`. Where a metric is a comparison between arms it returns an
 * `IncrementalBenefit`, which refuses to compute rather than reporting zero.
 *
 * ## The denominator problem, stated once
 *
 * Four of these metrics are *false-positive* rates and the hoped-for answer to
 * all four is zero. Zero is also what a broken run produces. The two are
 * distinguished only by the denominator, and the counterevidence scan records
 * that four independent projects have shipped a version of this defect — the
 * clearest being Inspect Evals' `sycophancy`, which reported `0.0` for every
 * model "through an unreachable denominator, and nothing raised".
 *
 * The specific instruction that follows for Phase 6V: **an episode where the
 * runtime detected no residual contributes to no false-positive rate.** It is
 * not a true negative; it is an opportunity that did not arise. Counting it as
 * a success is how a V1 report ends up saying "0% false residuals" after a run
 * in which the residual engine never fired.
 */

export interface EpisodeRecord {
  readonly arm: ArmId;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly episodeId: string;
  /** Frozen before the run. */
  readonly oracle: OracleExpectation;
  /** `null` when the verifier could not adjudicate — never coerced to false. */
  readonly taskSucceeded: boolean | null;
  readonly residualDetected: boolean;
  readonly residualKinds: readonly string[];
  readonly reflectionDecision: "STOP" | "CONTINUE" | "ESCALATE" | "none";
  readonly candidateCreated: boolean;
  readonly assetPromoted: boolean;
  /** A previously-promoted rule was contested during this episode. */
  readonly challengeRaised: boolean;
  /** The earlier episode whose candidate was activated here, if any. */
  readonly assetPromotionSourceEpisodeId?: string;
  readonly contextItemsExposed: number;
  readonly humanIntervened: boolean;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Set when the episode did not complete. Such an episode is not a success. */
  readonly error?: string;
}

function count(
  records: readonly EpisodeRecord[],
  predicate: (r: EpisodeRecord) => boolean,
): number {
  return records.filter(predicate).length;
}

export interface MetricSet {
  /** Share of adjudicable episodes whose task the verifier passed. */
  readonly taskSuccess: Rate;
  /** Difference in task success against the baseline arm. `null` when incomparable. */
  readonly incrementalTaskBenefit: IncrementalBenefit;
  /**
   * Of the residuals the runtime raised, the share the environment says were
   * not real. Denominator is *detected residuals*, so a run that detected
   * none is `unscored` — see the header.
   */
  readonly falseResidualRate: Rate;
  /** Of the episodes where something really was wrong, the share the runtime missed. */
  readonly missedResidualRate: Rate;
  /** Of the reflections the runtime ran, the share on episodes needing none. */
  readonly unnecessaryReflectionRate: Rate;
  /** Of the escalations raised, the share on episodes needing none. */
  readonly unnecessaryEscalationRate: Rate;
  /** Of the adjudicable episodes, the share where context was exposed and need not have been. */
  readonly unnecessaryContextRetrievalRate: Rate;
  /** Share of episodes that produced a candidate asset. */
  readonly candidateCreationRate: Rate;
  /** Of the candidates promoted, the share the oracle says should have existed. */
  readonly promotionPrecision: Rate;
  readonly challengeRate: Rate;
  readonly humanInterventionRate: Rate;
  /**
   * Of the episodes where the correct behaviour was **not** to intervene, the
   * share where the runtime indeed did not. This is §6 V1's headline: the
   * runtime knowing when to stay quiet.
   */
  readonly abstentionAccuracy: Rate;
  readonly episodeCount: number;
  /** Episodes excluded from every rate because the oracle could not adjudicate. */
  readonly unadjudicatedCount: number;
  readonly meanLatencyMs: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
}

function intervened(record: EpisodeRecord): boolean {
  return (
    record.residualDetected ||
    record.reflectionDecision !== "none" ||
    record.candidateCreated
  );
}

export function computeMetrics(
  records: readonly EpisodeRecord[],
  baseline?: readonly EpisodeRecord[],
): MetricSet {
  // An episode that errored is not a success and is not silently dropped: it is
  // counted in the denominator of task success, because a run that crashed did
  // not succeed at the task.
  const adjudicable = records.filter((r) => r.taskSucceeded !== null);
  const succeeded = count(adjudicable, (r) => r.taskSucceeded === true);

  const detectedResiduals = records.filter((r) => r.residualDetected);
  const adjudicableResiduals = detectedResiduals.filter(
    (r) => r.oracle.residualIsReal !== null,
  );
  const falseResiduals = adjudicableResiduals.filter(
    (r) => r.oracle.residualIsReal === false,
  ).length;

  const realProblems = records.filter((r) => r.oracle.residualIsReal === true);
  const missed = realProblems.filter((r) => !r.residualDetected).length;

  const reflections = records.filter((r) => r.reflectionDecision !== "none");
  const needlessReflections = reflections.filter(
    (r) => !r.oracle.shouldIntervene,
  ).length;

  const escalations = records.filter(
    (r) => r.reflectionDecision === "ESCALATE",
  );
  const needlessEscalations = escalations.filter(
    (r) => !r.oracle.shouldIntervene,
  ).length;

  // Context retrieval is judged against the oracle's intervention verdict: an
  // episode that needed nothing is one where pulling history was unnecessary.
  // The threshold is deliberately "any exposure at all", because Phase 6V has
  // no baseline for how much retrieval is normal yet, and inventing one here
  // would be inventing a threshold §18 forbids.
  const quietEpisodes = records.filter((r) => !r.oracle.shouldIntervene);
  const retrievedAnyway = quietEpisodes.filter(
    (r) => r.contextItemsExposed > 0,
  ).length;

  const candidates = records.filter((r) => r.candidateCreated);
  const promotions = records.filter((r) => r.assetPromoted);
  const candidateLessons = new Set(
    records
      .filter((r) => r.oracle.shouldProduceCandidate)
      .map((r) => r.episodeId),
  );
  const wantedPromotions = promotions.filter(
    (r) =>
      r.oracle.shouldProduceCandidate ||
      (r.assetPromotionSourceEpisodeId !== undefined &&
        candidateLessons.has(r.assetPromotionSourceEpisodeId)),
  ).length;

  const abstentionOpportunities = records.filter(
    (r) => !r.oracle.shouldIntervene,
  );
  const abstained = abstentionOpportunities.filter(
    (r) => !intervened(r),
  ).length;

  const baselineAdjudicable =
    baseline?.filter((r) => r.taskSucceeded !== null) ?? [];
  const baselineSucceeded = count(
    baselineAdjudicable,
    (r) => r.taskSucceeded === true,
  );

  return {
    taskSuccess: rate(succeeded, adjudicable.length),
    incrementalTaskBenefit:
      baseline === undefined
        ? {
            armValue:
              adjudicable.length === 0 ? null : succeeded / adjudicable.length,
            baselineValue: null,
            delta: null,
            status: "not-comparable",
            reason: "no baseline arm was run for this scenario",
          }
        : incrementalBenefit(
            rate(succeeded, adjudicable.length),
            rate(baselineSucceeded, baselineAdjudicable.length),
          ),
    falseResidualRate: rate(falseResiduals, adjudicableResiduals.length),
    missedResidualRate: rate(missed, realProblems.length),
    unnecessaryReflectionRate: rate(needlessReflections, reflections.length),
    unnecessaryEscalationRate: rate(needlessEscalations, escalations.length),
    unnecessaryContextRetrievalRate: rate(
      retrievedAnyway,
      quietEpisodes.length,
    ),
    candidateCreationRate: rate(candidates.length, records.length),
    promotionPrecision: rate(wantedPromotions, promotions.length),
    challengeRate: rate(
      count(records, (r) => r.challengeRaised),
      records.length,
    ),
    humanInterventionRate: rate(
      count(records, (r) => r.humanIntervened),
      records.length,
    ),
    abstentionAccuracy: rate(abstained, abstentionOpportunities.length),
    episodeCount: records.length,
    unadjudicatedCount: records.length - adjudicable.length,
    meanLatencyMs:
      records.length === 0
        ? 0
        : records.reduce((sum, r) => sum + r.latencyMs, 0) / records.length,
    totalInputTokens: records.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0),
    totalOutputTokens: records.reduce(
      (sum, r) => sum + (r.outputTokens ?? 0),
      0,
    ),
  };
}

export interface ScenarioComparison {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly arms: Readonly<Partial<Record<ArmId, MetricSet>>>;
  /** Arms required for a complete comparison that were not run. */
  readonly missingArms: readonly ArmId[];
  readonly complete: boolean;
}
