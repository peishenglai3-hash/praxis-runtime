export {};
import type {
  ActorRef,
  Clock,
  EventAppendResult,
  EventEnvelope,
  EventRecord,
  EventReader,
  EventWriter,
  EvidenceOrigin,
  EvidenceRef,
  IdGenerator,
  JsonObject,
  JsonValue,
  ProjectionPersistence,
} from "@praxis/contracts";
import { stableStringify } from "@praxis/contracts";
import {
  ContextPlanner,
  contextExposureOperationId,
  contextPlanEventId,
  createContextExposureEvent,
} from "@praxis/context";
import type {
  ContextPlan,
  ContextPlannerInput,
  ContextExposureProposal,
} from "@praxis/context";
import type { ReflectionInput, ReflectionResult } from "@praxis/reflection";
import { ReflectionController } from "@praxis/reflection";
import type { Residual, ResidualDetectionBatch } from "@praxis/residual";
import { ResidualDetector } from "@praxis/residual";
import { ProjectionEngine, createCoreProjections } from "@praxis/state";
import type { CatchUpResult, Projection } from "@praxis/state";

export interface ContextExposureTiming {
  occurredAt?: string;
  observedAt?: string;
  recordedAt?: string;
}

export interface Phase2RuntimePorts {
  events: EventReader & EventWriter;
  projections: ProjectionPersistence;
  clock: Clock;
  ids: IdGenerator;
  actor: ActorRef;
}

export class Phase2Runtime {
  private readonly projectionEngine: ProjectionEngine;
  private readonly contextPlanner: ContextPlanner;

  constructor(
    private readonly ports: Phase2RuntimePorts,
    contextPlanner = new ContextPlanner(),
  ) {
    this.projectionEngine = new ProjectionEngine(
      ports.events,
      ports.projections,
    );
    this.contextPlanner = contextPlanner;
  }

  appendEvent(event: EventEnvelope): EventAppendResult {
    if (
      event.type === "context.plan.created" ||
      event.type === "context.item.exposed"
    ) {
      throw new Error(
        "context events must be recorded through the runtime context use-cases",
      );
    }
    return this.ports.events.append(event);
  }

  catchUp<TState>(projection: Projection<TState>): CatchUpResult {
    return this.projectionEngine.catchUp(projection);
  }

  rebuild<TState>(projection: Projection<TState>): CatchUpResult {
    return this.projectionEngine.rebuild(projection);
  }

  catchUpCoreProjections(): CatchUpResult[] {
    return createCoreProjections().map((projection) =>
      this.projectionEngine.catchUp(projection),
    );
  }

  buildContextPlan(
    input: Omit<ContextPlannerInput, "generatedAt" | "planId"> & {
      generatedAt?: string;
      planId?: string;
    },
  ): ContextPlan {
    const generatedAt = input.generatedAt ?? this.nowIso();
    const planId = input.planId ?? this.ports.ids.next();
    if (planId.length < 1) {
      throw new Error("id generator returned an empty planId");
    }
    this.validateContextStateSeq(input.stateSeq);
    return this.contextPlanner.plan({ ...input, generatedAt, planId });
  }

