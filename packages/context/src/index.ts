export {};
import type {
  ActorRef,
  EventEnvelope,
  EvidenceOrigin,
  TokenBudgetEstimator,
} from "@praxis/contracts";

export type ContextMode = "reuse" | "reindex" | "refresh";

export interface ContextSource {
  id: string;
  sourceEventId: string;
  seq: number;
  text: string;
  taskRelevance: number;
  projectRelevance: number;
  recency: number;
  explicitPriority: number;
  activeRuleRelevance: number;
  sourceOrigin: EvidenceOrigin;
}

export interface ContextBudget {
  maxItems: number;
  maxTokens: number;
  modelHint?: string;
}

export interface ContextItem {
  id: string;
  sourceId: string;
  sourceEventId: string;
  text: string;
  score: number;
  tokenEstimate: number;
  sourceOrigin: EvidenceOrigin;
}

export interface ContextReason {
  itemId: string;
  score: number;
  factors: {
    taskRelevance: number;
    projectRelevance: number;
    recency: number;
    explicitPriority: number;
    activeRuleRelevance: number;
  };
  explanation: string;
}

export interface ContextExposureProposal {
  planId: string;
  rankingVersion: string;
  generatedAt: string;
  itemId: string;
  sourceId: string;
  sourceEventId: string;
  sourceOrigin: EvidenceOrigin;
  stateSeq: number;
  reason: string;
}

export interface ContextPlan {
  classification: "candidate";
  mode: ContextMode;
  rankingVersion: string;
  planId: string;
  taskId?: string;
  projectId?: string;
  candidateSources: ContextSource[];
  budget: ContextBudget;
  selected: ContextItem[];
  reasons: ContextReason[];
  exposureProposals: ContextExposureProposal[];
  stateSeq: number;
  generatedAt: string;
}

export interface RankingWeights {
  taskRelevance: number;
  projectRelevance: number;
  recency: number;
  explicitPriority: number;
  activeRuleRelevance: number;
}

export interface RankingConfig {
  version: string;
  weights: RankingWeights;
}

export interface ContextPlannerInput {
  mode: ContextMode;
  candidates: ContextSource[];
  budget: ContextBudget;
  stateSeq: number;
  generatedAt: string;
  planId: string;
  taskId?: string;
  projectId?: string;
  previousPlan?: ContextPlan;
  delta?: ContextSource[];
  refreshCandidates?: ContextSource[];
  invalidatedSourceIds?: string[];
}

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  version: "1",
  weights: {
    taskRelevance: 0.35,
    projectRelevance: 0.25,
    recency: 0.15,
    explicitPriority: 0.15,
    activeRuleRelevance: 0.1,
  },
};

export class CharacterTokenEstimator implements TokenBudgetEstimator {
  estimate(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}

export class ContextPlanner {
  private readonly config: RankingConfig;

  constructor(
    private readonly estimator: TokenBudgetEstimator = new CharacterTokenEstimator(),
    config: RankingConfig = DEFAULT_RANKING_CONFIG,
  ) {
    validateRankingConfig(config);
    this.config = {
      version: config.version,
      weights: { ...config.weights },
    };
  }

