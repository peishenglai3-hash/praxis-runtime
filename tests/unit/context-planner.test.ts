import { describe, expect, it } from "vitest";

import { parseEventEnvelope } from "../../packages/contracts/src/index.js";
import {
  CharacterTokenEstimator,
  ContextPlanner,
  DEFAULT_RANKING_CONFIG,
  createContextExposureEvent,
} from "../../packages/context/src/index.js";
import type {
  ContextPlannerInput,
  ContextSource,
} from "../../packages/context/src/index.js";

const candidates: ContextSource[] = [
  {
    id: "source-a",
    sourceEventId: "event-a",
    seq: 1,
    text: "task evidence",
    taskRelevance: 1,
    projectRelevance: 0.8,
    recency: 0.5,
    explicitPriority: 0.7,
    activeRuleRelevance: 0.4,
    sourceOrigin: "direct",
  },
  {
    id: "source-b",
    sourceEventId: "event-b",
    seq: 2,
    text: "project constraint",
    taskRelevance: 0.5,
    projectRelevance: 1,
    recency: 0.8,
    explicitPriority: 0.6,
    activeRuleRelevance: 0.9,
    sourceOrigin: "declared",
  },
  {
    id: "source-c",
    sourceEventId: "event-c",
    seq: 3,
    text: "older note",
    taskRelevance: 0.2,
    projectRelevance: 0.2,
    recency: 0.1,
    explicitPriority: 0.1,
    activeRuleRelevance: 0.1,
    sourceOrigin: "inferred",
  },
];

const baseInput: Omit<ContextPlannerInput, "mode"> = {
  candidates,
  budget: { maxItems: 2, maxTokens: 100 },
  stateSeq: 3,
  generatedAt: "2026-09-14T00:00:00.000Z",
  planId: "plan-1",
  taskId: "task-1",
  projectId: "project-1",
};

describe("ContextPlanner", () => {
  it("ranks deterministically and returns a reason for every selected item", () => {
    const planner = new ContextPlanner(new CharacterTokenEstimator());
    const plan = planner.plan({ ...baseInput, mode: "reindex" });

    expect(plan.selected.map((item) => item.sourceId)).toEqual([
      "source-a",
      "source-b",
    ]);
    expect(plan.reasons).toHaveLength(plan.selected.length);
    expect(plan.exposureProposals).toHaveLength(plan.selected.length);
    expect(plan.reasons[0]?.explanation).toContain("ranking=1");
    expect(plan.reasons[0]?.score).toBeCloseTo(
      0.35 * 1 + 0.25 * 0.8 + 0.15 * 0.5 + 0.15 * 0.7 + 0.1 * 0.4,
    );
  });

  it("implements REUSE delta and invalidation without importing residual logic", () => {
    const planner = new ContextPlanner();
    const previous = planner.plan({
      ...baseInput,
      mode: "refresh",
      refreshCandidates: candidates,
    });
    const delta: ContextSource = {
      ...candidates[2]!,
      id: "source-delta",
      sourceEventId: "event-delta",
      seq: 4,
      text: "new delta",
      taskRelevance: 1,
      projectRelevance: 1,
      recency: 1,
      explicitPriority: 1,
      activeRuleRelevance: 1,
    };
    const reuse = planner.plan({
      ...baseInput,
      mode: "reuse",
      previousPlan: previous,
      delta: [delta],
      invalidatedSourceIds: ["source-a"],
      stateSeq: 4,
    });

    expect(reuse.candidateSources.map((source) => source.id)).toEqual([
      "source-b",
      "source-delta",
    ]);
    expect(reuse.selected[0]?.sourceId).toBe("source-delta");
    expect(
      reuse.candidateSources.some((source) => source.id === "source-a"),
    ).toBe(false);
  });

  it("returns exposure events as proposals without writing through the planner", () => {
    const planner = new ContextPlanner();
    const plan = planner.plan({ ...baseInput, mode: "reindex" });
    const proposal = plan.exposureProposals[0];
    expect(proposal).toBeDefined();
    const event = createContextExposureEvent({
      id: "exposure-1",
      occurredAt: "2026-09-14T00:00:00.000Z",
      observedAt: "2026-09-14T00:00:01.000Z",
      recordedAt: "2026-09-14T00:00:02.000Z",
      actor: { type: "system", id: "context-runtime" },
      proposal: proposal!,
      ...(plan.planId === undefined ? {} : { planId: plan.planId }),
      sessionId: "session-1",
      traceId: "trace-1",
    });

    expect(parseEventEnvelope(event).type).toBe("context.item.exposed");
    expect(event.provenance).toEqual({ origin: "inferred", confidence: 1 });
    expect(event.payload).toMatchObject({
      materialClassification: "inferred",
      planId: "plan-1",
      rankingVersion: "1",
    });
    expect(event.links).toEqual({
      derivedFrom: ["event-a"],
      respondsTo: ["context-plan:plan-1"],
    });
  });

  it("rejects non-normalized ranking configuration instead of silently compensating", () => {
    expect(
      () =>
        new ContextPlanner(new CharacterTokenEstimator(), {
          ...DEFAULT_RANKING_CONFIG,
          weights: {
            ...DEFAULT_RANKING_CONFIG.weights,
            taskRelevance: 2,
          },
        }),
    ).toThrowError(
      "ranking weights must be finite, non-negative, and sum to 1",
    );
  });

  it("does not silently replace a missing REUSE working set with all candidates", () => {
    const planner = new ContextPlanner();
    expect(() =>
      planner.plan({
        ...baseInput,
        mode: "reuse",
      }),
    ).toThrowError("REUSE requires a previousPlan");
    const previous = planner.plan({
      ...baseInput,
      mode: "refresh",
      candidates: [],
      refreshCandidates: [],
    });
    const reuse = planner.plan({
      ...baseInput,
      mode: "reuse",
      previousPlan: previous,
      candidates,
      delta: [],
    });
    expect(reuse.candidateSources).toEqual([]);
    expect(reuse.selected).toEqual([]);
  });

  it("does not silently replace missing REFRESH candidates with ordinary candidates", () => {
    const planner = new ContextPlanner();
    expect(() =>
      planner.plan({
        ...baseInput,
        mode: "refresh",
      }),
    ).toThrowError("REFRESH requires refreshCandidates");
  });
});