  recordContextPlan(plan: ContextPlan): EventAppendResult {
    this.validateContextPlan(plan);
    const candidateSourceIds = plan.candidateSources.map(
      (source) => source.sourceEventId,
    );
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: contextPlanEventId(plan.planId),
      type: "context.plan.created",
      occurredAt: plan.generatedAt,
      observedAt: plan.generatedAt,
      recordedAt: plan.generatedAt,
      actor: this.ports.actor,
      source: {
        kind: "context-planner",
        ref: plan.planId,
      },
      operationId: plan.planId,
      payload: {
        classification: plan.classification,
        mode: plan.mode,
        rankingVersion: plan.rankingVersion,
        planId: plan.planId,
        stateSeq: plan.stateSeq,
        generatedAt: plan.generatedAt,
        budget: plan.budget,
        candidateSources: plan.candidateSources,
        selected: plan.selected,
        reasons: plan.reasons,
        exposureProposals: plan.exposureProposals,
        ...(plan.taskId === undefined ? {} : { taskId: plan.taskId }),
        ...(plan.projectId === undefined ? {} : { projectId: plan.projectId }),
      } as unknown as JsonValue,
      evidence: plan.candidateSources.map((source): EvidenceRef => ({
        eventId: source.sourceEventId,
        origin: source.sourceOrigin,
        exposureInfluenced: false,
      })),
      links: {
        derivedFrom: [...new Set(candidateSourceIds)],
      },
      provenance: { origin: "inferred", confidence: 1 },
    };
    return this.ports.events.append(event);
  }

  recordContextExposure(
    proposal: ContextExposureProposal,
    planId?: string,
    timing: ContextExposureTiming = {},
  ): EventAppendResult {
    const resolvedPlanId = planId ?? proposal.planId;
    if (resolvedPlanId !== proposal.planId) {
      throw new Error("context exposure planId does not match its proposal");
    }
    const planEvent = this.ports.events.getById(
      contextPlanEventId(resolvedPlanId),
    );
    if (planEvent === null) {
      throw new Error("context exposure requires a recorded context plan");
    }
    this.validateRecordedContextExposure(proposal, resolvedPlanId, planEvent);
    this.validateContextSource(
      proposal.sourceEventId,
      proposal.stateSeq,
      proposal.sourceId,
      undefined,
      proposal.sourceOrigin,
    );
    const occurredAt = timing.occurredAt ?? proposal.generatedAt;
    const observedAt = timing.observedAt ?? occurredAt;
    const recordedAt = timing.recordedAt ?? observedAt;
    assertCanonicalTimestamp(occurredAt, "exposure occurredAt");
    assertCanonicalTimestamp(observedAt, "exposure observedAt");
    assertCanonicalTimestamp(recordedAt, "exposure recordedAt");
    if (
      Date.parse(occurredAt) > Date.parse(observedAt) ||
      Date.parse(observedAt) > Date.parse(recordedAt)
    ) {
      throw new Error(
        "exposure timestamps must be ordered occurredAt <= observedAt <= recordedAt",
      );
    }
    const event = createContextExposureEvent({
      id: contextExposureOperationId(resolvedPlanId, proposal.itemId),
      occurredAt,
      observedAt,
      recordedAt,
      actor: this.ports.actor,
      proposal,
      planId: resolvedPlanId,
    });
    return this.ports.events.append(event);
  }

  private validateContextPlan(plan: ContextPlan): void {
    if (plan.classification !== "candidate" || plan.planId.length < 1) {
      throw new Error("context plan must remain an identified candidate");
    }
    if (plan.rankingVersion.length < 1) {
      throw new Error("context plan rankingVersion must not be empty");
    }
    assertCanonicalTimestamp(plan.generatedAt, "context plan generatedAt");
    this.validateContextStateSeq(plan.stateSeq);
    const candidates = new Map(
      plan.candidateSources.map((source) => [source.id, source]),
    );
    if (candidates.size !== plan.candidateSources.length) {
      throw new Error("context plan contains duplicate candidate source ids");
    }
    for (const source of plan.candidateSources) {
      this.validateContextSource(
        source.sourceEventId,
        plan.stateSeq,
        source.id,
        source.seq,
        source.sourceOrigin,
      );
    }
    for (const item of plan.selected) {
      const source = candidates.get(item.sourceId);
      if (
        source === undefined ||
        source.sourceEventId !== item.sourceEventId ||
        source.sourceOrigin !== item.sourceOrigin
      ) {
        throw new Error(
          "context plan selected item is not in its candidate snapshot",
        );
      }
    }
    const reasonIds = new Set(plan.reasons.map((reason) => reason.itemId));
    if (
      reasonIds.size !== plan.reasons.length ||
      reasonIds.size !== plan.selected.length ||
      plan.selected.some((item) => !reasonIds.has(item.id))
    ) {
      throw new Error("context plan reasons do not cover the selected items");
    }
    const selectedIds = new Set(plan.selected.map((item) => item.id));
    const proposalIds = new Set(
      plan.exposureProposals.map((proposal) => proposal.itemId),
    );
    if (
      selectedIds.size !== plan.selected.length ||
      proposalIds.size !== plan.exposureProposals.length ||
      proposalIds.size !== selectedIds.size ||
      plan.selected.some((item) => !proposalIds.has(item.id))
    ) {
      throw new Error(
        "context plan exposure proposals do not cover the selection",
      );
    }
    for (const proposal of plan.exposureProposals) {
      const selected = plan.selected.find(
        (item) => item.id === proposal.itemId,
      );
      if (
        proposal.planId !== plan.planId ||
        proposal.rankingVersion !== plan.rankingVersion ||
        proposal.generatedAt !== plan.generatedAt ||
        proposal.stateSeq !== plan.stateSeq ||
        !selectedIds.has(proposal.itemId) ||
        selected === undefined ||
        selected.sourceId !== proposal.sourceId ||
        selected.sourceEventId !== proposal.sourceEventId ||
        selected.sourceOrigin !== proposal.sourceOrigin
      ) {
        throw new Error("context exposure proposal is not bound to its plan");
      }
      this.validateContextSource(
        proposal.sourceEventId,
        proposal.stateSeq,
        proposal.sourceId,
        undefined,
        proposal.sourceOrigin,
      );
    }
  }

  private validateRecordedContextExposure(
    proposal: ContextExposureProposal,
    planId: string,
    planEvent: EventRecord,
  ): void {
    if (
      planEvent.type !== "context.plan.created" ||
      planEvent.operationId !== planId ||
      planEvent.provenance.origin !== "inferred"
    ) {
      throw new Error(
        "context exposure plan event is not a valid recorded plan",
      );
    }
    const payload = asJsonObject(planEvent.payload);
    if (
      payload === null ||
      payload.classification !== "candidate" ||
      payload.planId !== planId ||
      payload.rankingVersion !== proposal.rankingVersion ||
      payload.generatedAt !== proposal.generatedAt ||
      payload.stateSeq !== proposal.stateSeq
    ) {
      throw new Error("context exposure does not match the recorded plan");
    }
    const selected = findJsonObject(
      payload.selected,
      (item) => item.id === proposal.itemId,
    );
    const recordedProposal = findJsonObject(
      payload.exposureProposals,
      (item) => item.itemId === proposal.itemId,
    );
    if (
      selected === null ||
      recordedProposal === null ||
      selected.sourceId !== proposal.sourceId ||
      selected.sourceEventId !== proposal.sourceEventId ||
      selected.sourceOrigin !== proposal.sourceOrigin ||
      stableStringify(recordedProposal) !==
        stableStringify(contextExposureProposalJson(proposal))
    ) {
      throw new Error("context exposure is not a member of the recorded plan");
    }
  }

  private validateContextSource(
    sourceEventId: string,
    stateSeq: number,
    sourceId: string,
    declaredSeq?: number,
    declaredOrigin?: EvidenceOrigin,
  ): void {
    this.validateContextStateSeq(stateSeq);
    const sourceEvent = this.ports.events.getById(sourceEventId);
    if (sourceEvent === null) {
      throw new Error(
        "context source event is not present in the event ledger",
      );
    }
    if (declaredSeq !== undefined && sourceEvent.seq !== declaredSeq) {
      throw new Error(
        "context source sequence does not match the event ledger",
      );
    }
    if (sourceEvent.seq > stateSeq) {
      throw new Error("context source is newer than the plan state cursor");
    }
    if (
      declaredOrigin !== undefined &&
      sourceEvent.provenance.origin !== declaredOrigin
    ) {
      throw new Error("context source origin does not match ledger provenance");
    }
    if (sourceId.length < 1) {
      throw new Error("context source id must not be empty");
    }
  }

  private validateContextStateSeq(stateSeq: number): void {
    if (!Number.isSafeInteger(stateSeq) || stateSeq < 0) {
      throw new Error(
        "context state cursor must be a non-negative safe integer",
      );
    }
    const ledgerLastSeq = this.ports.events.getLastSeq();
    if (stateSeq > ledgerLastSeq) {
      throw new Error("context state cursor is ahead of the event ledger");
    }
  }

  private nowIso(): string {
    const value = this.ports.clock.now();
    if (Number.isNaN(value.getTime())) {
      throw new Error("clock returned an invalid date");
    }
    return value.toISOString();
  }
}

