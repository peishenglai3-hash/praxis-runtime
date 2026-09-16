import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  permissionScopes,
  type EventEnvelope,
  type WriterContext,
} from "../../packages/contracts/src/index.js";
import type { ResidualDetectionBatch } from "../../packages/residual/src/index.js";
import { Phase3Runtime } from "../../packages/runtime/src/index.js";
import {
  createExpectationProjection,
  ProjectionEngine,
} from "../../packages/state/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

/**
 * The four async fixtures the Phase 3.5 Correction Pack requires in this layer.
 *
 * Section 3.7 is titled 「四个必须加入 tests/replay 的异步 fixture」 and Gate D
 * requires 「ASYNC-01~04 replay 全绿」. They previously existed only as inline
 * integration tests, which is not where a frozen replay fixture lives: the
 * whole point of this layer is that the input is a file a reviewer can read and
 * a diff can show. See BP-052.
 *
 * Each `*.replay.ndjson` is one scenario, one JSON step per line, in order:
 *
 *   append        a raw ledger event
 *   expectation   `Phase3Runtime.recordExpectationDefinition`
 *   verification  `Phase3Runtime.recordVerificationResult`
 *   detect        `Phase3Runtime.detectResiduals`; `record: true` also appends
 *                 the result as `residual.detected`
 *   expect        the golden block this scenario must reproduce
 *
 * The golden block is written by reading the fixture, not recorded from a run.
 * A change to the detectors or the expectation projection that alters it fails
 * here and has to be explained, which is the rule Bible section 14 states for
 * golden fixtures.
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const scenarios = [
  "async-01-legal-delay",
  "async-02-evaluateby-then-success",
  "async-03-stale-agent-cursor",
  "async-04-verifier-mismatch",
] as const;

type ScenarioName = (typeof scenarios)[number];

interface AppendStep {
  op: "append";
  event: EventEnvelope;
}

interface ExpectationStep {
  op: "expectation";
  definition: Record<string, unknown>;
}

interface VerificationStep {
  op: "verification";
  result: Record<string, unknown>;
}

interface DetectStep extends ResidualDetectionBatch {
  op: "detect";
  record?: boolean;
}

/** The golden shape. `residuals` is the normalised view written below. */
interface ExpectedResidual {
  id: string;
  kind: string;
  effect: string;
  confidence: number;
  magnitude?: number;
  observed: unknown;
}

interface ExpectStep {
  op: "expect";
  track: string;
  expectations: Record<string, string>;
  residuals: ExpectedResidual[];
  /** `residual.detected` events standing in the ledger at the end. */
  ledgerResiduals: number;
  ledgerResidualKinds: string[];
}

type ReplayStep =
  AppendStep | ExpectationStep | VerificationStep | DetectStep | ExpectStep;

const testWriter: WriterContext = {
  writerId: "test:async-replay",
  kind: "runtime",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
    directory = undefined;
  }
});

function openStore(): SqliteEventStore {
  directory = mkdtempSync(join(tmpdir(), "praxis-async-replay-"));
  return new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
}

function loadScenario(name: ScenarioName): ReplayStep[] {
  const text = readFileSync(
    fileURLToPath(new URL(`./${name}.replay.ndjson`, import.meta.url)),
    "utf8",
  );
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ReplayStep);
}

/**
 * The comparison view. A residual carries its whole field context and evidence
 * chain, which is input echoed back; what a golden fixture has to pin is the
 * detector's judgement — which residual, of which kind, with what effect, from
 * what observed numbers.
 */
function normalise(residual: {
  id: string;
  kind: string;
  effect: string;
  confidence: number;
  magnitude?: number;
  observed: unknown;
}): ExpectedResidual {
  return {
    id: residual.id,
    kind: residual.kind,
    effect: residual.effect,
    confidence: residual.confidence,
    ...(residual.magnitude === undefined
      ? {}
      : { magnitude: residual.magnitude }),
    observed: residual.observed,
  };
}

function statusesOf(store: SqliteEventStore): Record<string, string> {
  const engine = new ProjectionEngine(store, store);
  const projection = createExpectationProjection();
  const result = engine.rebuild(projection);
  if (result.status !== "caught_up") {
    throw new Error(
      `expectation replay did not catch up: ${JSON.stringify(result)}`,
    );
  }
  const state = store.getProjectionState("expectations_current")?.state as
    { expectations: Record<string, { status: string }> } | undefined;
  const statuses: Record<string, string> = {};
  for (const [id, record] of Object.entries(state?.expectations ?? {})) {
    statuses[id] = record.status;
  }
  return statuses;
}

interface ReplayedScenario {
  residuals: ExpectedResidual[];
  expectations: Record<string, string>;
  ledgerResiduals: number;
  ledgerResidualKinds: string[];
  steps: ReplayStep[];
}

