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
import {
  contextPlanEventId,
  type ContextSource,
} from "../../packages/context/src/index.js";
import { Phase2Runtime } from "../../packages/runtime/src/index.js";
import {
  ProjectionEngine,
  createAgentProjection,
  createAssetProjection,
  createProjectProjection,
  createRuleProjection,
} from "../../packages/state/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const testWriter: WriterContext = {
  writerId: "test:phase2",
  kind: "runtime",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

function appendEvent(store: SqliteEventStore, event: EventEnvelope) {
  return store.append(event, testWriter);
}

const makeEvent = (overrides: Partial<EventEnvelope> = {}): EventEnvelope => ({
  schemaVersion: "1",
  eventVersion: "1",
  id: "phase2-event-1",
  type: "interaction.recorded",
  occurredAt: "2026-09-14T00:00:00.000Z",
  observedAt: "2026-09-14T00:00:01.000Z",
  recordedAt: "2026-09-14T00:00:02.000Z",
  actor: { type: "human", id: "user-1" },
  source: { kind: "phase2-integration", provider: "vitest" },
  payload: { message: "event" },
  provenance: { origin: "direct", confidence: 1 },
  ...overrides,
});

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

function openPhase2Store(): SqliteEventStore {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase2-"));
  store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  return store;
}