export type Phase3RuntimePorts = Phase2RuntimePorts;

export function residualDetectedEventId(residualId: string): string {
  return `residual-detected:${encodeURIComponent(residualId)}`;
}

export function reflectionProposalEventId(residualId: string): string {
  return `reflection-proposed:${encodeURIComponent(residualId)}`;
}

/**
 * Phase 3 adds pure detection/reflection and explicit event recording. The
 * detector and controller only propose; this runtime still requires the
 * caller to decide whether any later action is authorized.
 */
export class Phase3Runtime extends Phase2Runtime {
  private readonly residualDetector = new ResidualDetector();
  private readonly reflectionController = new ReflectionController();

  constructor(private readonly phase3Ports: Phase3RuntimePorts) {
    super(phase3Ports);
  }

  detectResiduals(input: ResidualDetectionBatch): Residual[] {
    return this.residualDetector.detect(input);
  }

  runReflection(input: ReflectionInput): ReflectionResult {
    return this.reflectionController.reflect(input);
  }

  recordResiduals(residuals: Residual[]): EventAppendResult[] {
    const events = residuals.map((residual) =>
      residualDetectedEvent(this.phase3Ports, residual),
    );
    return events.map((event) => this.phase3Ports.events.append(event));
  }

  recordReflectionProposal(
    residual: Residual,
    proposal: ReflectionResult,
  ): EventAppendResult {
    if (proposal.residualId !== residual.id) {
      throw new Error("reflection proposal residualId does not match residual");
    }
    const residualEventId = residualDetectedEventId(residual.id);
    const residualEvent = this.phase3Ports.events.getById(residualEventId);
    if (
      residualEvent === null ||
      residualEvent.type !== "residual.detected" ||
      residualEvent.operationId !== residual.id ||
      stableStringify(residualEvent.payload) !==
        stableStringify(residualPayload(residual))
    ) {
      throw new Error(
        "reflection proposal requires a matching recorded residual.detected event",
      );
    }

    const occurredAt = nowIsoAtLeast(
      this.phase3Ports.clock,
      residualEvent.recordedAt,
    );
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: reflectionProposalEventId(residual.id),
      type: "reflection.proposed",
      occurredAt,
      observedAt: occurredAt,
      recordedAt: occurredAt,
      actor: this.phase3Ports.actor,
      operationId: `reflection:${residual.id}`,
      source: { kind: "reflection-controller", ref: residual.id },
      payload: reflectionProposalPayload(residual, proposal),
      evidence: [
        ...residual.evidence.map(copyEvidenceRef),
        { eventId: residualEventId, origin: "inferred" },
      ],
      links: {
        respondsTo: [residualEventId],
        derivedFrom: [
          residualEventId,
          ...eventIdsFromEvidence(residual.evidence),
        ],
      },
      provenance: { origin: "inferred", confidence: residual.confidence },
    };
    return this.phase3Ports.events.append(event);
  }
}

