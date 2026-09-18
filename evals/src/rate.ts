/**
 * A rate that cannot report a value it did not measure.
 *
 * Phase 6V's central measurement is a *false-positive* rate: how often the
 * runtime intervenes when the right behaviour was to stay quiet. The hoped-for
 * answer is zero, which makes one specific defect both likely and silent — a
 * rate whose denominator is zero, printed as `0.0`, reading as a perfect score.
 *
 * This is not a hypothetical. The OSS counterevidence scan
 * ([`../docs/eval/OSS-EVAL-COUNTEREVIDENCE-SCAN.md`]) found Inspect Evals fixed
 * this same defect four separate times, once in `sycophancy` where every model
 * scored `0.0` "through an unreachable denominator, and nothing raised". Their
 * summary of the class is the rule adopted here:
 *
 *   "A broken run indistinguishable from a bad model is what this section
 *    exists to prevent."
 *
 * So a `Rate` here carries its denominator, and a zero denominator produces
 * `null` with status `unscored` — never `0`, never `NaN`, never a number a
 * reader could mistake for a result. `formatRate` is the only sanctioned way to
 * turn one into text, and it prints the coverage alongside every value, because
 * a rate without its denominator is the thing being defended against.
 */

export type RateStatus = "scored" | "unscored";

export interface Rate {
  readonly numerator: number;
  readonly denominator: number;
  /** `null` exactly when `denominator === 0`. Never `NaN`. */
  readonly value: number | null;
  readonly status: RateStatus;
}

function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${value}`);
  }
}

export function rate(numerator: number, denominator: number): Rate {
  assertCount("numerator", numerator);
  assertCount("denominator", denominator);
  if (numerator > denominator) {
    // Not clamped. A numerator larger than its denominator means the caller is
    // counting two different populations, and silently returning 1 would hide
    // the only interesting thing about the number.
    throw new Error(
      `a rate's numerator (${numerator}) cannot exceed its denominator ` +
        `(${denominator}); two different populations are being counted`,
    );
  }
  if (denominator === 0) {
    return { numerator, denominator, value: null, status: "unscored" };
  }
  return {
    numerator,
    denominator,
    value: numerator / denominator,
    status: "scored",
  };
}

/** The zero-opportunity rate. Named so its use reads as a decision. */
export const UNSCORED: Rate = Object.freeze({
  numerator: 0,
  denominator: 0,
  value: null,
  status: "unscored" as const,
});

export function formatRate(r: Rate, digits = 3): string {
  if (r.status === "unscored") {
    // Deliberately not "0.000" and deliberately not "n/a": the reader has to be
    // able to tell "we measured nothing here" from "we measured zero".
    return `unscored (0 of 0)`;
  }
  return `${r.value!.toFixed(digits)} (${r.numerator} of ${r.denominator})`;
}

/**
 * The difference an arm made, which is the only number §2 of the owner's brief
 * actually asks for: not "did Praxis succeed" but "how much more did it succeed
 * than a simpler system did".
 *
 * The comparison is refused rather than guessed when either side is unscored.
 * `null` here means "this comparison cannot be made", which is a finding; `0`
 * would mean "the arm changed nothing", which is a different finding.
 */
export interface IncrementalBenefit {
  readonly armValue: number | null;
  readonly baselineValue: number | null;
  /** `null` when either side is unscored. Never a guessed difference. */
  readonly delta: number | null;
  readonly status: "computed" | "not-comparable";
  readonly reason: string;
}

export function incrementalBenefit(
  arm: Rate,
  baseline: Rate,
): IncrementalBenefit {
  if (arm.status === "unscored" || baseline.status === "unscored") {
    const missing =
      arm.status === "unscored" && baseline.status === "unscored"
        ? "both arm and baseline"
        : arm.status === "unscored"
          ? "the arm"
          : "the baseline";
    return {
      armValue: arm.value,
      baselineValue: baseline.value,
      delta: null,
      status: "not-comparable",
      reason: `${missing} had no opportunities, so no difference exists to report`,
    };
  }
  return {
    armValue: arm.value,
    baselineValue: baseline.value,
    delta: arm.value! - baseline.value!,
    status: "computed",
    reason: "",
  };
}
