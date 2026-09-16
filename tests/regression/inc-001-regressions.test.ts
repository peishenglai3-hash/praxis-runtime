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
import type {
  FieldContext,
  Residual,
} from "../../packages/residual/src/index.js";
import {
  ReflectionController,
  type ReflectionBudget,
} from "../../packages/reflection/src/index.js";
import {
  ProjectionEngine,
  createCoreProjections,
} from "../../packages/state/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

/**
 * Regression — Bible section 14's `tests/regression` layer.
 *
 * This file holds only the named regressions that had **no** equivalent
 * elsewhere. The rest of INC-001 section 9.2's list is already covered, and
 * duplicating it would create two places to update rather than one:
 *
 *   duplicate-id                              tests/integration/sqlite-event-store.test.ts
 *   silent-overwrite                          tests/integration/sqlite-event-store.test.ts
 *   projection-drift                          tests/integration/phase35-runtime-maintenance.test.ts
 *   writer-acl / unauthorized-writer          tests/unit/authorization.test.ts
 *   context-exposure-self-reinforcement       tests/unit/assets.test.ts, phase2/phase4 integration
 *   expectation-before-evaluateBy             tests/integration/phase35-expectation.test.ts
 *   timing-residual-late-success              tests/integration/phase35-expectation.test.ts (ASYNC-02)
 *   outcome-residual-external-verifier        tests/unit/residual-detector.test.ts
 *   asset-provenance                          tests/integration/phase4-assets.test.ts
 *   privacy-purge-derived-invalidation        tests/integration/phase35-runtime-maintenance.test.ts
 *   backup-restore-integrity                  tests/integration/phase5-review-fixes.test.ts
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const testWriter: WriterContext = {
  writerId: "test:regression",
  kind: "runtime",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

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

const residual: Residual = {
  id: "residual:outcome:expectation-1:observation-1",
  kind: "outcome",
  baseline: {
    kind: "task",
    id: "expectation-1",
    value: { status: "expected" },
  },
  observed: {
    kind: "task",
    id: "observation-1",
    value: { status: "observed" },
  },
  field,
  magnitude: 1,
  confidence: 0.9,
  persistence: "repeated",
  effect: "unknown",
  evidence: [{ eventId: "residual-source-1", origin: "direct" }],
  detectedAt: "2026-09-16T00:00:00.000Z",
};

const noNewEvidence = { fromSeq: 2, toSeq: 2, evidence: [] };
const newEvidence = {
  fromSeq: 1,
  toSeq: 2,
  evidence: [{ eventId: "new-evidence-1", origin: "direct" as const }],
};

describe("reflection runaway — Bible issue 055", () => {
  const controller = new ReflectionController();

  it("stops immediately when the same residual has no new evidence", () => {
    const result = controller.reflect({
      residual,
      budget,
      evidenceDelta: noNewEvidence,
    });
    expect(result.decision).toBe("STOP");
    expect(result.reasons.join(" ")).toContain("cannot self-call");
  });

  it("cannot be driven in a loop: repeating a no-evidence round stays stopped", () => {
    // The runaway the Bible names is a loop, not a single call. A caller that
    // ignores the first STOP and asks again must keep getting STOP rather than
    // making progress it did not earn.
    const decisions: string[] = [];
    for (let round = 0; round < 25; round += 1) {
      const result = controller.reflect({
        residual,
        budget,
        evidenceDelta: noNewEvidence,
      });
      decisions.push(result.decision);
    }
    expect(new Set(decisions)).toEqual(new Set(["STOP"]));
  });

  it("stops when the budget is exhausted even though new evidence exists", () => {
    const exhausted = controller.reflect({
      residual,
      budget,
      evidenceDelta: newEvidence,
      usage: {
        depth: budget.maxDepth,
        hypotheses: 0,
        toolCalls: 0,
        elapsedMs: 0,
      },
    });
    expect(exhausted.decision).toBe("STOP");
  });

  it("terminates within the budget when driven as a real loop", () => {
    // A loop that feeds new evidence every round must still terminate, because
    // depth is consumed and the budget is finite. Fifty is far above the
    // budget; reaching it would mean the bound does not bind.
    let usage = { depth: 0, hypotheses: 0, toolCalls: 0, elapsedMs: 0 };
    let rounds = 0;
    for (let round = 0; round < 50; round += 1) {
      const result = controller.reflect({
        residual,
        budget,
        evidenceDelta: newEvidence,
        usage,
      });
      rounds += 1;
      if (result.decision === "STOP") break;
      usage = {
        depth: result.budgetUsed.depth,
        hypotheses: result.budgetUsed.hypotheses,
        toolCalls: result.budgetUsed.toolCalls,
        elapsedMs: result.budgetUsed.elapsedMs,
      };
    }
    expect(rounds).toBeLessThanOrEqual(budget.maxDepth + 1);
  });
});

describe("agent cursor integrity — Bible section 13.1's impossible state", () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
      directory = undefined;
    }
  });

  function openStore(): SqliteEventStore {
    directory = mkdtempSync(join(tmpdir(), "praxis-regression-"));
    return new SqliteEventStore({
      filename: join(directory, "events.db"),
      migrationsDir,
    });
  }

  function cursorEvent(lastSeq: number, revision: number): EventEnvelope {
    const now = "2026-09-16T00:00:00.000Z";
    return {
      schemaVersion: "1",
      eventVersion: "1",
      id: `cursor-${lastSeq}-${revision}`,
      type: "agent.cursor.updated",
      occurredAt: now,
      observedAt: now,
      recordedAt: now,
      actor: { type: "agent", id: "agent-1" },
      source: { kind: "regression", ref: "agent-cursor" },
      payload: { agentId: "agent-1", lastSeq, revision },
      evidence: [{ artifactHash: "a".repeat(64), origin: "declared" }],
      provenance: { origin: "declared", confidence: 1 },
    };
  }

  function agentsProjection() {
    const projection = createCoreProjections().find(
      (candidate) => candidate.name === "agents",
    );
    if (projection === undefined) throw new Error("agents projection missing");
    return projection;
  }

  it("refuses a cursor that points past the ledger head", () => {
    const store = openStore();
    try {
      // The event is at seq 1; a cursor claiming seq 999 cannot be true.
      store.append(cursorEvent(999, 1), testWriter);
      const result = new ProjectionEngine(store, store).rebuild(
        agentsProjection(),
      );
      expect(result.status).toBe("failed");
      expect(result.error).toContain("ahead of ledger");
      // The derived state must not have advanced on a refusal.
      expect(store.getProjectionState("agents")?.lastSeq ?? 0).toBe(0);
    } finally {
      store.close();
    }
  });

  it("refuses a cursor that moves backwards", () => {
    const store = openStore();
    try {
      store.append(cursorEvent(1, 2), testWriter);
      store.append(cursorEvent(1, 1), testWriter);
      const result = new ProjectionEngine(store, store).rebuild(
        agentsProjection(),
      );
      expect(result.status).toBe("failed");
      expect(result.error).toContain("regressed");
    } finally {
      store.close();
    }
  });

  it("accepts a cursor that only advances", () => {
    const store = openStore();
    try {
      store.append(cursorEvent(1, 1), testWriter);
      store.append(cursorEvent(2, 2), testWriter);
      const result = new ProjectionEngine(store, store).rebuild(
        agentsProjection(),
      );
      expect(result.status).toBe("caught_up");
      expect(store.getProjectionState("agents")?.state).toEqual({
        cursors: {
          "agent-1": {
            agentId: "agent-1",
            lastSeq: 2,
            revision: 2,
            updatedAt: "2026-09-16T00:00:00.000Z",
          },
        },
      });
    } finally {
      store.close();
    }
  });
});