function residualDetectedEvent(
  ports: Phase3RuntimePorts,
  residual: Residual,
): EventEnvelope {
  assertResidualForRecording(ports, residual);
  const occurredAt = residual.detectedAt;
  const recordedAt = nowIsoAtLeast(ports.clock, occurredAt);
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id: residualDetectedEventId(residual.id),
    type: "residual.detected",
    occurredAt,
    observedAt: occurredAt,
    recordedAt,
    actor: ports.actor,
    operationId: residual.id,
    source: { kind: "residual-detector", ref: residual.id },
    payload: residualPayload(residual),
    evidence: residual.evidence.map(copyEvidenceRef),
    links: {
      ...(eventIdsFromEvidence(residual.evidence).length === 0
        ? {}
        : { derivedFrom: eventIdsFromEvidence(residual.evidence) }),
    },
    provenance: { origin: "inferred", confidence: residual.confidence },
  };
}

function reflectionProposalPayload(
  residual: Residual,
  proposal: ReflectionResult,
): JsonObject {
  return {
    materialClassification: "inferred",
    residualId: residual.id,
    decision: proposal.decision,
    reasons: [...proposal.reasons],
    hypotheses: proposal.hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      statement: hypothesis.statement,
      support: hypothesis.support.map(evidencePayload),
      counterevidence: hypothesis.counterevidence.map(evidencePayload),
      testability: hypothesis.testability,
      estimatedCost: hypothesis.estimatedCost,
    })),
    recommendedActions: proposal.recommendedActions.map((action) => ({
      id: action.id,
      kind: action.kind,
      requiredPermission: action.requiredPermission,
      parameters: action.parameters,
    })),
    budgetUsed: proposal.budgetUsed,
  } as unknown as JsonObject;
}

function residualPayload(residual: Residual): JsonObject {
  return {
    materialClassification: "inferred",
    residualId: residual.id,
    kind: residual.kind,
    ...(residual.baseline === undefined
      ? {}
      : { baseline: referencePayload(residual.baseline) }),
    observed: referencePayload(residual.observed),
    field: fieldContextPayload(residual),
    ...(residual.magnitude === undefined
      ? {}
      : { magnitude: residual.magnitude }),
    confidence: residual.confidence,
    persistence: residual.persistence,
    effect: residual.effect,
    evidence: residual.evidence.map(evidencePayload),
    detectedAt: residual.detectedAt,
  } as unknown as JsonObject;
}

