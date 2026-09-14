import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  Clock,
  EventEnvelope,
  JsonValue,
} from "../../packages/contracts/src/index.js";
import type {
  Expectation,
  FieldContext,
  OutcomeObservation,
  Residual,
} from "../../packages/residual/src/index.js";
import {
  expectationRegisteredEventId,
  Phase3Runtime,
  residualDetectedEventId,
} from "../../packages/runtime/src/index.js";
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

function runtimeFor(
  currentStore: SqliteEventStore,
  clock: Clock = { now: () => new Date("2026-09-14T00:00:00.000Z") },
): Phase3Runtime {
  return new Phase3Runtime({
    events: currentStore,
    projections: currentStore,
    clock,
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
    runtime.recordExpectation(expectation());

    const residual = detectOutcome(runtime);
    const residualEvent = runtime.recordResiduals([residual])[0]!;
    const retriedResidualEvent = runtime.recordResiduals([residual])[0]!;
    const feedbackEvent = currentStore.append(
      event({
        id: "phase3-feedback-event",
        recordedAt: "2026-09-14T00:00:12.000Z",
        payload: { status: "rechecked" },
      }),
    ).record;
    const proposal = runtime.runReflection({
      residual,
      budget: {
        maxDepth: 2,
        maxHypotheses: 2,
        maxToolCalls: 1,
        maxElapsedMs: 1_000,
      },
      evidenceDelta: {
        fromSeq: residualEvent.record.seq,
        toSeq: feedbackEvent.seq,
        evidence: [{ eventId: feedbackEvent.id, origin: "direct" }],
      },
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
    expect(currentStore.getSince(2).map((record) => record.type)).toEqual([
      "residual.detected",
      "task.completed",
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
      derivedFrom: [
        residualEvent.record.id,
        "phase3-source-event",
        "phase3-feedback-event",
      ],
    });
  });

  it("stops or escalates without executing any proposal", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());
    runtime.recordExpectation(expectation());
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
        evidenceDelta: { fromSeq: 2, toSeq: 2, evidence: [] },
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
      evidenceDelta: {
        fromSeq: 1,
        toSeq: 2,
        evidence: [
          {
            eventId: expectationRegisteredEventId(expectation().id),
            origin: "declared",
          },
        ],
      },
    });
    expect(escalated.decision).toBe("ESCALATE");
    expect(escalated.recommendedActions[0]?.requiredPermission).toBe(
      "human-confirmation",
    );
    expect(currentStore.query({ type: "residual.detected" })).toEqual([]);
    expect(currentStore.query({ type: "reflection.proposed" })).toEqual([]);
  });

  it("rejects missing evidence and proposals detached from the recorded residual", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());
    runtime.recordExpectation(expectation());
    const residual = detectOutcome(runtime);
    const residualEvent = runtime.recordResiduals([residual])[0]!;
    const proposal = runtime.runReflection({
      residual,
      budget: {
        maxDepth: 1,
        maxHypotheses: 1,
        maxToolCalls: 0,
        maxElapsedMs: 1_000,
      },
      evidenceDelta: {
        fromSeq: 2,
        toSeq: residualEvent.record.seq,
        evidence: [{ eventId: residualEvent.record.id, origin: "inferred" }],
      },
    });

    expect(() =>
      runtime.recordReflectionProposal(residual, {
        ...proposal,
        budgetUsed: { ...proposal.budgetUsed, depth: 99 },
      }),
    ).toThrowError("depth usage exceeds its reflection budget");

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

  it("binds timing residuals to a current ledger cursor and evidence event", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    const source = currentStore.append(event()).record;
    const timing = {
      id: "phase3-timing-check",
      subject: { kind: "agent", id: "phase3-agent" },
      agentId: "phase3-agent",
      cursorSeq: 0,
      latestRelevantSeq: source.seq,
      observedAt: "2026-09-14T00:00:00.000Z",
      detectedAt: "2026-09-14T00:00:10.000Z",
      subscribed: true,
      threshold: { minSeqLag: 0, maxStalenessMs: 1_000 },
      field,
      evidence: [{ eventId: source.id, origin: "direct" as const }],
    };

    expect(() =>
      runtime.detectResiduals({
        timings: [
          {
            ...timing,
            evidence: [{ assetId: "timing-artifact", origin: "direct" }],
          },
        ],
      }),
    ).toThrowError("ledger event evidence reference");

    expect(() =>
      runtime.detectResiduals({
        timings: [{ ...timing, latestRelevantSeq: 999 }],
      }),
    ).toThrowError("ahead of the event ledger");

    const negativeTimingPayload = {
      ...timing,
      cursorSeq: -1,
    };
    expect(() =>
      currentStore.append(
        event({
          id: "forged-negative-timing",
          type: "residual.detected",
          occurredAt: detectedAt,
          observedAt: detectedAt,
          recordedAt: detectedAt,
          operationId: "forged-negative-timing",
          source: { kind: "forged-residual", ref: "negative-timing" },
          payload: {
            materialClassification: "inferred",
            residualId: "forged-negative-timing",
            kind: "timing",
            observed: {
              kind: "agent",
              id: "phase3-agent",
              value: {
                cursorSeq: negativeTimingPayload.cursorSeq,
                latestRelevantSeq: source.seq,
              },
            },
            field,
            confidence: 1,
            persistence: "transient",
            effect: "unknown",
            evidence: [{ eventId: source.id, origin: "direct" }],
            detectedAt,
          } as unknown as JsonValue,
          evidence: [{ eventId: source.id, origin: "direct" }],
          provenance: { origin: "inferred", confidence: 1 },
        }),
      ),
    ).toThrowError(
      "residual.detected payload failed canonical schema validation",
    );

    const [residual] = runtime.detectResiduals({ timings: [timing] });
    expect(residual?.kind).toBe("timing");
    expect(runtime.recordResiduals([residual!])[0]?.inserted).toBe(true);

    currentStore.close();
    store = undefined;
    const rawDatabase = new DatabaseSync(join(directory!, "events.db"));
    try {
      const forgedPayload = {
        materialClassification: "inferred",
        residualId: "forged-negative-timing-raw",
        kind: "timing",
        observed: {
          kind: "agent",
          id: "phase3-agent",
          value: { cursorSeq: -1, latestRelevantSeq: source.seq },
        },
        field,
        confidence: 1,
        persistence: "transient",
        effect: "unknown",
        evidence: [{ eventId: source.id, origin: "direct" }],
        detectedAt,
      };
      expect(() =>
        rawDatabase
          .prepare(
            `INSERT INTO events (
              id, schema_version, event_version, type,
              occurred_at, observed_at, recorded_at,
              actor_type, actor_id, session_id, trace_id, operation_id,
              source_json, payload_json, evidence_json, links_json,
              provenance_json, content_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "forged-negative-timing-raw",
            "1",
            "1",
            "residual.detected",
            Date.parse(detectedAt),
            Date.parse(detectedAt),
            Date.parse(detectedAt),
            "system",
            "forged",
            null,
            null,
            "forged-negative-timing-raw",
            JSON.stringify({ kind: "forged", ref: "negative-timing" }),
            JSON.stringify(forgedPayload),
            JSON.stringify(forgedPayload.evidence),
            null,
            JSON.stringify({ origin: "inferred", confidence: 1 }),
            "forged-hash",
          ),
      ).toThrowError("residual detection failed ledger integrity checks");
    } finally {
      rawDatabase.close();
    }
  });

  it("anchors outcomes to a registered expectation and rejects forged effects", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());

    const declared = expectation();
    expect(runtime.recordExpectation(declared).inserted).toBe(true);
    expect(runtime.recordExpectation(declared).inserted).toBe(false);
    const residual = detectOutcome(runtime);
    expect(runtime.recordResiduals([residual])[0]?.inserted).toBe(true);

    expect(() =>
      runtime.recordResiduals([{ ...residual, effect: "harmful" }]),
    ).toThrowError("unknown effect");
    expect(currentStore.query({ type: "residual.detected" })).toHaveLength(1);
  });

  it("rolls back an entire residual batch when one event conflicts", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());
    runtime.recordExpectation(expectation());
    const residual = detectOutcome(runtime);
    const conflicting = {
      ...residual,
      observed: { ...residual.observed, value: { status: "changed" } },
    };

    expect(() => runtime.recordResiduals([residual, conflicting])).toThrowError(
      expect.objectContaining({ code: "EVENT_ID_CONFLICT" }),
    );
    expect(currentStore.query({ type: "residual.detected" })).toHaveLength(0);
  });

  it("keeps retries stable across clock drift and permits a later evidence round", () => {
    const currentStore = openStore();
    let now = new Date("2026-09-14T00:00:00.000Z");
    const runtime = runtimeFor(currentStore, { now: () => new Date(now) });
    currentStore.append(event());
    runtime.recordExpectation(expectation());
    const residual = detectOutcome(runtime);
    const residualResult = runtime.recordResiduals([residual])[0]!;
    const firstSource = currentStore.append(
      event({
        id: "phase3-first-round-source",
        recordedAt: "2026-09-14T00:00:12.000Z",
        payload: { status: "rechecked" },
      }),
    ).record;
    const firstDelta = {
      fromSeq: residualResult.record.seq,
      toSeq: firstSource.seq,
      evidence: [{ eventId: firstSource.id, origin: "direct" as const }],
    };
    const firstProposal = runtime.runReflection({
      residual,
      budget: {
        maxDepth: 2,
        maxHypotheses: 2,
        maxToolCalls: 1,
        maxElapsedMs: 1_000,
      },
      evidenceDelta: firstDelta,
    });
    const firstProposalResult = runtime.recordReflectionProposal(
      residual,
      firstProposal,
    );

    now = new Date("2026-09-15T12:00:00.000Z");
    expect(runtime.recordResiduals([residual])[0]?.inserted).toBe(false);
    expect(
      runtime.recordReflectionProposal(residual, firstProposal).inserted,
    ).toBe(false);
    expect(
      currentStore.getById(firstProposalResult.record.id)?.recordedAt,
    ).toBe(firstProposalResult.record.recordedAt);

    const secondSource = currentStore.append(
      event({
        id: "phase3-source-event-2",
        recordedAt: "2026-09-14T00:00:14.000Z",
        payload: { status: "rechecked" },
      }),
    );
    const overlappingProposal = runtime.runReflection({
      residual,
      budget: firstProposal.budget,
      evidenceDelta: {
        fromSeq: residualResult.record.seq,
        toSeq: secondSource.record.seq,
        evidence: [{ eventId: secondSource.record.id, origin: "direct" }],
      },
    });
    expect(() =>
      runtime.recordReflectionProposal(residual, overlappingProposal),
    ).toThrowError("previous accepted end cursor");
    const secondProposal = runtime.runReflection({
      residual,
      budget: firstProposal.budget,
      evidenceDelta: {
        fromSeq: firstDelta.toSeq,
        toSeq: secondSource.record.seq,
        evidence: [{ eventId: secondSource.record.id, origin: "direct" }],
      },
    });
    const secondProposalResult = runtime.recordReflectionProposal(
      residual,
      secondProposal,
    );
    expect(secondProposalResult.record.id).not.toBe(
      firstProposalResult.record.id,
    );
    expect(currentStore.query({ type: "reflection.proposed" })).toHaveLength(2);
  });

  it("rejects malformed derived events at the generic low-level writer", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    currentStore.append(event());

    expect(() =>
      currentStore.append(
        event({
          id: "forged-residual-event",
          type: "residual.detected",
          operationId: "forged-residual",
          payload: {
            materialClassification: "inferred",
            residualId: "forged-residual",
            kind: "outcome",
            effect: "harmful",
            evidence,
          },
          evidence,
          links: { derivedFrom: ["phase3-source-event"] },
          provenance: { origin: "inferred", confidence: 1 },
        }),
      ),
    ).toThrowError(
      "residual.detected payload failed canonical schema validation",
    );

    expect(() =>
      currentStore.append(
        event({
          id: "forged-reflection-event",
          type: "reflection.proposed",
          operationId: "reflection:forged-residual:1",
          payload: {
            materialClassification: "inferred",
            residualId: "forged-residual",
            decision: "CONTINUE",
            reasons: ["forged"],
            hypotheses: [],
            recommendedActions: [],
            budget: {
              maxDepth: 1,
              maxHypotheses: 1,
              maxToolCalls: 0,
              maxElapsedMs: 100,
            },
            budgetUsed: { depth: 0, hypotheses: 0, toolCalls: 0, elapsedMs: 0 },
            evidenceDelta: { fromSeq: 0, toSeq: 1, evidence },
          },
          evidence,
          links: {
            respondsTo: ["missing-residual"],
            derivedFrom: ["phase3-source-event"],
          },
          provenance: { origin: "inferred", confidence: 1 },
        }),
      ),
    ).toThrowError(
      "reflection.proposed payload failed canonical schema validation",
    );

    const declared = expectation({ id: "phase3-forged-expectation" });
    const declaredPayload = {
      materialClassification: "declared",
      expectationId: declared.id,
      subject: declared.subject,
      expected: declared.expected,
      verification: declared.verification,
      createdAt: declared.createdAt,
      evidence: [{ eventId: "missing-event", origin: "direct" as const }],
    };
    expect(() =>
      currentStore.append(
        event({
          id: expectationRegisteredEventId(declared.id),
          type: "expectation.registered",
          occurredAt: declared.createdAt,
          observedAt: declared.createdAt,
          recordedAt: declared.createdAt,
          operationId: declared.id,
          source: { kind: "forged-expectation", ref: declared.id },
          payload: declaredPayload as unknown as JsonValue,
          evidence: declaredPayload.evidence,
          provenance: { origin: "declared", confidence: 1 },
        }),
      ),
    ).toThrowError("expectation registration failed ledger integrity checks");

    runtime.recordExpectation(declared);
    const [candidate] = runtime.detectResiduals({
      outcomes: [
        {
          expectation: declared,
          observation: observation(),
          field,
          detectedAt,
        },
      ],
    });
    expect(candidate).toBeDefined();
    const forgedResidualId = "phase3-forged-baseline";
    const { id: _candidateId, ...candidatePayload } = candidate!;
    const forgedResidualPayload = {
      ...candidatePayload,
      materialClassification: "inferred" as const,
      residualId: forgedResidualId,
      baseline: {
        ...candidate!.baseline!,
        value: { status: "not-the-registered-expectation" },
      },
    };
    expect(() =>
      currentStore.append(
        event({
          id: residualDetectedEventId(forgedResidualId),
          type: "residual.detected",
          occurredAt: detectedAt,
          observedAt: detectedAt,
          recordedAt: detectedAt,
          operationId: forgedResidualId,
          source: { kind: "forged-residual", ref: forgedResidualId },
          payload: forgedResidualPayload as unknown as JsonValue,
          evidence: candidate!.evidence,
          links: { derivedFrom: ["phase3-source-event"] },
          provenance: { origin: "inferred", confidence: 1 },
        }),
      ),
    ).toThrowError("residual detection failed ledger integrity checks");

    const recorded = runtime.recordResiduals([candidate!])[0]!;
    currentStore.close();
    store = undefined;
    const rawDatabase = new DatabaseSync(join(directory!, "events.db"));
    try {
      expect(() =>
        rawDatabase
          .prepare("DELETE FROM events WHERE id = ?")
          .run(recorded.record.id),
      ).toThrowError("Phase 3 domain events are append-only");
    } finally {
      rawDatabase.close();
    }
  });
});
