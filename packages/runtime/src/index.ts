export {};
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";

import type {
  ActorRef,
  Clock,
  EventAppendResult,
  EventBatchWriter,
  EventEnvelope,
  EventReader,
  EventWriter,
  EventQuery,
  EventRecord,
  EvidenceOrigin,
  EvidenceRef,
  IdGenerator,
  LedgerSeqGap,
  JsonObject,
  JsonValue,
  ProjectionPersistence,
  WriterContext,
} from "@praxis/contracts";
import {
  AuthorizationError,
  authorizeHumanControl,
  authorizeWriterScope,
  parseExpectationDefinition,
  parseExpectationRecord,
  parseVerificationResult,
  parseWriterContext,
  requiredScopeForEventType,
  stableStringify,
  expectationStatusSchema,
  validatePhase3EventEnvelope,
} from "@praxis/contracts";
import type {
  ExpectationDefinition,
  ExpectationRecord,
  VerificationResult,
} from "@praxis/contracts";
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
import type {
  ReflectionEvidenceDelta,
  ReflectionInput,
  ReflectionResult,
} from "@praxis/reflection";
import {
  ReflectionController,
  validateReflectionResult,
} from "@praxis/reflection";
import type {
  Expectation,
  FieldContext,
  Residual,
  ResidualDetectionBatch,
  ResidualPersistence,
  TimingDetectionInput,
} from "@praxis/residual";
import { ResidualDetector } from "@praxis/residual";
import { ProjectionEngine, createCoreProjections } from "@praxis/state";
import type { CatchUpResult, Projection } from "@praxis/state";
import type {
  BackupManifest,
  BackupOptions,
  ManagedBackup,
  PurgeCleanupResult,
  PrivacyPurgeOptions,
  PrivacyPurgePlan,
  PrivacyPurgeResult,
  StoreHealth,
} from "@praxis/store";

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
  writer: WriterContext;
}

export class Phase2Runtime {
  #ports: Phase2RuntimePorts;
  private readonly projectionEngine: ProjectionEngine;
  private readonly contextPlanner: ContextPlanner;

  constructor(
    ports: Phase2RuntimePorts,
    contextPlanner = new ContextPlanner(),
  ) {
    this.#ports = ports;
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
    if (
      event.type === "expectation.registered" ||
      event.type === "expectation.created" ||
      event.type === "expectation.updated" ||
      event.type === "expectation.cancelled" ||
      event.type === "expectation.status.changed" ||
      event.type === "verification.requested" ||
      event.type === "verification.completed" ||
      event.type === "residual.detected" ||
      event.type === "reflection.proposed" ||
      event.type === "asset.contest" ||
      event.type === "asset.disable" ||
      event.type === "asset.restore" ||
      event.type === "asset.fork"
    ) {
      throw new Error(
        "domain events must be recorded through their runtime use-cases",
      );
    }
    return this.#ports.events.append(event, this.#ports.writer);
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
    const planId = input.planId ?? this.#ports.ids.next();
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
      actor: this.#ports.actor,
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
    return this.#ports.events.append(event, this.#ports.writer);
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
    const planEvent = this.#ports.events.getById(
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
      actor: this.#ports.actor,
      proposal,
      planId: resolvedPlanId,
    });
    return this.#ports.events.append(event, this.#ports.writer);
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
    const sourceEvent = this.#ports.events.getById(sourceEventId);
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
    const ledgerLastSeq = this.#ports.events.getLastSeq();
    if (stateSeq > ledgerLastSeq) {
      throw new Error("context state cursor is ahead of the event ledger");
    }
  }

  protected nowIso(): string {
    const value = this.#ports.clock.now();
    if (Number.isNaN(value.getTime())) {
      throw new Error("clock returned an invalid date");
    }
    return value.toISOString();
  }
}

export type Phase3RuntimePorts = Phase2RuntimePorts & {
  events: Phase2RuntimePorts["events"] & EventBatchWriter;
};

export type AssetControlAction = "contest" | "disable" | "restore" | "fork";

export interface AssetControlOptions {
  reason: string;
  at?: string;
  newAssetId?: string;
}

/**
 * The composition root depends on the store contract, not on SQLite's
 * private connection representation. This keeps source-level tests and
 * packaged consumers structurally compatible while preserving the rule that
 * the raw database handle is never part of the public runtime API.
 */
export interface RuntimeStore
  extends EventReader, EventWriter, EventBatchWriter, ProjectionPersistence {
  readonly filename: string;
  close(): void;
  backupTo(destinationPath: string, options?: BackupOptions): BackupManifest;
  createManagedBackup(
    destinationPath: string,
    writer: WriterContext,
    options?: BackupOptions,
  ): BackupManifest;
  listManagedBackups(): ManagedBackup[];
  planPrivacyPurge(sessionId: string): PrivacyPurgePlan;
  privacyPurge(
    sessionId: string,
    writer: WriterContext,
    options?: PrivacyPurgeOptions,
  ): PrivacyPurgeResult;
  finalizePendingPurge(writer: WriterContext): PurgeCleanupResult;
  getPurgedSeqRanges(): LedgerSeqGap[];
  getHealth(): StoreHealth;
}

export interface RuntimePrivacyPurgeResult extends PrivacyPurgeResult {
  projectionRebuild?: CatchUpResult[];
}

export function residualDetectedEventId(residualId: string): string {
  return `residual-detected:${encodeURIComponent(residualId)}`;
}

export function expectationRegisteredEventId(expectationId: string): string {
  return `expectation-registered:${encodeURIComponent(expectationId)}`;
}

export function expectationCreatedEventId(expectationId: string): string {
  return `expectation-created:${encodeURIComponent(expectationId)}`;
}

export function expectationUpdatedEventId(
  expectationId: string,
  updatedAt: string,
): string {
  return `expectation-updated:${encodeURIComponent(expectationId)}:${encodeURIComponent(updatedAt)}`;
}

export function verificationRequestedEventId(requestId: string): string {
  return `verification-requested:${encodeURIComponent(requestId)}`;
}

export function verificationCompletedEventId(verificationId: string): string {
  return `verification-completed:${encodeURIComponent(verificationId)}`;
}

export function reflectionProposalEventId(
  residualId: string,
  evidenceToSeq: number,
): string {
  if (!Number.isSafeInteger(evidenceToSeq) || evidenceToSeq < 0) {
    throw new Error(
      "reflection proposal evidenceToSeq must be a non-negative safe integer",
    );
  }
  return `reflection-proposed:${encodeURIComponent(residualId)}:${evidenceToSeq}`;
}

/**
 * Phase 3 adds pure detection/reflection and explicit event recording. The
 * detector and controller only propose; this runtime still requires the
 * caller to decide whether any later action is authorized.
 */
export class Phase3Runtime extends Phase2Runtime {
  private readonly residualDetector = new ResidualDetector();
  private readonly reflectionController = new ReflectionController();
  #phase3Ports: Phase3RuntimePorts;

  constructor(phase3Ports: Phase3RuntimePorts) {
    super(phase3Ports);
    this.#phase3Ports = phase3Ports;
  }