describe("Phase 2 projection persistence", () => {
  it("catches up, exposes lag, rebuilds after projection data loss, and snapshots", () => {
    const currentStore = openPhase2Store();
    const engine = new ProjectionEngine(currentStore, currentStore, 2);
    const project = createProjectProjection();

    for (const event of [
      makeEvent({ id: "phase2-event-1" }),
      makeEvent({
        id: "phase2-event-2",
        type: "rule.registered",
        payload: { id: "rule-1" },
      }),
      makeEvent({
        id: "phase2-event-3",
        type: "asset.candidate",
        payload: { id: "asset-1", revision: 1 },
      }),
    ]) {
      appendEvent(currentStore, event);
    }

    const firstCatchUp = engine.catchUp(project);
    expect(firstCatchUp).toMatchObject({
      status: "caught_up",
      fromSeq: 0,
      lastSeq: 3,
      applied: 3,
    });
    expect(currentStore.getProjectionState("project")).toMatchObject({
      projectionVersion: 1,
      lastSeq: 3,
      state: { eventCount: 3, lastSeq: 3, lastEventType: "asset.candidate" },
    });

    appendEvent(currentStore, makeEvent({ id: "phase2-event-4" }));
    expect(currentStore.getProjectionState("project")?.lastSeq).toBe(3);
    expect(engine.catchUp(project)).toMatchObject({
      status: "caught_up",
      fromSeq: 3,
      lastSeq: 4,
      applied: 1,
    });

    const snapshot = engine.createSnapshot(project);
    expect(snapshot).toMatchObject({
      projectionName: "project",
      projectionVersion: 1,
      cursorSeq: 4,
    });
    expect(engine.loadSnapshot(project)).toMatchObject({ cursorSeq: 4 });
    expect(engine.loadSnapshot({ ...project, version: 2 })).toBeNull();

    currentStore.clearProjectionData("project");
    const rebuilt = engine.rebuild(project);
    expect(rebuilt).toMatchObject({
      status: "caught_up",
      fromSeq: 0,
      lastSeq: 4,
      applied: 4,
    });
    expect(currentStore.getProjectionState("project")?.state).toEqual({
      eventCount: 4,
      lastSeq: 4,
      lastEventType: "interaction.recorded",
    });
  });

  it("keeps the previous projection when a versioned rebuild fails", () => {
    const currentStore = openPhase2Store();
    const engine = new ProjectionEngine(currentStore, currentStore);
    const stable = createProjectProjection();
    appendEvent(currentStore, makeEvent({ id: "stable-event-1" }));
    expect(engine.rebuild(stable).status).toBe("caught_up");
    const before = currentStore.getProjectionState("project");

    const failing = {
      ...stable,
      version: 2,
      apply: (
        state: typeof stable extends { initial: () => infer T } ? T : never,
        event: never,
      ) => {
        void state;
        void event;
        throw new Error("intentional projection failure");
      },
    };
    const result = engine.catchUp(failing);
    expect(result.status).toBe("failed");
    expect(currentStore.getProjectionState("project")).toEqual(before);
  });

  it("replays core projections without making derived state an event fact", () => {
    const currentStore = openPhase2Store();
    const engine = new ProjectionEngine(currentStore, currentStore);
    appendEvent(
      currentStore,
      makeEvent({
        id: "rule-event",
        type: "rule.registered",
        payload: { id: "rule-1" },
      }),
    );
    appendEvent(
      currentStore,
      makeEvent({
        id: "asset-event",
        type: "asset.candidate",
        payload: { id: "asset-1", revision: 2 },
      }),
    );
    appendEvent(
      currentStore,
      makeEvent({
        id: "agent-event",
        type: "agent.cursor.updated",
        payload: { agentId: "agent-1", lastSeq: 2, revision: 1 },
      }),
    );

    expect(engine.rebuild(createRuleProjection()).status).toBe("caught_up");
    expect(engine.rebuild(createAssetProjection()).status).toBe("caught_up");
    expect(engine.rebuild(createAgentProjection()).status).toBe("caught_up");
    expect(currentStore.getProjectionState("rules")?.state).toEqual({
      rules: {
        "rule-1": { id: "rule-1", status: "registered", lastSeq: 1 },
      },
    });
    expect(currentStore.getProjectionState("assets")?.state).toEqual({
      assets: {
        "asset-1": {
          id: "asset-1",
          status: "candidate",
          revision: 2,
          lastSeq: 2,
        },
      },
    });
    expect(currentStore.getProjectionState("agents")?.state).toEqual({
      cursors: {
        "agent-1": {
          agentId: "agent-1",
          lastSeq: 2,
          revision: 1,
          updatedAt: "2026-09-14T00:00:02.000Z",
        },
      },
    });
  });

  it("rejects stale projection writes, future snapshots, and future agent cursors", () => {
    const currentStore = openPhase2Store();
    const engine = new ProjectionEngine(currentStore, currentStore);
    appendEvent(currentStore, makeEvent({ id: "cursor-event-1" }));
    currentStore.saveProjectionState(
      {
        projectionName: "project",
        projectionVersion: 1,
        lastSeq: 1,
        state: { eventCount: 1, lastSeq: 1 },
        updatedAt: 1,
      },
      0,
    );

    expect(() =>
      currentStore.saveProjectionState(
        {
          projectionName: "project",
          projectionVersion: 1,
          lastSeq: 0,
          state: { eventCount: 0, lastSeq: 0 },
          updatedAt: 0,
        },
        0,
      ),
    ).toThrowError("compare-and-set");
    expect(currentStore.getProjectionState("project")?.lastSeq).toBe(1);

    expect(() =>
      currentStore.saveSnapshot({
        id: "future-snapshot",
        projectionName: "project",
        projectionVersion: 1,
        cursorSeq: 999,
        state: { eventCount: 999, lastSeq: 999 },
        createdAt: 999,
      }),
    ).toThrowError("ahead of the event ledger");

    appendEvent(
      currentStore,
      makeEvent({
        id: "future-agent-cursor",
        type: "agent.cursor.updated",
        payload: { agentId: "agent-1", lastSeq: 999, revision: 1 },
      }),
    );
    const result = engine.rebuild(createAgentProjection());
    expect(result.status).toBe("failed");
    expect(currentStore.getProjectionState("agents")).toBeNull();
  });

  it("keeps plan generation pure and event recording at the runtime boundary", () => {
    const currentStore = openPhase2Store();
    let nextId = 0;
    const runtime = new Phase2Runtime({
      events: currentStore,
      projections: currentStore,
      clock: { now: () => new Date("2026-09-14T00:00:00.000Z") },
      ids: { next: () => `runtime-event-${++nextId}` },
      actor: { type: "system", id: "runtime-test" },
      writer: testWriter,
    });
    const source: ContextSource = {
      id: "runtime-source",
      sourceEventId: "phase2-source-event",
      seq: 1,
      text: "runtime context source",
      taskRelevance: 1,
      projectRelevance: 1,
      recency: 1,
      explicitPriority: 0.5,
      activeRuleRelevance: 0.5,
      sourceOrigin: "direct",
    };
    appendEvent(currentStore, makeEvent({ id: "phase2-source-event" }));
    const plan = runtime.buildContextPlan({
      mode: "refresh",
      candidates: [source],
      refreshCandidates: [source],
      budget: { maxItems: 1, maxTokens: 100 },
      stateSeq: 1,
      planId: "runtime-plan",
    });
    expect(currentStore.getLastSeq()).toBe(1);
    const planEvent = runtime.recordContextPlan(plan);
    const retriedPlanEvent = runtime.recordContextPlan(plan);
    const exposureTiming = {
      occurredAt: "2026-09-14T00:00:10.000Z",
      observedAt: "2026-09-14T00:00:11.000Z",
      recordedAt: "2026-09-14T00:00:12.000Z",
    };
    const exposureEvent = runtime.recordContextExposure(
      plan.exposureProposals[0]!,
      plan.planId,
      exposureTiming,
    );
    const retriedExposureEvent = runtime.recordContextExposure(
      plan.exposureProposals[0]!,
      undefined,
      exposureTiming,
    );

    expect(planEvent.inserted).toBe(true);
    expect(retriedPlanEvent.inserted).toBe(false);
    expect(exposureEvent.inserted).toBe(true);
    expect(retriedExposureEvent.inserted).toBe(false);
    expect(() => runtime.appendEvent(planEvent.record)).toThrowError(
      "context events must be recorded through the runtime context use-cases",
    );
    expect(currentStore.getSince(1).map((event) => event.type)).toEqual([
      "context.plan.created",
      "context.item.exposed",
    ]);
    expect(currentStore.getById(planEvent.record.id)?.payload).toMatchObject({
      classification: "candidate",
      rankingVersion: "1",
      planId: "runtime-plan",
      reasons: plan.reasons,
      exposureProposals: plan.exposureProposals,
    });
    expect(planEvent.record.provenance.origin).toBe("inferred");
    expect(exposureEvent.record.provenance.origin).toBe("inferred");
    expect(currentStore.getById(exposureEvent.record.id)?.links).toEqual({
      derivedFrom: ["phase2-source-event"],
      respondsTo: ["context-plan:runtime-plan"],
    });
    expect(currentStore.getById(exposureEvent.record.id)?.occurredAt).toBe(
      "2026-09-14T00:00:10.000Z",
    );
    expect(currentStore.getById(exposureEvent.record.id)?.observedAt).toBe(
      "2026-09-14T00:00:11.000Z",
    );
    expect(currentStore.getById(exposureEvent.record.id)?.recordedAt).toBe(
      "2026-09-14T00:00:12.000Z",
    );

    const secondSourceEvent = appendEvent(
      currentStore,
      makeEvent({ id: "phase2-source-event-2" }),
    );
    const secondSource: ContextSource = {
      ...source,
      id: "runtime-source-2",
      sourceEventId: secondSourceEvent.record.id,
      seq: secondSourceEvent.record.seq,
    };
    const defaultTimingPlan = runtime.buildContextPlan({
      mode: "refresh",
      candidates: [secondSource],
      refreshCandidates: [secondSource],
      budget: { maxItems: 1, maxTokens: 100 },
      stateSeq: secondSource.seq,
      planId: "runtime-default-timing-plan",
    });
    runtime.recordContextPlan(defaultTimingPlan);
    const defaultExposure = runtime.recordContextExposure(
      defaultTimingPlan.exposureProposals[0]!,
      defaultTimingPlan.planId,
    );
    const retriedDefaultExposure = runtime.recordContextExposure(
      defaultTimingPlan.exposureProposals[0]!,
      defaultTimingPlan.planId,
    );
    expect(defaultExposure.inserted).toBe(true);
    expect(retriedDefaultExposure.inserted).toBe(false);
    expect(defaultExposure.record.occurredAt).toBe(
      defaultTimingPlan.generatedAt,
    );

    const forgedProposal = {
      ...plan.exposureProposals[0]!,
      reason: "forged proposal",
    };
    expect(() =>
      runtime.recordContextExposure(forgedProposal, plan.planId),
    ).toThrowError("not a member of the recorded plan");

    expect(() =>
      runtime.buildContextPlan({
        mode: "refresh",
        candidates: [source],
        refreshCandidates: [source],
        budget: { maxItems: 1, maxTokens: 100 },
        stateSeq: 999,
        planId: "future-plan",
      }),
    ).toThrowError("ahead of the event ledger");

    expect(() =>
      runtime.recordContextPlan({
        ...plan,
        exposureProposals: [
          plan.exposureProposals[0]!,
          plan.exposureProposals[0]!,
        ],
      }),
    ).toThrowError("do not cover the selection");

    expect(() =>
      runtime.recordContextExposure(plan.exposureProposals[0]!, plan.planId, {
        occurredAt: "2026-09-14T00:00:10.000Z",
        observedAt: "2026-09-14T00:00:09.000Z",
        recordedAt: "2026-09-14T00:00:12.000Z",
      }),
    ).toThrowError("timestamps must be ordered");

    const forgedPlan: EventEnvelope = makeEvent({
      id: contextPlanEventId("low-level-forged-plan"),
      type: "context.plan.created",
      operationId: "low-level-forged-plan",
      payload: {
        classification: "candidate",
        planId: "low-level-forged-plan",
        stateSeq: plan.stateSeq,
        candidateSources: [
          {
            ...plan.candidateSources[0]!,
            seq: 999,
          },
        ],
      },
      provenance: { origin: "inferred", confidence: 1 },
    });
    expect(() => appendEvent(currentStore, forgedPlan)).toThrowError(
      "context plan failed ledger integrity checks",
    );

    const forgedExposure: EventEnvelope = makeEvent({
      id: "low-level-forged-exposure",
      type: "context.item.exposed",
      operationId: "context-exposure:runtime-plan:forged",
      source: { kind: "context-planner", ref: "runtime-source" },
      payload: {
        materialClassification: "inferred",
        rankingVersion: plan.rankingVersion,
        reason: "forged proposal",
        itemId: plan.exposureProposals[0]!.itemId,
        sourceId: plan.exposureProposals[0]!.sourceId,
        sourceEventId: plan.exposureProposals[0]!.sourceEventId,
        stateSeq: plan.stateSeq,
        planId: plan.planId,
      },
      evidence: [
        {
          eventId: plan.exposureProposals[0]!.sourceEventId,
          origin: "direct",
          exposureInfluenced: true,
        },
        {
          eventId: contextPlanEventId(plan.planId),
          origin: "inferred",
          exposureInfluenced: true,
        },
      ],
      links: {
        derivedFrom: [plan.exposureProposals[0]!.sourceEventId],
        respondsTo: [contextPlanEventId(plan.planId)],
      },
      provenance: { origin: "inferred", confidence: 1 },
    });
    expect(() => appendEvent(currentStore, forgedExposure)).toThrowError(
      "context exposure failed ledger integrity checks",
    );

    const futureEmptyPlan: EventEnvelope = makeEvent({
      id: contextPlanEventId("future-empty-plan"),
      type: "context.plan.created",
      operationId: "future-empty-plan",
      payload: {
        classification: "candidate",
        planId: "future-empty-plan",
        stateSeq: 999,
        candidateSources: [],
        selected: [],
        reasons: [],
        exposureProposals: [],
      },
      links: { derivedFrom: [] },
      provenance: { origin: "inferred", confidence: 1 },
    });
    expect(() => appendEvent(currentStore, futureEmptyPlan)).toThrowError(
      "context plan failed ledger integrity checks",
    );
  });
});
