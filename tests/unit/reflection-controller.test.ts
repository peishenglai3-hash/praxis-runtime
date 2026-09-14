import { describe, expect, it } from "vitest";

import type { FieldContext } from "../../packages/residual/src/index.js";
import type { Residual } from "../../packages/residual/src/index.js";
import {
  ReflectionController,
  type ReflectionBudget,
} from "../../packages/reflection/src/index.js";

const evidence = [{ eventId: "residual-source-1", origin: "direct" as const }];

const field: FieldContext = {
  externalVerification: "strong",
  consequence: "low",
  reversibility: "easy",
  feedbackLatency: "short",
  actors: [{ type: "human", id: "user-1" }],
  explicitRules: [],
};

const budget: ReflectionBudget = {
  maxDepth: 2,
  maxHypotheses: 2,
  maxToolCalls: 1,
  maxElapsedMs: 1_000,
};

function residual(overrides: Partial<Residual> = {}): Residual {
  return {
    id: "residual:outcome:expectation-1:observation-1",
    kind: "outcome",
    baseline: {
      kind: "task",
      id: "task-1",
      value: { status: "complete" },
    },
    observed: {
      kind: "task",
      id: "task-1",
      value: { status: "failed" },
    },
    field,
    magnitude: 1,
    confidence: 1,
    persistence: "transient",
    effect: "unknown",
    evidence,
    detectedAt: "2026-09-14T00:00:10.000Z",
    ...overrides,
  };
}

describe("ReflectionController", () => {
  it("returns a deterministic, bounded proposal without executing it", () => {
    const controller = new ReflectionController();
    const result = controller.reflect({
      residual: residual(),
      budget,
      newEvidenceAvailable: true,
    });

    expect(result).toMatchObject({
      residualId: "residual:outcome:expectation-1:observation-1",
      decision: "CONTINUE",
      budgetUsed: {
        depth: 1,
        hypotheses: 1,
        toolCalls: 0,
        elapsedMs: 0,
      },
      recommendedActions: [
        {
          kind: "verify-external",
          requiredPermission: "external-verifier",
        },
      ],
    });
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0]).toMatchObject({
      support: evidence,
      counterevidence: [],
      estimatedCost: 1,
    });
    expect(result.hypotheses[0]?.testability).toContain("Compare");
  });

  it("stops when the same residual has no new evidence", () => {
    const result = new ReflectionController().reflect({
      residual: residual(),
      budget,
      newEvidenceAvailable: false,
    });

    expect(result.decision).toBe("STOP");
    expect(result.hypotheses).toEqual([]);
    expect(result.recommendedActions).toEqual([]);
    expect(result.reasons[0]).toContain("cannot self-call");
  });

  it("escalates weak or high-consequence situations to human control", () => {
    const result = new ReflectionController().reflect({
      residual: residual({
        field: {
          ...field,
          externalVerification: "weak",
          consequence: "high",
          reversibility: "hard",
        },
      }),
      budget,
      newEvidenceAvailable: true,
    });

    expect(result.decision).toBe("ESCALATE");
    expect(result.reasons).toEqual([
      "high-consequence and hard-to-reverse work requires human control",
      "external verification is weak for this field",
    ]);
    expect(result.recommendedActions).toMatchObject([
      {
        kind: "request-human-confirmation",
        requiredPermission: "human-confirmation",
      },
    ]);
  });

  it("stops before producing a proposal when any hard budget is exhausted", () => {
    const controller = new ReflectionController();
    const cases = [
      {
        budget: { ...budget, maxDepth: 0 },
        message: "maximum reflection depth",
      },
      {
        budget: { ...budget, maxHypotheses: 0 },
        message: "maximum hypothesis",
      },
      {
        budget: { ...budget, maxElapsedMs: 0 },
        message: "maximum reflection elapsed-time",
      },
      {
        budget: { ...budget, maxDepth: 1 },
        usage: { depth: 1 },
        message: "maximum reflection depth",
      },
    ];

    for (const testCase of cases) {
      const result = controller.reflect({
        residual: residual(),
        budget: testCase.budget,
        newEvidenceAvailable: true,
        ...(testCase.usage === undefined ? {} : { usage: testCase.usage }),
      });
      expect(result.decision, testCase.message).toBe("STOP");
      expect(result.hypotheses, testCase.message).toEqual([]);
      expect(result.recommendedActions, testCase.message).toEqual([]);
      expect(result.reasons[0], testCase.message).toContain(testCase.message);
    }
  });

  it("never auto-adjudicates representation, relation, or retrospective residuals", () => {
    const result = new ReflectionController().reflect({
      residual: residual({ kind: "representation" }),
      budget,
      newEvidenceAvailable: true,
    });

    expect(result.decision).toBe("ESCALATE");
    expect(result.recommendedActions[0]?.requiredPermission).toBe(
      "human-confirmation",
    );
  });
});