function replay(name: ScenarioName): ReplayedScenario {
  const steps = loadScenario(name);
  const store = openStore();
  try {
    const runtime = new Phase3Runtime({
      events: store,
      projections: store,
      clock: { now: () => new Date("2026-09-15T00:00:00.000Z") },
      ids: { next: () => "async-replay-id" },
      actor: { type: "system", id: "async-replay" },
      writer: testWriter,
    });

    const residuals: ExpectedResidual[] = [];
    for (const step of steps) {
      if (step.op === "append") {
        store.append(step.event, testWriter);
      } else if (step.op === "expectation") {
        runtime.recordExpectationDefinition(step.definition as never);
      } else if (step.op === "verification") {
        runtime.recordVerificationResult(step.result as never);
      } else if (step.op === "detect") {
        const detected = runtime.detectResiduals({
          ...(step.outcomes === undefined ? {} : { outcomes: step.outcomes }),
          ...(step.timings === undefined ? {} : { timings: step.timings }),
          ...(step.rules === undefined ? {} : { rules: step.rules }),
        });
        if (step.record === true) runtime.recordResiduals(detected);
        residuals.push(...detected.map(normalise));
      }
    }

    const recorded = store.query({ type: "residual.detected" });
    return {
      residuals,
      expectations: statusesOf(store),
      ledgerResiduals: recorded.length,
      ledgerResidualKinds: [
        ...new Set(
          recorded.map((record) =>
            String((record.payload as Record<string, unknown>)["kind"] ?? ""),
          ),
        ),
      ].sort(),
      steps,
    };
  } finally {
    store.close();
  }
}

describe("canonical async replay — Correction Pack section 3.7", () => {
  for (const name of scenarios) {
    it(`${name} reproduces its golden block`, () => {
      const observed = replay(name);
      const golden = observed.steps.find(
        (step): step is ExpectStep => step.op === "expect",
      );
      expect(golden).toBeDefined();

      expect(observed.expectations).toEqual(golden!.expectations);
      expect(observed.residuals).toEqual(golden!.residuals);
      expect(observed.ledgerResiduals).toBe(golden!.ledgerResiduals);
      expect(observed.ledgerResidualKinds).toEqual(golden!.ledgerResidualKinds);
    });
  }

  it("ASYNC-01 — a delay inside the declared window produces no residual at all", () => {
    // Correction Pack section 3.7 gives ASYNC-01 the expected result
    // 「NO residual」. The scenario's cursor is genuinely behind the ledger, so
    // the only thing that can hold the residual back is the staleness window —
    // which is what "a legal delay" means. This assertion is why the fixture
    // exists: it was named `... without a residual` before without ever
    // checking that none was produced.
    const observed = replay("async-01-legal-delay");
    expect(observed.residuals).toEqual([]);
    expect(observed.ledgerResiduals).toBe(0);
    expect(observed.expectations["ASYNC-01"]).toBe("satisfied");
  });

  it("ASYNC-02 — the timing residual stays a historical fact after the later success", () => {
    // Correction Pack section 3.7 states the invariant in words:
    // 「E103 remains historical fact; E105 does not delete it.」 A satisfied
    // outcome arriving afterwards must not remove the residual that was
    // recorded while the expectation was still overdue.
    const observed = replay("async-02-evaluateby-then-success");
    expect(observed.expectations["ASYNC-02"]).toBe("satisfied");
    expect(observed.residuals).toHaveLength(1);
    expect(observed.residuals[0]?.kind).toBe("timing");
    expect(observed.ledgerResiduals).toBe(1);
    expect(observed.ledgerResidualKinds).toEqual(["timing"]);
  });

  it("ASYNC-03 — a stale agent cursor is a timing fact, not a verdict on the agent", () => {
    const observed = replay("async-03-stale-agent-cursor");
    expect(observed.residuals).toHaveLength(1);
    expect(observed.residuals[0]).toMatchObject({
      kind: "timing",
      effect: "unknown",
    });
    // 「不能简单判 agent "错误"」: the expectation is still awaiting evidence,
    // not violated.
    expect(observed.expectations["ASYNC-03"]).toBe("pending");
  });

  it("ASYNC-04 — an externally verified mismatch is an outcome residual at full confidence", () => {
    const observed = replay("async-04-verifier-mismatch");
    expect(observed.residuals).toHaveLength(1);
    expect(observed.residuals[0]).toMatchObject({
      kind: "outcome",
      effect: "unknown",
      confidence: 1,
    });
    expect(observed.expectations["ASYNC-04"]).toBe("violated");
  });

  it("replays every scenario twice to the same result", () => {
    // Determinism is the property that makes a replay fixture a fixture. A
    // detector that read a clock or a random source would fail here.
    for (const name of scenarios) {
      const first = replay(name);
      const second = replay(name);
      expect(second.residuals).toEqual(first.residuals);
      expect(second.expectations).toEqual(first.expectations);
    }
  });
});
