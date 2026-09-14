import { Phase3Runtime } from "../packages/runtime/dist/index.js";
import { SqliteEventStore } from "../packages/store/dist/index.js";
import { argv, stdout } from "node:process";

const [, , filename, migrationsDir, workerId] = argv;
if (
  filename === undefined ||
  migrationsDir === undefined ||
  workerId === undefined
) {
  throw new Error(
    "phase3 worker requires filename, migrationsDir, and workerId",
  );
}

const store = new SqliteEventStore({ filename, migrationsDir });
try {
  store.append({
    schemaVersion: "1",
    eventVersion: "1",
    id: "phase3-shared-source",
    type: "task.completed",
    occurredAt: "2026-09-14T00:00:00.000Z",
    observedAt: "2026-09-14T00:00:01.000Z",
    recordedAt: "2026-09-14T00:00:02.000Z",
    actor: { type: "human", id: "phase3-user" },
    traceId: "phase3-shared-trace",
    source: { kind: "phase3-concurrency", ref: "shared-source" },
    payload: { status: "failed" },
    provenance: { origin: "direct", confidence: 1 },
  });

  const runtime = new Phase3Runtime({
    events: store,
    projections: store,
    clock: { now: () => new Date("2026-09-14T00:00:00.000Z") },
    ids: { next: () => `phase3-worker-${workerId}` },
    actor: { type: "system", id: "phase3-coordinator" },
  });
  const expectation = {
    id: "phase3-shared-expectation",
    traceId: "phase3-shared-trace",
    subject: { kind: "task", id: "phase3-task" },
    expected: { status: "complete" },
    verification: "exact",
    createdAt: "2026-09-14T00:00:00.000Z",
    evidence: [{ eventId: "phase3-shared-source", origin: "direct" }],
  };
  runtime.recordExpectation(expectation);
  const [residual] = runtime.detectResiduals({
    outcomes: [
      {
        expectation,
        observation: {
          id: "phase3-shared-observation",
          traceId: "phase3-shared-trace",
          subject: { kind: "task", id: "phase3-task" },
          actual: { status: "failed" },
          observedAt: "2026-09-14T00:00:09.000Z",
          evidence: [{ eventId: "phase3-shared-source", origin: "direct" }],
        },
        field: {
          externalVerification: "strong",
          consequence: "low",
          reversibility: "easy",
          feedbackLatency: "short",
          actors: [{ type: "human", id: "phase3-user" }],
          explicitRules: [],
        },
        detectedAt: "2026-09-14T00:00:10.000Z",
      },
    ],
  });
  if (residual === undefined)
    throw new Error("phase3 worker found no residual");

  const residualResult = runtime.recordResiduals([residual])[0];
  const feedbackResult = store.append({
    schemaVersion: "1",
    eventVersion: "1",
    id: "phase3-shared-feedback",
    type: "task.rechecked",
    occurredAt: "2026-09-14T00:00:11.000Z",
    observedAt: "2026-09-14T00:00:12.000Z",
    recordedAt: "2026-09-14T00:00:12.000Z",
    actor: { type: "human", id: "phase3-user" },
    traceId: "phase3-shared-trace",
    source: { kind: "phase3-concurrency", ref: "shared-feedback" },
    payload: { status: "rechecked" },
    provenance: { origin: "direct", confidence: 1 },
  });
  const proposal = runtime.runReflection({
    residual,
    budget: {
      maxDepth: 2,
      maxHypotheses: 2,
      maxToolCalls: 1,
      maxElapsedMs: 1_000,
    },
    evidenceDelta: {
      fromSeq: residualResult.record.seq,
      toSeq: feedbackResult.record.seq,
      evidence: [{ eventId: feedbackResult.record.id, origin: "direct" }],
    },
  });
  const proposalResult = runtime.recordReflectionProposal(residual, proposal);
  stdout.write(
    `${JSON.stringify({
      workerId,
      residualInserted: residualResult?.inserted ?? false,
      proposalInserted: proposalResult.inserted,
      decision: proposal.decision,
    })}\n`,
  );
} finally {
  store.close();
}
