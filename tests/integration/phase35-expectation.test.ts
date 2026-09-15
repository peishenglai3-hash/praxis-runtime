import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  permissionScopes,
  type EventEnvelope,
  type WriterContext,
} from "../../packages/contracts/src/index.js";
import type { ExpectationDefinition } from "../../packages/contracts/src/index.js";
import { Phase3Runtime } from "../../packages/runtime/src/index.js";
import {
  createExpectationProjection,
  ProjectionEngine,
} from "../../packages/state/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);
const testWriter: WriterContext = {
  writerId: "test:phase35",
  kind: "runtime",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
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
  directory = mkdtempSync(join(tmpdir(), "praxis-phase35-expectation-"));
  store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  return store;
}

function appendEvent(currentStore: SqliteEventStore, event: EventEnvelope) {
  return currentStore.append(event, testWriter);
}

function sourceEvent(id: string, recordedAt: string): EventEnvelope {
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id,
    type: "task.completed",
    occurredAt: recordedAt,
    observedAt: recordedAt,
    recordedAt,
    actor: { type: "human", id: "phase35-user" },
    source: { kind: "phase35-fixture", ref: id },
    payload: { status: "observed" },
    provenance: { origin: "direct", confidence: 1 },
  };
}

function definition(
  id: string,
  validFrom: string,
  evaluateBy: string,
  expiresAt: string,
  sourceEventId: string,
): ExpectationDefinition {
  return {
    id,
    source: { kind: "author-test", id },
    subject: { kind: "task", id: `${id}-task` },
    expected: { status: "complete" },
    verification: {
      mode: "external",
      verifier: { kind: "test-runner", id: "phase35-verifier" },
      criterion: { status: "complete" },
      timeoutMs: 1000,
    },
    createdAt: "2026-09-15T00:00:00.000Z",
    validFrom,
    evaluateBy,
    expiresAt,
    evidence: [{ eventId: sourceEventId, origin: "direct" }],
  };
}

function runtimeFor(currentStore: SqliteEventStore): Phase3Runtime {
  return new Phase3Runtime({
    events: currentStore,
    projections: currentStore,
    clock: { now: () => new Date("2026-09-15T00:00:06.000Z") },
    ids: { next: () => "phase35-id" },
    actor: { type: "system", id: "phase35-runtime" },
    writer: testWriter,
  });
}

function replayExpectation(currentStore: SqliteEventStore) {
  const engine = new ProjectionEngine(currentStore, currentStore);
  const result = engine.rebuild(createExpectationProjection());
  if (result.status !== "caught_up") {
    throw new Error(`expectation replay failed: ${JSON.stringify(result)}`);
  }
  return currentStore.getProjectionState("expectations_current")?.state as {
    expectations: Record<string, { status: string; lastEventSeq: number }>;
  };
}