  plan(input: ContextPlannerInput): ContextPlan {
    validateInput(input);
    const candidates = this.candidateSet(input);
    const scored = candidates
      .map((source) => ({
        source,
        score: scoreSource(source, this.config.weights),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (right.source.seq !== left.source.seq) {
          return right.source.seq - left.source.seq;
        }
        return left.source.id.localeCompare(right.source.id);
      });

    const selected: ContextItem[] = [];
    const reasons: ContextReason[] = [];
    let usedTokens = 0;
    for (const entry of scored) {
      if (selected.length >= input.budget.maxItems) break;
      const tokenEstimate = this.estimator.estimate(
        entry.source.text,
        input.budget.modelHint,
      );
      if (!Number.isSafeInteger(tokenEstimate) || tokenEstimate < 1) {
        throw new Error(
          `token estimator returned an invalid value for ${entry.source.id}`,
        );
      }
      if (usedTokens + tokenEstimate > input.budget.maxTokens) continue;
      const item: ContextItem = {
        id: `context-item:${entry.source.id}`,
        sourceId: entry.source.id,
        sourceEventId: entry.source.sourceEventId,
        text: entry.source.text,
        score: entry.score,
        tokenEstimate,
        sourceOrigin: entry.source.sourceOrigin,
      };
      selected.push(item);
      usedTokens += tokenEstimate;
      reasons.push({
        itemId: item.id,
        score: entry.score,
        factors: {
          taskRelevance: entry.source.taskRelevance,
          projectRelevance: entry.source.projectRelevance,
          recency: entry.source.recency,
          explicitPriority: entry.source.explicitPriority,
          activeRuleRelevance: entry.source.activeRuleRelevance,
        },
        explanation: explainScore(entry.source, entry.score, this.config),
      });
    }

    const exposureProposals: ContextExposureProposal[] = selected.map(
      (item) => ({
        planId: input.planId,
        rankingVersion: this.config.version,
        generatedAt: input.generatedAt,
        itemId: item.id,
        sourceId: item.sourceId,
        sourceEventId: item.sourceEventId,
        sourceOrigin: item.sourceOrigin,
        stateSeq: input.stateSeq,
        reason:
          reasons.find((reason) => reason.itemId === item.id)?.explanation ??
          "selected",
      }),
    );

    return {
      classification: "candidate",
      mode: input.mode,
      rankingVersion: this.config.version,
      planId: input.planId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      candidateSources: candidates,
      budget: input.budget,
      selected,
      reasons,
      exposureProposals,
      stateSeq: input.stateSeq,
      generatedAt: input.generatedAt,
    };
  }

  private candidateSet(input: ContextPlannerInput): ContextSource[] {
    const invalidated = new Set(input.invalidatedSourceIds ?? []);
    const byId = new Map<string, ContextSource>();
    const add = (source: ContextSource): void => {
      if (invalidated.has(source.id)) return;
      if (!byId.has(source.id)) byId.set(source.id, source);
    };

    if (input.mode === "reuse") {
      if (input.previousPlan === undefined) {
        throw new Error("REUSE requires a previousPlan");
      }
      const workingSet = new Set(
        input.previousPlan.selected.map((item) => item.sourceId),
      );
      for (const source of input.previousPlan.candidateSources) {
        if (workingSet.has(source.id)) add(source);
      }
      for (const source of input.delta ?? []) add(source);
    } else if (input.mode === "refresh") {
      if (input.refreshCandidates === undefined) {
        throw new Error("REFRESH requires refreshCandidates");
      }
      for (const source of input.refreshCandidates) add(source);
    } else {
      for (const source of input.candidates) add(source);
    }

    return [...byId.values()].sort((left, right) => {
      if (left.seq !== right.seq) return left.seq - right.seq;
      return left.id.localeCompare(right.id);
    });
  }
}

export function createContextExposureEvent(input: {
  id: string;
  occurredAt: string;
  observedAt: string;
  recordedAt: string;
  actor: ActorRef;
  proposal: ContextExposureProposal;
  planId?: string;
  sessionId?: string;
  traceId?: string;
}): EventEnvelope {
  const planId = input.planId ?? input.proposal.planId;
  if (planId !== input.proposal.planId) {
    throw new Error("context exposure planId does not match its proposal");
  }
  const planEventId = contextPlanEventId(planId);
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id: input.id,
    type: "context.item.exposed",
    occurredAt: input.occurredAt,
    observedAt: input.observedAt,
    recordedAt: input.recordedAt,
    actor: input.actor,
    operationId: contextExposureOperationId(planId, input.proposal.itemId),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    source: { kind: "context-planner", ref: input.proposal.sourceId },
    payload: {
      materialClassification: "inferred",
      rankingVersion: input.proposal.rankingVersion,
      generatedAt: input.proposal.generatedAt,
      reason: input.proposal.reason,
      itemId: input.proposal.itemId,
      sourceId: input.proposal.sourceId,
      sourceEventId: input.proposal.sourceEventId,
      sourceOrigin: input.proposal.sourceOrigin,
      stateSeq: input.proposal.stateSeq,
      planId,
    },
    evidence: [
      {
        eventId: input.proposal.sourceEventId,
        origin: input.proposal.sourceOrigin,
        exposureInfluenced: true,
      },
      {
        eventId: planEventId,
        origin: "inferred",
        exposureInfluenced: true,
      },
    ],
    links: {
      derivedFrom: [input.proposal.sourceEventId],
      respondsTo: [planEventId],
    },
    provenance: { origin: "inferred", confidence: 1 },
  };
}

export function contextPlanEventId(planId: string): string {
  return "context-plan:" + encodeURIComponent(planId);
}

export function contextExposureOperationId(
  planId: string,
  itemId: string,
): string {
  return (
    "context-exposure:" +
    encodeURIComponent(planId) +
    ":" +
    encodeURIComponent(itemId)
  );
}

function scoreSource(source: ContextSource, weights: RankingWeights): number {
  return (
    weights.taskRelevance * source.taskRelevance +
    weights.projectRelevance * source.projectRelevance +
    weights.recency * source.recency +
    weights.explicitPriority * source.explicitPriority +
    weights.activeRuleRelevance * source.activeRuleRelevance
  );
}

function explainScore(
  source: ContextSource,
  score: number,
  config: RankingConfig,
): string {
  return `selected score=${score.toFixed(6)} using ranking=${config.version}; task=${source.taskRelevance}, project=${source.projectRelevance}, recency=${source.recency}, explicit=${source.explicitPriority}, activeRule=${source.activeRuleRelevance}`;
}

function validateRankingConfig(config: RankingConfig): void {
  if (config.version.length < 1)
    throw new Error("ranking config version is required");
  const weights = Object.values(config.weights);
  if (
    weights.some((weight) => !Number.isFinite(weight) || weight < 0) ||
    Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-9
  ) {
    throw new Error(
      "ranking weights must be finite, non-negative, and sum to 1",
    );
  }
}

function validateInput(input: ContextPlannerInput): void {
  if (input.planId.length < 1) {
    throw new Error("planId must not be empty");
  }
  const generatedAtMilliseconds = Date.parse(input.generatedAt);
  if (
    !Number.isSafeInteger(generatedAtMilliseconds) ||
    new Date(generatedAtMilliseconds).toISOString() !== input.generatedAt
  ) {
    throw new Error("generatedAt must be a canonical UTC timestamp");
  }
  if (!Number.isSafeInteger(input.stateSeq) || input.stateSeq < 0) {
    throw new Error("stateSeq must be a non-negative safe integer");
  }
  if (
    !Number.isSafeInteger(input.budget.maxItems) ||
    input.budget.maxItems < 1
  ) {
    throw new Error("budget.maxItems must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(input.budget.maxTokens) ||
    input.budget.maxTokens < 1
  ) {
    throw new Error("budget.maxTokens must be a positive safe integer");
  }
  for (const source of input.candidates) validateSource(source);
  for (const source of input.delta ?? []) validateSource(source);
  for (const source of input.refreshCandidates ?? []) validateSource(source);
}

function validateSource(source: ContextSource): void {
  if (
    source.id.length < 1 ||
    source.sourceEventId.length < 1 ||
    source.text.length < 1 ||
    !Number.isSafeInteger(source.seq) ||
    source.seq < 1
  ) {
    throw new Error(`context source ${source.id || "<empty>"} is invalid`);
  }
  for (const factor of [
    source.taskRelevance,
    source.projectRelevance,
    source.recency,
    source.explicitPriority,
    source.activeRuleRelevance,
  ]) {
    if (!Number.isFinite(factor) || factor < 0 || factor > 1) {
      throw new Error(
        `context source ${source.id} has an invalid ranking factor`,
      );
    }
  }
  if (source.sourceOrigin === undefined) {
    throw new Error("context source is missing sourceOrigin");
  }
}