  detectResiduals(input: ResidualDetectionBatch): Residual[] {
    validateTimingInputsAgainstLedger(this.#phase3Ports, input.timings ?? []);
    return this.residualDetector.detect(input);
  }

  runReflection(input: ReflectionInput): ReflectionResult {
    validateReflectionEvidenceDelta(this.#phase3Ports, input.evidenceDelta);
    return this.reflectionController.reflect(input);
  }

  recordExpectation(expectation: Expectation): EventAppendResult {
    assertExpectationForRecording(this.#phase3Ports, expectation);
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: expectationRegisteredEventId(expectation.id),
      type: "expectation.registered",
      occurredAt: expectation.createdAt,
      observedAt: expectation.createdAt,
      recordedAt: expectation.createdAt,
      actor: this.#phase3Ports.actor,
      ...(expectation.traceId === undefined
        ? {}
        : { traceId: expectation.traceId }),
      operationId: expectation.id,
      source: { kind: "expectation-registry", ref: expectation.id },
      payload: expectationPayload(expectation),
      evidence: expectation.evidence.map(copyEvidenceRef),
      links: {
        ...(eventIdsFromEvidence(expectation.evidence).length === 0
          ? {}
          : { derivedFrom: eventIdsFromEvidence(expectation.evidence) }),
      },
      provenance: { origin: "declared", confidence: 1 },
    };
    validatePhase3EventEnvelope(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }

  recordExpectationDefinition(
    definition: ExpectationDefinition,
  ): EventAppendResult {
    const normalized = parseExpectationDefinition(definition);
    assertEvidenceRefs(
      this.#phase3Ports,
      normalized.evidence,
      "structured expectation",
    );
    const createdAt = normalized.createdAt;
    const record: ExpectationRecord = {
      ...normalized,
      status: "pending",
      updatedAt: createdAt,
    };
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: expectationCreatedEventId(record.id),
      type: "expectation.created",
      occurredAt: createdAt,
      observedAt: createdAt,
      recordedAt: createdAt,
      actor: this.#phase3Ports.actor,
      ...(record.traceId === undefined ? {} : { traceId: record.traceId }),
      operationId: `expectation-created:${record.id}`,
      source: { kind: "expectation-registry", ref: record.id },
      payload: structuredExpectationPayload(record),
      evidence: record.evidence.map(copyEvidenceRef),
      links: {
        ...(eventIdsFromEvidence(record.evidence).length === 0
          ? {}
          : { derivedFrom: eventIdsFromEvidence(record.evidence) }),
      },
      provenance: { origin: "declared", confidence: 1 },
    };
    validatePhase35ExpectationEvent(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }

  recordExpectationUpdate(record: ExpectationRecord): EventAppendResult {
    const normalized = parseExpectationRecord(record);
    const previous = this.findStructuredExpectation(normalized.id);
    if (previous === null) {
      throw new Error(
        "expectation update requires a recorded expectation.created event",
      );
    }
    if (Date.parse(normalized.updatedAt) < Date.parse(previous.updatedAt)) {
      throw new Error("expectation update cannot move updatedAt backwards");
    }
    assertEvidenceRefs(
      this.#phase3Ports,
      normalized.evidence,
      "structured expectation update",
    );
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: expectationUpdatedEventId(normalized.id, normalized.updatedAt),
      type: "expectation.updated",
      occurredAt: normalized.updatedAt,
      observedAt: normalized.updatedAt,
      recordedAt: normalized.updatedAt,
      actor: this.#phase3Ports.actor,
      ...(normalized.traceId === undefined
        ? {}
        : { traceId: normalized.traceId }),
      operationId: `expectation-updated:${normalized.id}:${normalized.updatedAt}`,
      source: { kind: "expectation-registry", ref: normalized.id },
      payload: structuredExpectationPayload(normalized),
      evidence: normalized.evidence.map(copyEvidenceRef),
      links: { respondsTo: [expectationCreatedEventId(normalized.id)] },
      provenance: { origin: "declared", confidence: 1 },
    };
    validatePhase35ExpectationEvent(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }

  recordVerificationRequest(
    expectationId: string,
    requestId: string,
    requestedAt = this.nowIso(),
  ): EventAppendResult {
    const expectation = this.requireStructuredExpectation(expectationId);
    if (expectation.verification.verifier === undefined) {
      throw new Error("verification request requires an explicit verifier");
    }
    assertExpectationTime(requestedAt, "verification requestedAt");
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: verificationRequestedEventId(requestId),
      type: "verification.requested",
      occurredAt: requestedAt,
      observedAt: requestedAt,
      recordedAt: requestedAt,
      actor: this.#phase3Ports.actor,
      ...(expectation.traceId === undefined
        ? {}
        : { traceId: expectation.traceId }),
      operationId: `verification-request:${requestId}`,
      source: { kind: "verification-coordinator", ref: expectationId },
      payload: {
        materialClassification: "declared",
        expectationId,
        requestId,
        requestedAt,
        verifier: expectation.verification.verifier,
        mode: expectation.verification.mode,
      } as unknown as JsonValue,
      evidence: expectation.evidence.map(copyEvidenceRef),
      links: { respondsTo: [expectationCreatedEventId(expectationId)] },
      provenance: { origin: "declared", confidence: 1 },
    };
    validatePhase35ExpectationEvent(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }

  recordVerificationResult(result: VerificationResult): EventAppendResult {
    const normalized = parseVerificationResult(result);
    const expectation = this.requireStructuredExpectation(
      normalized.expectationId,
    );
    if (
      expectation.verification.verifier === undefined ||
      stableStringify(
        expectation.verification.verifier as unknown as JsonValue,
      ) !== stableStringify(normalized.verifier as unknown as JsonValue)
    ) {
      throw new Error(
        "verification result verifier does not match the expectation policy",
      );
    }
    assertVerificationWindow(expectation, normalized.observedAt);
    assertEvidenceRefs(
      this.#phase3Ports,
      normalized.evidence,
      "verification result",
    );
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: verificationCompletedEventId(normalized.id),
      type: "verification.completed",
      occurredAt: normalized.observedAt,
      observedAt: normalized.observedAt,
      recordedAt: normalized.observedAt,
      actor: this.#phase3Ports.actor,
      ...(expectation.traceId === undefined
        ? {}
        : { traceId: expectation.traceId }),
      operationId: `verification-completed:${normalized.id}`,
      source: {
        kind: "verification-coordinator",
        ref: normalized.expectationId,
      },
      payload: {
        materialClassification: "declared",
        result: verificationResultPayload(normalized),
      } as unknown as JsonValue,
      evidence: normalized.evidence.map(copyEvidenceRef),
      links: {
        respondsTo: [expectationCreatedEventId(normalized.expectationId)],
      },
      provenance: { origin: "declared", confidence: 1 },
    };
    validatePhase35ExpectationEvent(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }

  recordExpectationStatusChange(
    expectationId: string,
    to: ExpectationRecord["status"],
    changedAt = this.nowIso(),
    reason = "human decision",
  ): EventAppendResult {
    assertHumanWriter(this.#phase3Ports.writer);
    const nextStatus = expectationStatusSchema.parse(to);
    const expectation = this.requireStructuredExpectation(expectationId);
    assertExpectationTime(changedAt, "expectation changedAt");
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: `expectation-status:${encodeURIComponent(expectationId)}:${encodeURIComponent(changedAt)}`,
      type: "expectation.status.changed",
      occurredAt: changedAt,
      observedAt: changedAt,
      recordedAt: changedAt,
      actor: this.#phase3Ports.actor,
      ...(expectation.traceId === undefined
        ? {}
        : { traceId: expectation.traceId }),
      operationId: `expectation-status:${expectationId}:${changedAt}`,
      source: { kind: "human-control", ref: expectationId },
      payload: {
        materialClassification: "declared",
        expectationId,
        from: expectation.status,
        to: nextStatus,
        changedAt,
        reason,
      } as unknown as JsonValue,
      evidence: expectation.evidence.map(copyEvidenceRef),
      links: { respondsTo: [expectationCreatedEventId(expectationId)] },
      provenance: { origin: "declared", confidence: 1 },
    };
    validatePhase35ExpectationEvent(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }

  recordExpectationCancellation(
    expectationId: string,
    cancelledAt = this.nowIso(),
    reason = "human cancellation",
  ): EventAppendResult {
    assertHumanWriter(this.#phase3Ports.writer);
    const expectation = this.requireStructuredExpectation(expectationId);
    assertExpectationTime(cancelledAt, "expectation cancelledAt");
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: `expectation-cancelled:${encodeURIComponent(expectationId)}:${encodeURIComponent(cancelledAt)}`,
      type: "expectation.cancelled",
      occurredAt: cancelledAt,
      observedAt: cancelledAt,
      recordedAt: cancelledAt,
      actor: this.#phase3Ports.actor,
      ...(expectation.traceId === undefined
        ? {}
        : { traceId: expectation.traceId }),
      operationId: `expectation-cancelled:${expectationId}:${cancelledAt}`,
      source: { kind: "human-control", ref: expectationId },
      payload: {
        materialClassification: "declared",
        expectationId,
        cancelledAt,
        reason,
      } as unknown as JsonValue,
      evidence: expectation.evidence.map(copyEvidenceRef),
      links: { respondsTo: [expectationCreatedEventId(expectationId)] },
      provenance: { origin: "declared", confidence: 1 },
    };
    validatePhase35ExpectationEvent(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }

  detectStructuredOutcomeResidual(
    result: VerificationResult,
    field: FieldContext,
    detectedAt = this.nowIso(),
    persistence?: ResidualPersistence,
  ): Residual | null {
    const normalized = parseVerificationResult(result);
    const expectation = this.requireStructuredExpectation(
      normalized.expectationId,
    );
    assertStructuredVerificationWasRecorded(this.#phase3Ports, normalized);
    if (normalized.outcome !== "violated") return null;
    const details = asJsonObject(normalized.details);
    const actual = details?.actual;
    if (actual === undefined) {
      throw new Error(
        "structured outcome residual requires verification.details.actual",
      );
    }
    return (
      this.detectResiduals({
        outcomes: [
          {
            expectation: structuredExpectationToLegacy(expectation),
            observation: {
              id: normalized.id,
              ...(expectation.traceId === undefined
                ? {}
                : { traceId: expectation.traceId }),
              subject: expectation.subject,
              actual,
              observedAt: normalized.observedAt,
              evidence: normalized.evidence,
            },
            field,
            detectedAt,
            ...(persistence === undefined ? {} : { persistence }),
            verification: {
              matches: false,
              confidence: 1,
              explanation: "structured verification outcome was violated",
              evidence: normalized.evidence,
            },
          },
        ],
      })[0] ?? null
    );
  }

  /**
   * Human controls are append-only decisions about an existing asset. They do
   * not edit the source event; the new event records the target, reason, and
   * provenance so a later projection can be rebuilt without guessing intent.
   */
  recordAssetControl(
    action: AssetControlAction,
    assetId: string,
    options: AssetControlOptions,
  ): EventAppendResult {
    const eventType = `asset.${action}`;
    const requiredScope = requiredScopeForEventType(eventType);
    authorizeHumanControl(
      this.#phase3Ports.writer,
      `${eventType} human control`,
      requiredScope,
    );
    assertHumanActor(this.#phase3Ports.actor);
    if (assetId.length < 1) throw new Error("asset id is required");
    if (options.reason.length < 1) {
      throw new Error("asset control reason is required");
    }
    const controlledAt = options.at ?? this.nowIso();
    assertCanonicalTimestamp(controlledAt, "asset control at");
    const target = this.findAssetEvent(assetId);
    if (target === null) {
      throw new Error("asset control requires a recorded asset event");
    }
    if (action === "fork") {
      if (
        options.newAssetId === undefined ||
        options.newAssetId.length < 1 ||
        options.newAssetId === assetId
      ) {
        throw new Error("asset fork requires a distinct newAssetId");
      }
      if (this.findAssetEvent(options.newAssetId) !== null) {
        throw new Error("asset fork newAssetId already exists");
      }
    }
    const resultAssetId = action === "fork" ? options.newAssetId! : assetId;
    const eventId = `asset-control:${action}:${encodeURIComponent(
      resultAssetId,
    )}:${encodeURIComponent(controlledAt)}`;
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: eventId,
      type: eventType,
      occurredAt: controlledAt,
      observedAt: controlledAt,
      recordedAt: controlledAt,
      actor: this.#phase3Ports.actor,
      operationId: eventId,
      source: { kind: "human-control", ref: assetId },
      payload: {
        materialClassification: "declared",
        id: resultAssetId,
        assetId: resultAssetId,
        targetAssetId: assetId,
        action,
        reason: options.reason,
        controlledAt,
        ...(action === "fork"
          ? { sourceAssetId: assetId, sourceAssetEventId: target.id }
          : {}),
      } as unknown as JsonObject,
      evidence: [{ eventId: target.id, assetId, origin: "direct" }],
      links: { respondsTo: [target.id], derivedFrom: [target.id] },
      provenance: { origin: "declared", confidence: 1 },
    };
    validatePhase3EventEnvelope(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }

  contestAsset(
    assetId: string,
    reason: string,
    at?: string,
  ): EventAppendResult {
    return this.recordAssetControl("contest", assetId, {
      reason,
      ...(at === undefined ? {} : { at }),
    });
  }

  disableAsset(
    assetId: string,
    reason: string,
    at?: string,
  ): EventAppendResult {
    return this.recordAssetControl("disable", assetId, {
      reason,
      ...(at === undefined ? {} : { at }),
    });
  }

  restoreAsset(
    assetId: string,
    reason: string,
    at?: string,
  ): EventAppendResult {
    return this.recordAssetControl("restore", assetId, {
      reason,
      ...(at === undefined ? {} : { at }),
    });
  }

  forkAsset(
    assetId: string,
    newAssetId: string,
    reason: string,
    at?: string,
  ): EventAppendResult {
    return this.recordAssetControl("fork", assetId, {
      newAssetId,
      reason,
      ...(at === undefined ? {} : { at }),
    });
  }

  private findAssetEvent(assetId: string): EventRecord | null {
    const events = readAllEvents(this.#phase3Ports.events);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event === undefined || !event.type.startsWith("asset.")) continue;
      const payload = asJsonObject(event.payload);
      const candidate =
        typeof payload?.id === "string"
          ? payload.id
          : typeof payload?.assetId === "string"
            ? payload.assetId
            : undefined;
      if (candidate === assetId) return event;
    }
    return null;
  }

  getStructuredExpectation(expectationId: string): ExpectationRecord | null {
    return this.findStructuredExpectation(expectationId);
  }

  private findStructuredExpectation(
    expectationId: string,
  ): ExpectationRecord | null {
    const events = readAllEvents(this.#phase3Ports.events);
    const state = { expectations: {} } as {
      expectations: Record<string, ExpectationRecord & { cancelled?: boolean }>;
    };
    for (const event of events) {
      if (
        event.type === "expectation.created" ||
        event.type === "expectation.updated"
      ) {
        const payload = asJsonObject(event.payload);
        if (payload === null) continue;
        const { materialClassification: _classification, ...record } = payload;
        const parsed = parseExpectationRecord(record);
        const previous = state.expectations[parsed.id];
        if (event.type === "expectation.created" && previous !== undefined) {
          throw new Error(
            `expectation ${parsed.id} was created more than once`,
          );
        }
        state.expectations[parsed.id] = {
          ...parsed,
          ...(previous?.cancelled === true ? { cancelled: true } : {}),
        };
        continue;
      }
      if (event.type === "verification.completed") {
        const payload = asJsonObject(event.payload);
        const result = payload === null ? null : asJsonObject(payload.result);
        if (result === null || result.expectationId !== expectationId) continue;
        const previous = state.expectations[expectationId];
        if (previous === undefined) continue;
        const outcome = result.outcome;
        if (
          outcome === "satisfied" ||
          outcome === "violated" ||
          outcome === "unknown"
        ) {
          state.expectations[expectationId] = {
            ...previous,
            status: outcome,
            updatedAt:
              typeof result.observedAt === "string"
                ? result.observedAt
                : previous.updatedAt,
          };
        }
        continue;
      }
      if (event.type === "expectation.status.changed") {
        const payload = asJsonObject(event.payload);
        if (payload === null || payload.expectationId !== expectationId)
          continue;
        const previous = state.expectations[expectationId];
        if (
          previous === undefined ||
          previous.status !== payload.from ||
          !expectationStatusSchema.safeParse(payload.to).success
        ) {
          continue;
        }
        state.expectations[expectationId] = {
          ...previous,
          status: payload.to as ExpectationRecord["status"],
          updatedAt:
            typeof payload.changedAt === "string"
              ? payload.changedAt
              : previous.updatedAt,
        };
        continue;
      }
      if (event.type === "expectation.cancelled") {
        const payload = asJsonObject(event.payload);
        if (payload?.expectationId !== expectationId) continue;
        const previous = state.expectations[expectationId];
        if (previous !== undefined) {
          state.expectations[expectationId] = { ...previous, cancelled: true };
        }
      }
    }
    const record = state.expectations[expectationId];
    return record === undefined ? null : record;
  }

  private requireStructuredExpectation(
    expectationId: string,
  ): ExpectationRecord {
    const expectation = this.findStructuredExpectation(expectationId);
    if (expectation === null) {
      throw new Error("structured expectation is not recorded");
    }
    return expectation;
  }

  recordResiduals(residuals: Residual[]): EventAppendResult[] {
    const events = residuals.map((residual) =>
      residualDetectedEvent(this.#phase3Ports, residual),
    );
    events.forEach(validatePhase3EventEnvelope);
    return this.#phase3Ports.events.appendBatch(
      events,
      this.#phase3Ports.writer,
    );
  }

  recordReflectionProposal(
    residual: Residual,
    proposal: ReflectionResult,
  ): EventAppendResult {
    validateReflectionResult(proposal);
    if (proposal.residualId !== residual.id) {
      throw new Error("reflection proposal residualId does not match residual");
    }
    validateReflectionEvidenceDelta(this.#phase3Ports, proposal.evidenceDelta);
    const residualEventId = residualDetectedEventId(residual.id);
    const residualEvent = this.#phase3Ports.events.getById(residualEventId);
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

    assertResidualForRecording(this.#phase3Ports, residual);
    const recordedAt = deterministicReflectionTimestamp(
      this.#phase3Ports,
      residualEvent,
      proposal.evidenceDelta,
    );
    const proposalEventId = reflectionProposalEventId(
      residual.id,
      proposal.evidenceDelta.toSeq,
    );
    const previousProposal = validateReflectionRound(
      this.#phase3Ports,
      residualEvent,
      proposal,
      proposalEventId,
    );
    const proposalEvidence = mergeEvidence(
      residual.evidence,
      proposal.evidenceDelta.evidence,
      [{ eventId: residualEventId, origin: "inferred" }],
    );
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: proposalEventId,
      type: "reflection.proposed",
      occurredAt: recordedAt,
      observedAt: recordedAt,
      recordedAt,
      actor: this.#phase3Ports.actor,
      operationId: `reflection:${residual.id}:${proposal.evidenceDelta.toSeq}`,
      source: { kind: "reflection-controller", ref: residual.id },
      payload: reflectionProposalPayload(residual, proposal),
      evidence: proposalEvidence,
      links: {
        respondsTo: [residualEventId],
        derivedFrom: uniqueStrings([
          residualEventId,
          ...eventIdsFromEvidence(residual.evidence),
          ...eventIdsFromEvidence(proposal.evidenceDelta.evidence),
        ]),
        ...(previousProposal === null
          ? {}
          : { supersedes: [previousProposal.id] }),
      },
      provenance: { origin: "inferred", confidence: residual.confidence },
    };
    validatePhase3EventEnvelope(event);
    return this.#phase3Ports.events.append(event, this.#phase3Ports.writer);
  }
}

function residualDetectedEvent(
  ports: Phase3RuntimePorts,
  residual: Residual,
): EventEnvelope {
  assertResidualForRecording(ports, residual);
  const occurredAt = residual.detectedAt;
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id: residualDetectedEventId(residual.id),
    type: "residual.detected",
    occurredAt,
    observedAt: occurredAt,
    recordedAt: occurredAt,
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
    budget: proposal.budget,
    budgetUsed: proposal.budgetUsed,
    evidenceDelta: {
      fromSeq: proposal.evidenceDelta.fromSeq,
      toSeq: proposal.evidenceDelta.toSeq,
      evidence: proposal.evidenceDelta.evidence.map(evidencePayload),
    },
  } as unknown as JsonObject;
}

function expectationPayload(expectation: Expectation): JsonObject {
  return {
    materialClassification: "declared",
    expectationId: expectation.id,
    subject: {
      kind: expectation.subject.kind,
      id: expectation.subject.id,
    },
    expected: expectation.expected,
    verification: expectation.verification,
    ...(expectation.predicateId === undefined
      ? {}
      : { predicateId: expectation.predicateId }),
    createdAt: expectation.createdAt,
    ...(expectation.validUntil === undefined
      ? {}
      : { validUntil: expectation.validUntil }),
    evidence: expectation.evidence.map(evidencePayload),
  } as unknown as JsonObject;
}

function structuredExpectationPayload(
  expectation: ExpectationRecord,
): JsonObject {
  return {
    materialClassification: "declared",
    id: expectation.id,
    ...(expectation.traceId === undefined
      ? {}
      : { traceId: expectation.traceId }),
    source: expectation.source,
    subject: expectation.subject,
    expected: expectation.expected,
    verification: expectation.verification,
    createdAt: expectation.createdAt,
    validFrom: expectation.validFrom,
    ...(expectation.evaluateBy === undefined
      ? {}
      : { evaluateBy: expectation.evaluateBy }),
    ...(expectation.expiresAt === undefined
      ? {}
      : { expiresAt: expectation.expiresAt }),
    status: expectation.status,
    evidence: expectation.evidence.map(evidencePayload),
    updatedAt: expectation.updatedAt,
  } as unknown as JsonObject;
}

function verificationResultPayload(result: VerificationResult): JsonObject {
  return {
    id: result.id,
    expectationId: result.expectationId,
    verifier: result.verifier,
    observedAt: result.observedAt,
    outcome: result.outcome,
    evidence: result.evidence.map(evidencePayload),
    ...(result.details === undefined ? {} : { details: result.details }),
  } as unknown as JsonObject;
}

function validatePhase35ExpectationEvent(event: EventEnvelope): void {
  const payload = asJsonObject(event.payload);
  if (payload === null || payload.materialClassification !== "declared") {
    throw new Error("expectation lifecycle events require declared material");
  }
  if (
    event.type === "expectation.created" ||
    event.type === "expectation.updated"
  ) {
    const { materialClassification: _classification, ...record } = payload;
    parseExpectationRecord(record);
    return;
  }
  if (event.type === "verification.completed") {
    const result = payload.result;
    if (result === undefined)
      throw new Error("verification.completed has no result");
    parseVerificationResult(result);
    return;
  }
  if (event.type === "verification.requested") {
    if (
      typeof payload.expectationId !== "string" ||
      typeof payload.requestId !== "string" ||
      typeof payload.requestedAt !== "string" ||
      typeof payload.mode !== "string" ||
      payload.verifier === undefined
    ) {
      throw new Error("verification.requested payload is incomplete");
    }
    return;
  }
  if (event.type === "expectation.cancelled") {
    if (
      typeof payload.expectationId !== "string" ||
      typeof payload.cancelledAt !== "string" ||
      typeof payload.reason !== "string" ||
      payload.reason.length === 0
    ) {
      throw new Error("expectation.cancelled payload is incomplete");
    }
    return;
  }
  if (event.type === "expectation.status.changed") {
    if (
      typeof payload.expectationId !== "string" ||
      typeof payload.from !== "string" ||
      typeof payload.to !== "string" ||
      typeof payload.changedAt !== "string" ||
      typeof payload.reason !== "string" ||
      payload.reason.length === 0
    ) {
      throw new Error("expectation.status.changed payload is incomplete");
    }
  }
}

function assertExpectationTime(value: string, field: string): void {
  assertCanonicalTimestamp(value, field);
}

function assertVerificationWindow(
  expectation: ExpectationRecord,
  observedAt: string,
): void {
  assertCanonicalTimestamp(observedAt, "verification observedAt");
  if (Date.parse(observedAt) < Date.parse(expectation.validFrom)) {
    throw new Error("verification cannot precede expectation validFrom");
  }
  if (
    expectation.expiresAt !== undefined &&
    Date.parse(observedAt) > Date.parse(expectation.expiresAt)
  ) {
    throw new Error(
      "verification is outside the expectation window; expired is not violated",
    );
  }
}

function assertHumanWriter(writer: WriterContext): void {
  authorizeHumanControl(writer, "expectation human control", "event.append");
}

function assertHumanActor(actor: ActorRef): void {
  if (actor.type !== "human") {
    throw new AuthorizationError("human control requires a human actor", {
      actor,
    });
  }
}

function readAllEvents(reader: EventReader): EventRecord[] {
  const events: EventRecord[] = [];
  let afterSeq = 0;
  while (true) {
    const batch = reader.query({ afterSeq, limit: 10_000 });
    if (batch.length === 0) break;
    events.push(...batch);
    const last = batch.at(-1);
    if (last === undefined || last.seq <= afterSeq) {
      throw new Error("event reader did not advance while paginating");
    }
    afterSeq = last.seq;
    if (batch.length < 10_000) break;
  }
  return events;
}

function structuredExpectationToLegacy(
  expectation: ExpectationRecord,
): Expectation {
  return {
    id: expectation.id,
    ...(expectation.traceId === undefined
      ? {}
      : { traceId: expectation.traceId }),
    subject: expectation.subject,
    expected: expectation.expected,
    verification: "predicate",
    predicateId: `structured:${expectation.id}`,
    createdAt: expectation.createdAt,
    ...(expectation.expiresAt === undefined
      ? {}
      : { validUntil: expectation.expiresAt }),
    evidence: expectation.evidence.map(copyEvidenceRef),
  };
}

function assertStructuredVerificationWasRecorded(
  ports: Phase3RuntimePorts,
  result: VerificationResult,
): void {
  const event = ports.events.getById(verificationCompletedEventId(result.id));
  if (event === null || event.type !== "verification.completed") {
    throw new Error(
      "structured outcome residual requires a recorded verification.completed event",
    );
  }
  const payload = asJsonObject(event.payload);
  const recorded = payload === null ? null : asJsonObject(payload.result);
  if (recorded === null) {
    throw new Error("recorded structured verification result is malformed");
  }
  const normalized = parseVerificationResult(recorded);
  if (
    stableStringify(normalized as unknown as JsonValue) !==
    stableStringify(result as unknown as JsonValue)
  ) {
    throw new Error(
      "structured outcome residual verification does not match the recorded result",
    );
  }
}

function residualPayload(residual: Residual): JsonObject {
  return {
    materialClassification: "inferred",
    residualId: residual.id,
    kind: residual.kind,
    ...(residual.baselineId === undefined
      ? {}
      : { baselineId: residual.baselineId }),
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function assertResidualForRecording(
  ports: Phase3RuntimePorts,
  residual: Residual,
): void {
  if (residual.id.length < 1) throw new Error("residual id is required");
  if (residual.evidence.length < 1) {
    throw new Error("residual recording requires evidence");
  }
  if (residual.effect !== "unknown") {
    throw new Error(
      "residual recording requires an unknown effect until explicit adjudication",
    );
  }
  if (
    residual.kind === "outcome" &&
    (residual.baselineId === undefined || residual.baselineId.length < 1)
  ) {
    throw new Error("outcome residual recording requires baselineId");
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
  if (residual.kind === "outcome") {
    const baselineId = residual.baselineId!;
    const legacyExpectationEvent = ports.events.getById(
      expectationRegisteredEventId(baselineId),
    );
    let registeredSubject: JsonValue | undefined;
    let registeredExpected: JsonValue | undefined;
    let registered = false;
    if (
      legacyExpectationEvent !== null &&
      legacyExpectationEvent.type === "expectation.registered" &&
      legacyExpectationEvent.operationId === baselineId &&
      legacyExpectationEvent.provenance.origin === "declared"
    ) {
      const expectation = asJsonObject(legacyExpectationEvent.payload);
      registeredSubject = expectation?.subject;
      registeredExpected = expectation?.expected;
      registered = expectation?.expectationId === baselineId;
    } else {
      const structuredEvent = ports.events.getById(
        expectationCreatedEventId(baselineId),
      );
      if (
        structuredEvent !== null &&
        structuredEvent.type === "expectation.created" &&
        structuredEvent.provenance.origin === "declared"
      ) {
        const payload = asJsonObject(structuredEvent.payload);
        if (payload !== null) {
          const { materialClassification: _classification, ...record } =
            payload;
          const structured = parseExpectationRecord(record);
          registeredSubject = structured.subject;
          registeredExpected = structured.expected;
          registered = structured.id === baselineId;
        }
      }
    }
    if (
      !registered ||
      residual.baseline === undefined ||
      registeredSubject === undefined ||
      registeredExpected === undefined ||
      stableStringify(registeredSubject) !==
        stableStringify({
          kind: residual.baseline.kind,
          id: residual.baseline.id,
        }) ||
      stableStringify(registeredExpected) !==
        stableStringify(residual.baseline.value)
    ) {
      throw new Error(
        "outcome residual baseline does not match the recorded expectation",
      );
    }
  }
  if (residual.kind === "timing") {
    assertTimingResidualForRecording(ports, residual);
  }
}

function assertExpectationForRecording(
  ports: Phase3RuntimePorts,
  expectation: Expectation,
): void {
  if (expectation.id.length < 1) throw new Error("expectation id is required");
  if (
    expectation.subject.kind.length < 1 ||
    expectation.subject.id.length < 1
  ) {
    throw new Error("expectation subject must have a kind and id");
  }
  if (
    expectation.verification !== "exact" &&
    expectation.verification !== "predicate" &&
    expectation.verification !== "external"
  ) {
    throw new Error("expectation verification is invalid");
  }
  if (expectation.verification === "predicate" && !expectation.predicateId) {
    throw new Error("predicate expectations require predicateId");
  }
  assertCanonicalTimestamp(expectation.createdAt, "expectation createdAt");
  if (expectation.validUntil !== undefined) {
    assertCanonicalTimestamp(expectation.validUntil, "expectation validUntil");
    if (
      Date.parse(expectation.validUntil) < Date.parse(expectation.createdAt)
    ) {
      throw new Error("expectation validUntil cannot precede createdAt");
    }
  }
  assertEvidenceRefs(ports, expectation.evidence, "expectation");
}

function assertEvidenceRefs(
  ports: Phase3RuntimePorts,
  evidence: EvidenceRef[],
  label: string,
): void {
  if (evidence.length < 1) throw new Error(`${label} requires evidence`);
  for (const item of evidence) {
    if (
      item.eventId === undefined &&
      item.assetId === undefined &&
      item.artifactHash === undefined
    ) {
      throw new Error(`${label} evidence must identify a source`);
    }
    if (item.eventId === undefined) continue;
    const sourceEvent = ports.events.getById(item.eventId);
    if (sourceEvent === null) {
      throw new Error(`${label} evidence event is not present in the ledger`);
    }
    if (sourceEvent.provenance.origin !== item.origin) {
      throw new Error(
        `${label} evidence origin does not match ledger provenance`,
      );
    }
  }
}

function validateTimingInputsAgainstLedger(
  ports: Phase3RuntimePorts,
  timings: TimingDetectionInput[],
): void {
  const lastSeq = ports.events.getLastSeq();
  for (const timing of timings) {
    if (timing.latestRelevantSeq > lastSeq) {
      throw new Error(
        "timing latest relevant sequence is ahead of the event ledger",
      );
    }
    const eventEvidence = timing.evidence.filter(
      (item) => item.eventId !== undefined,
    );
    if (eventEvidence.length === 0) {
      throw new Error(
        "timing detection requires a ledger event evidence reference",
      );
    }
    if (
      !eventEvidence.some((item) => {
        const source = ports.events.getById(item.eventId!);
        return source?.seq === timing.latestRelevantSeq;
      })
    ) {
      throw new Error(
        "timing evidence does not identify the latest relevant ledger event",
      );
    }
  }
}

function assertTimingResidualForRecording(
  ports: Phase3RuntimePorts,
  residual: Residual,
): void {
  const observed = asJsonObject(residual.observed.value);
  const cursorSeq = observed?.cursorSeq;
  const latestRelevantSeq = observed?.latestRelevantSeq;
  if (
    typeof cursorSeq !== "number" ||
    !Number.isSafeInteger(cursorSeq) ||
    cursorSeq < 0 ||
    typeof latestRelevantSeq !== "number" ||
    !Number.isSafeInteger(latestRelevantSeq) ||
    latestRelevantSeq < cursorSeq
  ) {
    throw new Error("timing residual cursor evidence is invalid");
  }
  const lastSeq = ports.events.getLastSeq();
  if (latestRelevantSeq > lastSeq) {
    throw new Error(
      "timing residual latest relevant sequence is ahead of the event ledger",
    );
  }
  const matchesLatest = residual.evidence.some((item) => {
    if (item.eventId === undefined) return false;
    const source = ports.events.getById(item.eventId);
    return source?.seq === latestRelevantSeq;
  });
  if (!matchesLatest) {
    throw new Error(
      "timing residual evidence does not identify the latest relevant ledger event",
    );
  }
}

function validateReflectionEvidenceDelta(
  ports: Phase3RuntimePorts,
  delta: ReflectionEvidenceDelta,
): void {
  if (
    !Number.isSafeInteger(delta.fromSeq) ||
    delta.fromSeq < 0 ||
    !Number.isSafeInteger(delta.toSeq) ||
    delta.toSeq < 0
  ) {
    throw new Error(
      "reflection evidence cursor must be a non-negative safe integer",
    );
  }
  if (delta.toSeq < delta.fromSeq) {
    throw new Error("reflection evidence toSeq cannot precede fromSeq");
  }
  const lastSeq = ports.events.getLastSeq();
  if (delta.toSeq > lastSeq) {
    throw new Error("reflection evidence cursor is ahead of the event ledger");
  }
  if (delta.fromSeq > lastSeq) {
    throw new Error("reflection evidence fromSeq is ahead of the event ledger");
  }
  if (delta.toSeq > delta.fromSeq && delta.evidence.length === 0) {
    throw new Error("reflection evidence delta requires evidence");
  }
  if (delta.toSeq === delta.fromSeq && delta.evidence.length > 0) {
    throw new Error("reflection evidence without a sequence delta is invalid");
  }
  if (delta.toSeq === delta.fromSeq) return;
  const eventEvidence = delta.evidence.filter(
    (item) => item.eventId !== undefined,
  );
  if (eventEvidence.length === 0) {
    throw new Error(
      "reflection evidence delta requires a ledger event reference",
    );
  }
  for (const item of eventEvidence) {
    const sourceEvent = ports.events.getById(item.eventId!);
    if (sourceEvent === null) {
      throw new Error("reflection evidence event is not present in the ledger");
    }
    if (sourceEvent.seq <= delta.fromSeq || sourceEvent.seq > delta.toSeq) {
      throw new Error(
        "reflection evidence event is outside its sequence delta",
      );
    }
    if (sourceEvent.provenance.origin !== item.origin) {
      throw new Error(
        "reflection evidence origin does not match ledger provenance",
      );
    }
  }
}

function validateReflectionRound(
  ports: Phase3RuntimePorts,
  residualEvent: EventRecord,
  proposal: ReflectionResult,
  proposalEventId: string,
): EventRecord | null {
  const existing = ports.events.getById(proposalEventId);
  if (existing !== null) {
    if (
      existing.type !== "reflection.proposed" ||
      existing.operationId !==
        `reflection:${proposal.residualId}:${proposal.evidenceDelta.toSeq}`
    ) {
      throw new Error(
        "reflection proposal id is already used by another event",
      );
    }
    return null;
  }

  const previous = ports.events
    .query({ type: "reflection.proposed", limit: 10_000 })
    .filter((event) => {
      const payload = asJsonObject(event.payload);
      const delta = asJsonObject(payload?.evidenceDelta);
      return (
        payload?.residualId === proposal.residualId &&
        delta !== null &&
        typeof delta.toSeq === "number"
      );
    })
    .sort((left, right) => left.seq - right.seq)
    .at(-1);

  if (previous === undefined) {
    if (proposal.evidenceDelta.fromSeq !== residualEvent.seq) {
      throw new Error(
        "first reflection round must start at the residual event cursor",
      );
    }
    return null;
  }

  const previousPayload = asJsonObject(previous.payload);
  const previousDelta = asJsonObject(previousPayload?.evidenceDelta);
  const previousToSeq = previousDelta?.toSeq;
  if (typeof previousToSeq !== "number") {
    throw new Error("recorded reflection round has no valid end cursor");
  }
  if (proposal.evidenceDelta.fromSeq !== previousToSeq) {
    throw new Error(
      "reflection round must start at the previous accepted end cursor",
    );
  }
  if (proposal.evidenceDelta.toSeq <= previousToSeq) {
    throw new Error("reflection round cursor must advance monotonically");
  }
  return previous;
}

function deterministicReflectionTimestamp(
  ports: Phase3RuntimePorts,
  residualEvent: EventRecord,
  delta: ReflectionEvidenceDelta,
): string {
  let timestamp = Date.parse(residualEvent.recordedAt);
  for (const item of delta.evidence) {
    if (item.eventId === undefined) continue;
    const source = ports.events.getById(item.eventId);
    if (source === null) continue;
    timestamp = Math.max(timestamp, Date.parse(source.recordedAt));
  }
  return new Date(timestamp).toISOString();
}

function mergeEvidence(...groups: EvidenceRef[][]): EvidenceRef[] {
  const result: EvidenceRef[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      const key = stableStringify(evidencePayload(item));
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(copyEvidenceRef(item));
    }
  }
  return result;
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

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM" || code === "EACCES";
  }
}

export type RuntimeMode = "embedded" | "daemon";

export interface WriterLockMetadata {
  pid: number;
  mode: RuntimeMode;
  startedAt: string;
  dbPath: string;
}

export interface WriterLockRecord extends WriterLockMetadata {
  token: string;
}

export class WriterLockError extends Error {
  readonly code = "WRITER_LOCK_CONFLICT" as const;

  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WriterLockError";
  }
}

export class WriterOwnershipLock {
  readonly path: string;
  #token: string | undefined;

  constructor(path: string) {
    this.path = resolve(path);
  }

  inspect(): WriterLockRecord | null {
    if (!existsSync(this.path)) return null;
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as Record<
        string,
        unknown
      >;
      if (
        typeof value.token !== "string" ||
        typeof value.pid !== "number" ||
        !Number.isSafeInteger(value.pid) ||
        (value.mode !== "embedded" && value.mode !== "daemon") ||
        typeof value.startedAt !== "string" ||
        typeof value.dbPath !== "string"
      ) {
        return null;
      }
      return {
        token: value.token,
        pid: value.pid,
        mode: value.mode,
        startedAt: value.startedAt,
        dbPath: value.dbPath,
      };
    } catch {
      return null;
    }
  }

  clearStale(expectedToken: string): boolean {
    const record = this.inspect();
    if (record === null) return false;
    if (record.token !== expectedToken) {
      throw new WriterLockError(
        "writer lock token does not match the requested stale-lock clear",
        { path: this.path },
      );
    }
    if (record.pid === process.pid || isProcessAlive(record.pid)) {
      throw new WriterLockError(
        "writer lock is still owned by a live process; it was preserved",
        { path: this.path, pid: record.pid },
      );
    }
    unlinkSync(this.path);
    return true;
  }

  acquire(metadata: WriterLockMetadata): void {
    if (this.#token !== undefined) return;
    const token = randomUUID();
    const record = JSON.stringify({ ...metadata, token });
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = openSync(this.path, "wx");
      writeSync(fileDescriptor, record, undefined, "utf8");
      closeSync(fileDescriptor);
      fileDescriptor = undefined;
      this.#token = token;
    } catch (error) {
      if (fileDescriptor !== undefined) closeSync(fileDescriptor);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        let existing: string | undefined;
        try {
          existing = readFileSync(this.path, "utf8");
        } catch {
          existing = undefined;
        }
        throw new WriterLockError(
          "another runtime already owns the database writer lock",
          { path: this.path, existing },
        );
      }
      throw new WriterLockError("could not acquire the database writer lock", {
        path: this.path,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  isHeld(): boolean {
    if (this.#token === undefined || !existsSync(this.path)) return false;
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as {
        token?: unknown;
      };
      return value.token === this.#token;
    } catch {
      return false;
    }
  }

  release(): void {
    const token = this.#token;
    if (token === undefined) return;
    this.#token = undefined;
    if (!existsSync(this.path)) return;
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as {
        token?: unknown;
      };
      if (value.token !== token) {
        throw new WriterLockError(
          "writer lock changed ownership before release; lock was preserved",
          { path: this.path },
        );
      }
      unlinkSync(this.path);
    } catch (error) {
      if (error instanceof WriterLockError) throw error;
      throw new WriterLockError("could not release the database writer lock", {
        path: this.path,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export interface RuntimeCompositionOptions {
  store: RuntimeStore;
  actor: ActorRef;
  writer: WriterContext;
  mode: RuntimeMode;
  clock?: Clock;
  ids?: IdGenerator;
  lockPath?: string;
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "fail" | "info";
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeDoctorReport {
  status: "pass" | "fail";
  checks: DoctorCheck[];
  health: StoreHealth;
}

export class RuntimeCompositionRoot {
  readonly #store: RuntimeStore;
  readonly lock: WriterOwnershipLock;
  readonly writer: WriterContext;
  readonly runtime: Phase3Runtime;
  readonly mode: RuntimeMode;
  readonly clock: Clock;
  #started = false;

  constructor(options: RuntimeCompositionOptions) {
    this.#store = options.store;
    this.writer = parseWriterContext(options.writer);
    this.mode = options.mode;
    this.clock = options.clock ?? { now: () => new Date() };
    this.lock = new WriterOwnershipLock(
      options.lockPath ?? `${options.store.filename}.writer.lock`,
    );
    this.runtime = new Phase3Runtime({
      events: this.#store,
      projections: this.#store,
      clock: this.clock,
      ids: options.ids ?? { next: () => randomUUID() },
      actor: options.actor,
      writer: this.writer,
    });
  }

  start(): this {
    if (this.#started) return this;
    this.lock.acquire({
      pid: process.pid,
      mode: this.mode,
      startedAt: this.clock.now().toISOString(),
      dbPath: resolve(this.#store.filename),
    });
    this.#started = true;
    return this;
  }

  close(): void {
    if (!this.#started) {
      this.#store.close();
      return;
    }
    try {
      this.#store.close();
    } finally {
      this.lock.release();
      this.#started = false;
    }
  }

  catchUpCoreProjections(): CatchUpResult[] {
    this.assertStarted();
    return this.runtime.catchUpCoreProjections();
  }

  rebuildCoreProjections(): CatchUpResult[] {
    this.assertStarted();
    return createCoreProjections().map((projection) =>
      this.runtime.rebuild(projection),
    );
  }

  createManagedBackup(
    destinationPath: string,
    options: { id?: string; createdAt?: number } = {},
  ): BackupManifest {
    this.assertStarted();
    return this.#store.createManagedBackup(
      destinationPath,
      this.writer,
      options,
    );
  }

  backupTo(
    destinationPath: string,
    options: BackupOptions = {},
  ): BackupManifest {
    this.assertStarted();
    authorizeWriterScope(this.writer, "history.export", "backup creation");
    return this.#store.backupTo(destinationPath, options);
  }

  listManagedBackups(): ManagedBackup[] {
    this.assertStarted();
    authorizeWriterScope(this.writer, "history.export", "backup listing");
    return this.#store.listManagedBackups();
  }

  get databasePath(): string {
    return resolve(this.#store.filename);
  }

  inspectEvent(eventId: string): EventRecord | null {
    this.assertStarted();
    authorizeWriterScope(this.writer, "event.read", "inspect event");
    if (eventId.length < 1) throw new Error("event id is required");
    return this.#store.getById(eventId);
  }

  exportEvents(query: EventQuery = {}): EventRecord[] {
    this.assertStarted();
    authorizeWriterScope(this.writer, "history.export", "export event history");
    return this.#store.query(query);
  }

  planPrivacyPurge(sessionId: string): PrivacyPurgePlan {
    this.assertStarted();
    return this.#store.planPrivacyPurge(sessionId);
  }

  privacyPurge(
    sessionId: string,
    options: PrivacyPurgeOptions = {},
  ): RuntimePrivacyPurgeResult {
    this.assertStarted();
    const result = this.#store.privacyPurge(sessionId, this.writer, options);
    if (result.dryRun || result.receipt === undefined) return result;
    return {
      ...result,
      projectionRebuild: this.rebuildCoreProjections(),
    };
  }

  finalizePendingPurge(): PurgeCleanupResult {
    this.assertStarted();
    return this.#store.finalizePendingPurge(this.writer);
  }

  getHealth(): StoreHealth {
    this.assertStarted();
    return this.#store.getHealth();
  }

  doctor(): RuntimeDoctorReport {
    this.assertStarted();
    const health = this.#store.getHealth();
    const checks: DoctorCheck[] = [
      {
        name: "writer-lock",
        status: this.lock.isHeld() ? "pass" : "fail",
        message: this.lock.isHeld()
          ? "canonical writer lock is held"
          : "canonical writer lock is not held",
        details: { path: this.lock.path, mode: this.mode },
      },
      {
        name: "sqlite-wal",
        status:
          health.pragmas.journalMode === "wal" &&
          health.pragmas.foreignKeys === 1 &&
          health.pragmas.synchronous === 2
            ? "pass"
            : "fail",
        message:
          "SQLite WAL, foreign keys, and FULL synchronous mode are checked",
        details: health.pragmas as unknown as Record<string, unknown>,
      },
      {
        name: "writer-provenance",
        status: health.writerBackfillCount === 0 ? "pass" : "fail",
        message:
          health.writerBackfillCount === 0
            ? "all ledger rows have writer provenance"
            : "ledger rows are missing writer provenance",
        details: { backfillCount: health.writerBackfillCount },
      },
      {
        name: "wal-checkpoint",
        status: health.walCheckpoint.busy === 0 ? "pass" : "fail",
        message:
          health.walCheckpoint.busy === 0
            ? "WAL checkpoint is not blocked"
            : "WAL checkpoint reports a busy database",
        details: health.walCheckpoint,
      },
      {
        name: "orphan-verification",
        status: health.orphanVerificationCount === 0 ? "pass" : "fail",
        message:
          health.orphanVerificationCount === 0
            ? "verification results have expectation parents"
            : "orphan verification results were found",
        details: { count: health.orphanVerificationCount },
      },
      {
        name: "purge-state",
        status: health.pendingPurgeCount === 0 ? "pass" : "fail",
        message:
          health.pendingPurgeCount === 0
            ? "no pending purge authorization or backup cleanup exists"
            : "purge cleanup is pending",
        details: { count: health.pendingPurgeCount },
      },
      {
        name: "managed-backup-integrity",
        status:
          health.managedBackups.missingFiles.length === 0 &&
          health.managedBackups.invalidChecksums.length === 0
            ? "pass"
            : "fail",
        message: "managed backup paths and checksums are checked",
        details: health.managedBackups,
      },
      {
        name: "asset-provenance",
        status: "info",
        message: "purge-invalidated asset provenance is retained in receipts",
        details: { invalidatedAssetCount: health.invalidatedAssetCount },
      },
    ];
    const expectedProjectionNames = [
      "project",
      "rules",
      "assets",
      "agents",
      "expectations_current",
    ];
    const projectionByName = new Map(
      health.projections.map((projection) => [
        projection.projectionName,
        projection,
      ]),
    );
    for (const name of expectedProjectionNames) {
      const projection = projectionByName.get(name);
      if (projection === undefined) {
        checks.push({
          name: `projection:${name}`,
          status: health.lastSeq === 0 ? "info" : "fail",
          message:
            health.lastSeq === 0
              ? "projection is not initialized on an empty ledger"
              : "projection state is missing while the ledger is non-empty",
        });
        continue;
      }
      checks.push({
        name: `projection:${name}`,
        status: projection.lag === 0 ? "pass" : "fail",
        message:
          projection.lag === 0
            ? "projection cursor is caught up"
            : "projection cursor lags behind the event ledger",
        details: projection as unknown as Record<string, unknown>,
      });
    }
    return {
      status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
      checks,
      health,
    };
  }

  private assertStarted(): void {
    if (!this.#started) {
      throw new WriterLockError("runtime composition root is not started");
    }
  }
}