describe("Phase 3.5 expectation and verification replay", () => {
  it("keeps valid delayed success as satisfied without a residual", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    appendEvent(
      currentStore,
      sourceEvent("async-01-source", "2026-09-15T00:00:01.000Z"),
    );
    runtime.recordExpectationDefinition(
      definition(
        "ASYNC-01",
        "2026-09-15T00:00:02.000Z",
        "2026-09-15T00:00:10.000Z",
        "2026-09-15T00:00:20.000Z",
        "async-01-source",
      ),
    );
    runtime.recordVerificationResult({
      id: "async-01-verification",
      expectationId: "ASYNC-01",
      verifier: { kind: "test-runner", id: "phase35-verifier" },
      observedAt: "2026-09-15T00:00:05.000Z",
      outcome: "satisfied",
      evidence: [{ eventId: "async-01-source", origin: "direct" }],
    });
    expect(
      replayExpectation(currentStore).expectations["ASYNC-01"]?.status,
    ).toBe("satisfied");
  });

  it("separates late timing concern from later satisfied outcome", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    appendEvent(
      currentStore,
      sourceEvent("async-02-source", "2026-09-15T00:00:01.000Z"),
    );
    runtime.recordExpectationDefinition(
      definition(
        "ASYNC-02",
        "2026-09-15T00:00:02.000Z",
        "2026-09-15T00:00:04.000Z",
        "2026-09-15T00:00:20.000Z",
        "async-02-source",
      ),
    );
    const feedback = appendEvent(
      currentStore,
      sourceEvent("async-02-feedback", "2026-09-15T00:00:06.000Z"),
    ).record;
    const timing = runtime.detectResiduals({
      timings: [
        {
          id: "async-02-timing",
          subject: { kind: "agent", id: "agent-02" },
          agentId: "agent-02",
          cursorSeq: 0,
          latestRelevantSeq: feedback.seq,
          observedAt: "2026-09-15T00:00:00.000Z",
          detectedAt: "2026-09-15T00:00:06.000Z",
          subscribed: true,
          threshold: { minSeqLag: 0, maxStalenessMs: 1000 },
          field: {
            externalVerification: "strong",
            consequence: "low",
            reversibility: "easy",
            feedbackLatency: "short",
            actors: [{ type: "agent", id: "agent-02" }],
            explicitRules: [],
          },
          evidence: [{ eventId: feedback.id, origin: "direct" }],
        },
      ],
    });
    expect(timing[0]?.kind).toBe("timing");
    runtime.recordVerificationResult({
      id: "async-02-verification",
      expectationId: "ASYNC-02",
      verifier: { kind: "test-runner", id: "phase35-verifier" },
      observedAt: "2026-09-15T00:00:08.000Z",
      outcome: "satisfied",
      evidence: [{ eventId: feedback.id, origin: "direct" }],
    });
    expect(
      replayExpectation(currentStore).expectations["ASYNC-02"]?.status,
    ).toBe("satisfied");
  });

  it("keeps stale-agent timing as timing rather than an outcome judgment", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    const source = appendEvent(
      currentStore,
      sourceEvent("async-03-source", "2026-09-15T00:00:01.000Z"),
    ).record;
    runtime.recordExpectationDefinition(
      definition(
        "ASYNC-03",
        "2026-09-15T00:00:02.000Z",
        "2026-09-15T00:00:10.000Z",
        "2026-09-15T00:00:20.000Z",
        source.id,
      ),
    );
    const residuals = runtime.detectResiduals({
      timings: [
        {
          id: "async-03-timing",
          subject: { kind: "agent", id: "agent-03" },
          agentId: "agent-03",
          cursorSeq: 0,
          latestRelevantSeq: source.seq,
          observedAt: "2026-09-15T00:00:00.000Z",
          detectedAt: "2026-09-15T00:00:05.000Z",
          subscribed: true,
          threshold: { minSeqLag: 0, maxStalenessMs: 1000 },
          field: {
            externalVerification: "strong",
            consequence: "medium",
            reversibility: "partial",
            feedbackLatency: "medium",
            actors: [{ type: "agent", id: "agent-03" }],
            explicitRules: [],
          },
          evidence: [{ eventId: source.id, origin: "direct" }],
        },
      ],
    });
    expect(residuals).toHaveLength(1);
    expect(residuals[0]).toMatchObject({ kind: "timing", effect: "unknown" });
    expect(
      replayExpectation(currentStore).expectations["ASYNC-03"]?.status,
    ).toBe("pending");
  });

  it("records an explicit verifier mismatch as violated", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    appendEvent(
      currentStore,
      sourceEvent("async-04-source", "2026-09-15T00:00:01.000Z"),
    );
    runtime.recordExpectationDefinition(
      definition(
        "ASYNC-04",
        "2026-09-15T00:00:02.000Z",
        "2026-09-15T00:00:10.000Z",
        "2026-09-15T00:00:20.000Z",
        "async-04-source",
      ),
    );
    runtime.recordVerificationResult({
      id: "async-04-verification",
      expectationId: "ASYNC-04",
      verifier: { kind: "test-runner", id: "phase35-verifier" },
      observedAt: "2026-09-15T00:00:09.000Z",
      outcome: "violated",
      evidence: [{ eventId: "async-04-source", origin: "direct" }],
      details: { reason: "test runner failed" },
    });
    expect(
      replayExpectation(currentStore).expectations["ASYNC-04"]?.status,
    ).toBe("violated");
  });

  it("enforces validFrom and expiresAt without collapsing evaluateBy lateness", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    appendEvent(
      currentStore,
      sourceEvent("async-window-source", "2026-09-15T00:00:01.000Z"),
    );
    runtime.recordExpectationDefinition(
      definition(
        "ASYNC-WINDOW",
        "2026-09-15T00:00:02.000Z",
        "2026-09-15T00:00:04.000Z",
        "2026-09-15T00:00:10.000Z",
        "async-window-source",
      ),
    );

    expect(() =>
      runtime.recordVerificationResult({
        id: "async-window-early",
        expectationId: "ASYNC-WINDOW",
        verifier: { kind: "test-runner", id: "phase35-verifier" },
        observedAt: "2026-09-15T00:00:01.000Z",
        outcome: "satisfied",
        evidence: [{ eventId: "async-window-source", origin: "direct" }],
      }),
    ).toThrowError("cannot precede expectation validFrom");

    runtime.recordVerificationResult({
      id: "async-window-late",
      expectationId: "ASYNC-WINDOW",
      verifier: { kind: "test-runner", id: "phase35-verifier" },
      observedAt: "2026-09-15T00:00:05.000Z",
      outcome: "satisfied",
      evidence: [{ eventId: "async-window-source", origin: "direct" }],
    });

    expect(() =>
      runtime.recordVerificationResult({
        id: "async-window-expired",
        expectationId: "ASYNC-WINDOW",
        verifier: { kind: "test-runner", id: "phase35-verifier" },
        observedAt: "2026-09-15T00:00:11.000Z",
        outcome: "violated",
        evidence: [{ eventId: "async-window-source", origin: "direct" }],
      }),
    ).toThrowError("outside the expectation window");
  });

  it("bridges structured verification into the bounded outcome residual path", () => {
    const currentStore = openStore();
    const runtime = runtimeFor(currentStore);
    const source = appendEvent(
      currentStore,
      sourceEvent("structured-outcome-source", "2026-09-15T00:00:01.000Z"),
    ).record;
    runtime.recordExpectationDefinition(
      definition(
        "STRUCTURED-OUTCOME",
        "2026-09-15T00:00:02.000Z",
        "2026-09-15T00:00:10.000Z",
        "2026-09-15T00:00:20.000Z",
        source.id,
      ),
    );
    const verification = {
      id: "structured-outcome-verification",
      expectationId: "STRUCTURED-OUTCOME",
      verifier: { kind: "test-runner", id: "phase35-verifier" },
      observedAt: "2026-09-15T00:00:08.000Z",
      outcome: "violated" as const,
      evidence: [{ eventId: source.id, origin: "direct" as const }],
      details: { actual: { status: "failed" } },
    };
    runtime.recordVerificationResult(verification);
    const residual = runtime.detectStructuredOutcomeResidual(
      verification,
      {
        externalVerification: "strong",
        consequence: "medium",
        reversibility: "partial",
        feedbackLatency: "short",
        actors: [{ type: "system", id: "phase35-verifier" }],
        explicitRules: [],
      },
      "2026-09-15T00:00:09.000Z",
    );

    expect(residual).toMatchObject({
      kind: "outcome",
      baselineId: "STRUCTURED-OUTCOME",
      effect: "unknown",
      observed: { value: { status: "failed" } },
    });
    expect(runtime.recordResiduals([residual!])[0]?.inserted).toBe(true);
    expect(currentStore.query({ type: "residual.detected" })).toHaveLength(1);
  });

  it("rejects malformed structured lifecycle writes at the generic store boundary", () => {
    const currentStore = openStore();
    const base = {
      schemaVersion: "1" as const,
      eventVersion: "1",
      occurredAt: "2026-09-15T00:00:00.000Z",
      observedAt: "2026-09-15T00:00:00.000Z",
      recordedAt: "2026-09-15T00:00:00.000Z",
      actor: { type: "system" as const, id: "forged-writer" },
      source: { kind: "phase35-forged", ref: "forged" },
      evidence: [{ artifactHash: "fixture", origin: "direct" as const }],
      provenance: { origin: "declared" as const, confidence: 1 },
    };

    expect(() =>
      appendEvent(currentStore, {
        ...base,
        id: "forged-expectation",
        type: "expectation.created",
        payload: {
          materialClassification: "declared",
          id: "forged-expectation",
        },
      }),
    ).toThrowError(/expectation definition payload|Phase 3\.5 expectation/);

    expect(() =>
      appendEvent(currentStore, {
        ...base,
        id: "forged-verification",
        type: "verification.completed",
        payload: {
          materialClassification: "declared",
          result: {},
        },
      }),
    ).toThrowError(/verification result payload|Phase 3\.5 expectation/);
    expect(currentStore.getLastSeq()).toBe(0);
  });
});
