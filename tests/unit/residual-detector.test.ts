import { describe, expect, it } from "vitest";

import type {
  EventRecord,
  JsonObject,
} from "../../packages/contracts/src/index.js";
import {
  ResidualDetector,
  type Expectation,
  type FieldContext,
  type OutcomeObservation,
  type RuleDetectionInput,
  type TimingDetectionInput,
} from "../../packages/residual/src/index.js";

const detectedAt = "2026-09-14T00:00:10.000Z";
const evidence = [{ eventId: "evidence-1", origin: "direct" as const }];
const field: FieldContext = {
  externalVerification: "strong",
  consequence: "low",
  reversibility: "easy",
  feedbackLatency: "short",
  actors: [{ type: "human", id: "user-1" }],
  explicitRules: [],
};

function expectation(overrides: Partial<Expectation> = {}): Expectation {
  return {
    id: "expectation-1",
    subject: { kind: "task", id: "task-1" },
    expected: { status: "complete", count: 2 },
    verification: "exact",
    createdAt: "2026-09-14T00:00:00.000Z",
    evidence,
    ...overrides,
  };
}

function observation(
  overrides: Partial<OutcomeObservation> = {},
): OutcomeObservation {
  return {
    id: "observation-1",
    subject: { kind: "task", id: "task-1" },
    actual: { status: "failed", count: 1 },
    observedAt: "2026-09-14T00:00:09.000Z",
    evidence: [{ eventId: "observation-1", origin: "direct" }],
    ...overrides,
  };
}

function event(
  id: string,
  type: string,
  traceId: string,
  payload: JsonObject,
  seq: number,
): EventRecord {
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id,
    type,
    occurredAt: "2026-09-14T00:00:00.000Z",
    observedAt: "2026-09-14T00:00:00.000Z",
    recordedAt: "2026-09-14T00:00:00.000Z",
    actor: { type: "system", id: "fixture" },
    traceId,
    source: { kind: "residual-fixture", ref: id },
    payload,
    provenance: { origin: "direct", confidence: 1 },
    seq,
    contentHash: "0".repeat(64),
    writer: {
      writerId: "test:residual",
      kind: "runtime",
      role: "OWNER",
      authn: "embedded-local",
      scopes: ["event.read"],
      policyVersion: 1,
    },
  };
}

describe("ResidualDetector", () => {
  it("creates an outcome residual only from an explicit expectation", () => {
    const detector = new ResidualDetector();
    const residual = detector.detectOutcome({
      expectation: expectation(),
      observation: observation(),
      field,
      detectedAt,
    });

    expect(residual).toMatchObject({
      id: "residual:outcome:expectation-1:observation-1",
      kind: "outcome",
      magnitude: 1,
      confidence: 1,
      persistence: "transient",
      effect: "unknown",
      baseline: {
        kind: "task",
        id: "task-1",
        value: { count: 2, status: "complete" },
      },
      observed: {
        kind: "task",
        id: "task-1",
        value: { count: 1, status: "failed" },
      },
    });
    expect(residual?.evidence).toHaveLength(2);
    expect(detector.detect({})).toEqual([]);
  });

  it("keeps exact matches and unverified predicates from becoming residuals", () => {
    const detector = new ResidualDetector();
    expect(
      detector.detectOutcome({
        expectation: expectation(),
        observation: observation({
          actual: { count: 2, status: "complete" },
        }),
        field,
        detectedAt,
      }),
    ).toBeNull();

    expect(() =>
      detector.detectOutcome({
        expectation: expectation({
          verification: "predicate",
          predicateId: "task-complete",
        }),
        observation: observation(),
        field,
        detectedAt,
      }),
    ).toThrowError("require an explicit verification result");

    expect(() =>
      detector.detectOutcome({
        expectation: expectation({ verification: "external" }),
        observation: observation(),
        field,
        detectedAt,
      }),
    ).toThrowError("require an explicit verification result");
  });

  it("keeps outcome comparison inside the explicit expectation time window", () => {
    const detector = new ResidualDetector();
    expect(() =>
      detector.detectOutcome({
        expectation: expectation({
          createdAt: "2026-09-14T00:00:05.000Z",
        }),
        observation: observation({
          observedAt: "2026-09-14T00:00:04.000Z",
        }),
        field,
        detectedAt,
      }),
    ).toThrowError("cannot precede expectation creation");
    expect(() =>
      detector.detectOutcome({
        expectation: expectation({
          validUntil: "2026-09-14T00:00:08.000Z",
        }),
        observation: observation(),
        field,
        detectedAt,
      }),
    ).toThrowError("outside the expectation validity window");
    expect(() =>
      detector.detectOutcome({
        expectation: expectation(),
        observation: observation(),
        field,
        detectedAt: "2026-09-14T00:00:10.000Z",
      }),
    ).not.toThrow();
  });

  it("requires both relevant subscription and time/seq thresholds for timing residuals", () => {
    const detector = new ResidualDetector();
    const base: TimingDetectionInput = {
      id: "timing-check-1",
      subject: { kind: "agent", id: "agent-1" },
      agentId: "agent-1",
      cursorSeq: 2,
      latestRelevantSeq: 8,
      observedAt: "2026-09-14T00:00:00.000Z",
      detectedAt: "2026-09-14T00:00:10.000Z",
      subscribed: true,
      threshold: { minSeqLag: 2, maxStalenessMs: 5_000 },
      field,
      evidence,
    };

    expect(detector.detectTiming({ ...base, subscribed: false })).toBeNull();
    expect(
      detector.detectTiming({
        ...base,
        threshold: { minSeqLag: 10, maxStalenessMs: 20_000 },
      }),
    ).toBeNull();

    const residual = detector.detectTiming(base);
    expect(residual).toMatchObject({
      id: "residual:timing:agent-1:timing-check-1",
      kind: "timing",
      effect: "unknown",
      observed: {
        value: {
          seqLag: 6,
          stalenessMs: 10_000,
        },
      },
    });
  });

  it("detects only declared rule checkpoint gaps within the requested trace", () => {
    const detector = new ResidualDetector();
    const input: RuleDetectionInput = {
      id: "rule-check-1",
      traceId: "trace-1",
      rule: {
        id: "production-card",
        requiredEventTypes: ["task.started", "task.completed"],
        requiredCheckpoints: ["card-reviewed"],
      },
      events: [
        event(
          "checkpoint",
          "task.checkpoint",
          "trace-1",
          {
            checkpoint: "card-reviewed",
          },
          1,
        ),
        event("other-trace", "task.started", "trace-2", {}, 2),
      ],
      field,
      detectedAt,
      evidence,
    };

    const residual = detector.detectRule(input);
    expect(residual).toMatchObject({
      id: "residual:rule:production-card:rule-check-1",
      kind: "rule",
      magnitude: 2 / 3,
      effect: "unknown",
      observed: {
        value: {
          traceId: "trace-1",
          eventCount: 1,
          missingEventTypes: ["task.started", "task.completed"],
          missingCheckpoints: [],
        },
      },
    });
    expect(
      detector.detectRule({
        ...input,
        rule: { id: "unverifiable-rule" },
      }),
    ).toBeNull();
    expect(
      detector.detectRule({
        ...input,
        events: [
          event("started", "task.started", "trace-1", {}, 1),
          event("completed", "task.completed", "trace-1", {}, 2),
          event(
            "checkpoint",
            "task.checkpoint",
            "trace-1",
            {
              checkpoints: ["card-reviewed"],
            },
            3,
          ),
        ],
      }),
    ).toBeNull();
  });
});
