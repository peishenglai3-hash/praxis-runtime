import { describe, expect, it } from "vitest";

import { formatRate, incrementalBenefit, rate, UNSCORED } from "../src/rate.js";

/**
 * The rate type's whole justification is that it cannot print a value it did
 * not measure. These tests are the negative controls for that claim: they check
 * that the *wrong* answers are unreachable, not merely that the right one is
 * produced.
 */
describe("a rate refuses to report a value it did not measure", () => {
  it("reports a real rate with its denominator attached", () => {
    const r = rate(2, 5);
    expect(r.value).toBe(0.4);
    expect(r.status).toBe("scored");
    expect(formatRate(r)).toBe("0.400 (2 of 5)");
  });

  it("is unscored — not zero — when there were no opportunities", () => {
    const r = rate(0, 0);
    expect(r.value).toBeNull();
    expect(r.status).toBe("unscored");
    expect(r.value).not.toBe(0);
  });

  it("never renders an empty denominator as a number", () => {
    const rendered = formatRate(rate(0, 0));
    // The defect this exists to prevent: a run in which nothing was measured
    // rendering as "0.000", which reads as a perfect score.
    expect(rendered).not.toContain("0.000");
    expect(rendered).toContain("unscored");
    expect(rendered).not.toContain("NaN");
  });

  it("distinguishes a measured zero from no measurement", () => {
    // Both of these are the hoped-for outcome of a false-positive metric, and
    // only one of them is a result.
    expect(formatRate(rate(0, 7))).toBe("0.000 (0 of 7)");
    expect(formatRate(rate(0, 0))).toBe("unscored (0 of 0)");
    expect(formatRate(rate(0, 7))).not.toBe(formatRate(rate(0, 0)));
  });

  it("refuses a numerator larger than its denominator rather than clamping", () => {
    expect(() => rate(3, 2)).toThrow(/cannot exceed/);
  });

  it("refuses non-integer and negative counts", () => {
    expect(() => rate(0.5, 2)).toThrow(/non-negative integer/);
    expect(() => rate(-1, 2)).toThrow(/non-negative integer/);
    expect(() => rate(1, Number.NaN)).toThrow(/non-negative integer/);
  });
});

describe("incremental benefit refuses to guess a comparison", () => {
  it("computes the difference when both arms were scored", () => {
    const result = incrementalBenefit(rate(8, 10), rate(5, 10));
    expect(result.status).toBe("computed");
    expect(result.delta).toBeCloseTo(0.3);
  });

  it("reports not-comparable, not zero, when the baseline is unscored", () => {
    const result = incrementalBenefit(rate(8, 10), rate(0, 0));
    expect(result.status).toBe("not-comparable");
    // A delta of 0 here would read as "the arm changed nothing", which is a
    // finding about the runtime. `null` reads as "no comparison exists", which
    // is a finding about the experiment. They are not interchangeable.
    expect(result.delta).toBeNull();
    expect(result.delta).not.toBe(0);
    expect(result.reason).toContain("baseline");
  });

  it("reports not-comparable when the arm itself is unscored", () => {
    const result = incrementalBenefit(rate(0, 0), rate(5, 10));
    expect(result.delta).toBeNull();
    expect(result.reason).toContain("arm");
  });

  it("names both sides when neither was measured", () => {
    const result = incrementalBenefit(UNSCORED, UNSCORED);
    expect(result.status).toBe("not-comparable");
    expect(result.reason).toContain("both");
  });
});