function referencePayload(reference: {
  kind: string;
  id: string;
  value: JsonValue;
}): JsonObject {
  return { kind: reference.kind, id: reference.id, value: reference.value };
}

function fieldContextPayload(residual: Residual): JsonObject {
  const field = residual.field;
  return {
    ...(field.taskType === undefined ? {} : { taskType: field.taskType }),
    externalVerification: field.externalVerification,
    consequence: field.consequence,
    reversibility: field.reversibility,
    feedbackLatency: field.feedbackLatency,
    actors: field.actors.map((actor) => ({
      type: actor.type,
      id: actor.id,
    })),
    explicitRules: field.explicitRules.map((rule) => ({
      id: rule.id,
      ...(rule.requiredEventTypes === undefined
        ? {}
        : { requiredEventTypes: [...rule.requiredEventTypes] }),
      ...(rule.requiredCheckpoints === undefined
        ? {}
        : { requiredCheckpoints: [...rule.requiredCheckpoints] }),
    })),
  } as unknown as JsonObject;
}

function evidencePayload(evidence: EvidenceRef): JsonObject {
  return {
    ...(evidence.eventId === undefined ? {} : { eventId: evidence.eventId }),
    ...(evidence.assetId === undefined ? {} : { assetId: evidence.assetId }),
    ...(evidence.artifactHash === undefined
      ? {}
      : { artifactHash: evidence.artifactHash }),
    origin: evidence.origin,
    ...(evidence.exposureInfluenced === undefined
      ? {}
      : { exposureInfluenced: evidence.exposureInfluenced }),
  };
}

function copyEvidenceRef(evidence: EvidenceRef): EvidenceRef {
  return { ...evidence };
}

function eventIdsFromEvidence(evidence: EvidenceRef[]): string[] {
  return [
    ...new Set(
      evidence.flatMap((item) =>
        item.eventId === undefined ? [] : [item.eventId],
      ),
    ),
  ];
}

function assertResidualForRecording(
  ports: Phase3RuntimePorts,
  residual: Residual,
): void {
  if (residual.id.length < 1) throw new Error("residual id is required");
  if (residual.evidence.length < 1) {
    throw new Error("residual recording requires evidence");
  }
  if (
    !Number.isFinite(residual.confidence) ||
    residual.confidence < 0 ||
    residual.confidence > 1
  ) {
    throw new Error("residual confidence must be between 0 and 1");
  }
  assertCanonicalTimestamp(residual.detectedAt, "residual detectedAt");
  for (const evidence of residual.evidence) {
    if (evidence.eventId === undefined) continue;
    const sourceEvent = ports.events.getById(evidence.eventId);
    if (sourceEvent === null) {
      throw new Error("residual evidence event is not present in the ledger");
    }
    if (sourceEvent.provenance.origin !== evidence.origin) {
      throw new Error(
        "residual evidence origin does not match ledger provenance",
      );
    }
  }
}

function nowIsoAtLeast(clock: Clock, lowerBound: string): string {
  const now = clock.now();
  if (Number.isNaN(now.getTime()))
    throw new Error("clock returned an invalid date");
  const lowerBoundMilliseconds = Date.parse(lowerBound);
  if (!Number.isSafeInteger(lowerBoundMilliseconds)) {
    throw new Error("timestamp lower bound is not canonical");
  }
  return new Date(
    Math.max(now.getTime(), lowerBoundMilliseconds),
  ).toISOString();
}

function asJsonObject(value: JsonValue | undefined): JsonObject | null {
  if (value === undefined || value === null || typeof value !== "object") {
    return null;
  }
  return Array.isArray(value) ? null : value;
}

function findJsonObject(
  value: JsonValue | undefined,
  predicate: (value: JsonObject) => boolean,
): JsonObject | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const object = asJsonObject(item);
    if (object !== null && predicate(object)) return object;
  }
  return null;
}

function contextExposureProposalJson(
  proposal: ContextExposureProposal,
): JsonObject {
  return {
    planId: proposal.planId,
    rankingVersion: proposal.rankingVersion,
    generatedAt: proposal.generatedAt,
    itemId: proposal.itemId,
    sourceId: proposal.sourceId,
    sourceEventId: proposal.sourceEventId,
    sourceOrigin: proposal.sourceOrigin,
    stateSeq: proposal.stateSeq,
    reason: proposal.reason,
  };
}

function assertCanonicalTimestamp(value: string, field: string): void {
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new Error(`${field} must be a canonical UTC timestamp`);
  }
}
