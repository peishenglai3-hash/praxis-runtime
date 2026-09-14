import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { EventEnvelope } from "../../packages/contracts/src/index.js";
import type {
  Expectation,
  FieldContext,
  OutcomeObservation,
  Residual,
} from "../../packages/residual/src/index.js";
import { Phase3Runtime } from "../../packages/runtime/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);
const detectedAt = "2026-09-14T00:00:10.000Z";
const evidence = [
  { eventId: "phase3-source-event", origin: "direct" as const },
];
const field: FieldContext = {
  externalVerification: "strong",
  consequence: "low",
  reversibility: "easy",
  feedbackLatency: "short",
  actors: [{ type: "human", id: "user-1" }],
  explicitRules: [],
};

let directory: string | undefined;
let store: SqliteEventStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function openStore(): SqliteEventStore {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase3-"));
  store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  return store;
}

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id: "phase3-source-event",
    type: "task.completed",
    occurredAt: "2026-09-14T00:00:00.000Z",
    observedAt: "2026-09-14T00:00:01.000Z",
    recordedAt: "2026-09-14T00:00:02.000Z",
    actor: { type: "human", id: "user-1" },
    traceId: "phase3-trace-1",
    source: { kind: "phase3-fixture", ref: "task-1" },
    payload: { status: "failed" },
    provenance: { origin: "direct", confidence: 1 },
    ...overrides,
  };
}

function expectation(overrides: Partial<Expectation> = {}): Expectation {
  return {
    id: "phase3-expectation-1",
    traceId: "phase3-trace-1",
    subject: { kind: "task", id: "task-1" },
    expected: { status: "complete" },
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
    id: "phase3-observation-1",
    traceId: "phase3-trace-1",
    subject: { kind: "task", id: "task-1" },
    actual: { status: "failed" },
    observedAt: "2026-09-14T00:00:09.000Z",
    evidence: [{ eventId: "phase3-source-event", origin: "direct" }],
    ...overrides,
  };
}

function runtimeFor(currentStore: SqliteEventStore): Phase3Runtime {
  return new Phase3Runtime({
    events: currentStore,
    projections: currentStore,
    clock: { now: () => new Date("2026-09-14T00:00:00.000Z") },
    ids: { next: () => "phase3-id" },
    actor: { type: "system", id: "phase3-runtime" },
  });
}

function detectOutcome(runtime: Phase3Runtime): Residual {
  const result = runtime.detectResiduals({
    outcomes: [
      {
        expectation: expectation(),
        observation: observation(),
        field,
        detectedAt,
      },
    ],
  });
  expect(result).toHaveLength(1);
  return result[0]!;
}

describe("Phase 3 residual and reflection runtime", () => {
  it("records residuals and proposals as separate idempotent events", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());

    const residual = detectOutcome(runtime);
    const residualEvent = runtime.recordResiduals([residual])[0]!;
    const retriedResidualEvent = runtime.recordResiduals([residual])[0]!;
    const proposal = runtime.runReflection({
      residual,
      budget: {
        maxDepth: 2,
        maxHypotheses: 2,
        maxToolCalls: 1,
        maxElapsedMs: 1_000,
      },
      newEvidenceAvailable: true,
    });
    const proposalEvent = runtime.recordReflectionProposal(residual, proposal);
    const retriedProposalEvent = runtime.recordReflectionProposal(
      residual,
      proposal,
    );

    expect(residualEvent.inserted).toBe(true);
    expect(retriedResidualEvent.inserted).toBe(false);
    expect(proposal.decision).toBe("CONTINUE");
    expect(proposalEvent.inserted).toBe(true);
    expect(retriedProposalEvent.inserted).toBe(false);
    expect(currentStore.getSince(1).map((record) => record.type)).toEqual([
      "residual.detected",
      "reflection.proposed",
    ]);
    expect(
      currentStore.getById(residualEvent.record.id)?.payload,
    ).toMatchObject({
      materialClassification: "inferred",
      residualId: residual.id,
      kind: "outcome",
      effect: "unknown",
    });
    expect(
      currentStore.getById(proposalEvent.record.id)?.payload,
    ).toMatchObject({
      materialClassification: "inferred",
      residualId: residual.id,
      decision: "CONTINUE",
    });
    expect(proposalEvent.record.links).toEqual({
      respondsTo: [residualEvent.record.id],
      derivedFrom: [residualEvent.record.id, "phase3-source-event"],
    });
  });

  it("stops or escalates without executing any proposal", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());
    const residual = detectOutcome(runtime);

    expect(
      runtime.runReflection({
        residual,
        budget: {
          maxDepth: 2,
          maxHypotheses: 2,
          maxToolCalls: 1,
          maxElapsedMs: 1_000,
        },
        newEvidenceAvailable: false,
      }),
    ).toMatchObject({
      decision: "STOP",
      hypotheses: [],
      recommendedActions: [],
    });

    const escalated = runtime.runReflection({
      residual: {
        ...residual,
        field: {
          ...field,
          externalVerification: "weak",
          consequence: "high",
          reversibility: "hard",
        },
      },
      budget: {
        maxDepth: 2,
        maxHypotheses: 2,
        maxToolCalls: 1,
        maxElapsedMs: 1_000,
      },
      newEvidenceAvailable: true,
    });
    expect(escalated.decision).toBe("ESCALATE");
    expect(escalated.recommendedActions[0]?.requiredPermission).toBe(
      "human-confirmation",
    );
    expect(currentStore.getSince(1)).toEqual([]);
  });

  it("rejects missing evidence and proposals detached from the recorded residual", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());
    const residual = detectOutcome(runtime);
    runtime.recordResiduals([residual]);
    const proposal = runtime.runReflection({
      residual,
      budget: {
        maxDepth: 1,
        maxHypotheses: 1,
        maxToolCalls: 0,
        maxElapsedMs: 1_000,
      },
      newEvidenceAvailable: true,
    });

    expect(() =>
      runtime.recordResiduals([
        {
          ...residual,
          id: "residual:outcome:missing-evidence",
          evidence: [{ eventId: "missing-event", origin: "direct" }],
        },
      ]),
    ).toThrowError("residual evidence event is not present");
    expect(() =>
      runtime.recordReflectionProposal(
        {
          ...residual,
          observed: {
            ...residual.observed,
            value: { status: "changed-after-recording" },
          },
        },
        proposal,
      ),
    ).toThrowError("matching recorded residual.detected event");
    expect(currentStore.query({ type: "residual.detected" })).toHaveLength(1);
    expect(currentStore.query({ type: "reflection.proposed" })).toHaveLength(0);
  });

  it("keeps concurrent pure detection independent and records no false positive", async () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve(
          runtime.detectResiduals({
            outcomes: [
              {
                expectation: expectation(),
                observation: observation({
                  actual: { status: "complete" },
                }),
                field,
                detectedAt,
              },
            ],
          }),
        ),
      ),
    );

    expect(results.every((result) => result.length === 0)).toBe(true);
    expect(currentStore.getSince(1)).toEqual([]);
  });
});
