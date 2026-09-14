import type {
  ActorRef,
  EventRecord,
  EvidenceRef,
  JsonObject,
  JsonValue,
} from "@praxis/contracts";
import { stableStringify } from "@praxis/contracts";

export type ResidualKind =
  | "outcome"
  | "timing"
  | "rule"
  | "representation"
  | "relation"
  | "retrospective";

export type ResidualEffect = "harmful" | "productive" | "neutral" | "unknown";

export type ResidualPersistence = "transient" | "repeated" | "persistent";

export interface ResidualSubject {
  kind: string;
  id: string;
}

export interface ResidualReference extends ResidualSubject {
  value: JsonValue;
}

export interface RuleRef {
  id: string;
  requiredEventTypes?: string[];
  requiredCheckpoints?: string[];
}

export interface FieldContext {
  taskType?: string;
  externalVerification: "strong" | "medium" | "weak";
  consequence: "low" | "medium" | "high";
  reversibility: "easy" | "partial" | "hard";
  feedbackLatency: "short" | "medium" | "long";
  actors: ActorRef[];
  explicitRules: RuleRef[];
}

export type ExpectationVerification = "exact" | "predicate" | "external";

export interface Expectation {
  id: string;
  traceId?: string;
  subject: ResidualSubject;
  expected: JsonValue;
  verification: ExpectationVerification;
  predicateId?: string;
  createdAt: string;
  validUntil?: string;
  evidence: EvidenceRef[];
}

export interface OutcomeObservation {
  id: string;
  traceId?: string;
  subject: ResidualSubject;
  actual: JsonValue;
  observedAt: string;
  evidence: EvidenceRef[];
}

export interface ExplicitOutcomeVerification {
  matches: boolean;
  confidence: number;
  explanation: string;
  evidence: EvidenceRef[];
}

export interface OutcomeDetectionInput {
  expectation: Expectation;
  observation: OutcomeObservation;
  field: FieldContext;
  detectedAt: string;
  verification?: ExplicitOutcomeVerification;
  persistence?: ResidualPersistence;
}

export interface TimingThreshold {
  minSeqLag: number;
  maxStalenessMs: number;
}

export interface TimingDetectionInput {
  id: string;
  subject: ResidualSubject;
  agentId: string;
  cursorSeq: number;
  latestRelevantSeq: number;
  observedAt: string;
  detectedAt: string;
  subscribed: boolean;
  threshold: TimingThreshold;
  field: FieldContext;
  evidence: EvidenceRef[];
  persistence?: ResidualPersistence;
}

export interface RuleDetectionInput {
  id: string;
  traceId: string;
  rule: RuleRef;
  events: EventRecord[];
  field: FieldContext;
  detectedAt: string;
  evidence: EvidenceRef[];
  persistence?: ResidualPersistence;
}

export interface ResidualDetectionBatch {
  outcomes?: OutcomeDetectionInput[];
  timings?: TimingDetectionInput[];
  rules?: RuleDetectionInput[];
}

export interface Residual {
  id: string;
  kind: ResidualKind;
  baseline?: ResidualReference;
  observed: ResidualReference;
  field: FieldContext;
  magnitude?: number;
  confidence: number;
  persistence: ResidualPersistence;
  effect: ResidualEffect;
  evidence: EvidenceRef[];
  detectedAt: string;
}

export class ResidualDetector {
  detect(input: ResidualDetectionBatch): Residual[] {
    const residuals: Residual[] = [];
    for (const outcome of input.outcomes ?? []) {
      const residual = this.detectOutcome(outcome);
      if (residual !== null) residuals.push(residual);
    }
    for (const timing of input.timings ?? []) {
      const residual = this.detectTiming(timing);
      if (residual !== null) residuals.push(residual);
    }
    for (const rule of input.rules ?? []) {
      const residual = this.detectRule(rule);
      if (residual !== null) residuals.push(residual);
    }
    return residuals;
  }

  detectOutcome(input: OutcomeDetectionInput): Residual | null {
    validateExpectation(input.expectation);
    validateOutcomeObservation(input.observation);
    validateFieldContext(input.field);
    assertCanonicalTimestamp(input.detectedAt, "detectedAt");
    if (
      input.expectation.traceId !== undefined &&
      input.observation.traceId !== input.expectation.traceId
    ) {
      throw new Error("outcome expectation and observation traceId differ");
    }
    if (
      input.expectation.subject.kind !== input.observation.subject.kind ||
      input.expectation.subject.id !== input.observation.subject.id
    ) {
      throw new Error("outcome expectation and observation subjects differ");
    }

    const verification = resolveOutcomeVerification(input);
    if (verification.matches) return null;

    const evidence = [
      ...copyEvidence(input.expectation.evidence),
      ...copyEvidence(input.observation.evidence),
      ...copyEvidence(verification.evidence),
    ];
    assertEvidence(evidence, "outcome residual");
    return {
      id: `residual:outcome:${encodeURIComponent(input.expectation.id)}:${encodeURIComponent(input.observation.id)}`,
      kind: "outcome",
      baseline: toReference(
        input.expectation.subject,
        input.expectation.expected,
      ),
      observed: toReference(
        input.observation.subject,
        input.observation.actual,
      ),
      field: copyFieldContext(input.field),
      magnitude: calculateMagnitude(
        input.expectation.expected,
        input.observation.actual,
      ),
      confidence: verification.confidence,
      persistence: input.persistence ?? "transient",
      effect: "unknown",
      evidence,
      detectedAt: input.detectedAt,
    };
  }

  detectTiming(input: TimingDetectionInput): Residual | null {
    validateSubject(input.subject, "timing subject");
    validateFieldContext(input.field);
    validateEvidence(input.evidence, "timing detection");
    assertCanonicalTimestamp(input.observedAt, "timing observedAt");
    assertCanonicalTimestamp(input.detectedAt, "timing detectedAt");
    assertNonNegativeSafeInteger(input.cursorSeq, "cursorSeq");
    assertNonNegativeSafeInteger(input.latestRelevantSeq, "latestRelevantSeq");
    if (input.latestRelevantSeq < input.cursorSeq) {
      throw new Error("latestRelevantSeq cannot be behind cursorSeq");
    }
    assertNonNegativeSafeInteger(input.threshold.minSeqLag, "minSeqLag");
    assertNonNegativeSafeInteger(
      input.threshold.maxStalenessMs,
      "maxStalenessMs",
    );
    const observedMilliseconds = Date.parse(input.observedAt);
    const detectedMilliseconds = Date.parse(input.detectedAt);
    if (detectedMilliseconds < observedMilliseconds) {
      throw new Error("timing detectedAt cannot precede observedAt");
    }
    const seqLag = input.latestRelevantSeq - input.cursorSeq;
    const stalenessMs = detectedMilliseconds - observedMilliseconds;
    if (
      !input.subscribed ||
      seqLag <= input.threshold.minSeqLag ||
      stalenessMs <= input.threshold.maxStalenessMs
    ) {
      return null;
    }

    const observedValue: JsonObject = {
      agentId: input.agentId,
      cursorSeq: input.cursorSeq,
      latestRelevantSeq: input.latestRelevantSeq,
      seqLag,
      observedAt: input.observedAt,
      detectedAt: input.detectedAt,
      stalenessMs,
    };
    const baselineValue: JsonObject = {
      subscribed: true,
      minSeqLag: input.threshold.minSeqLag,
      maxStalenessMs: input.threshold.maxStalenessMs,
    };
    return {
      id: `residual:timing:${encodeURIComponent(input.agentId)}:${encodeURIComponent(input.id)}`,
      kind: "timing",
      baseline: toReference(input.subject, baselineValue),
      observed: toReference(input.subject, observedValue),
      field: copyFieldContext(input.field),
      magnitude: Math.min(
        1,
        Math.max(
          seqLag / Math.max(input.threshold.minSeqLag + 1, 1),
          stalenessMs / Math.max(input.threshold.maxStalenessMs + 1, 1),
        ),
      ),
      confidence: 1,
      persistence: input.persistence ?? "transient",
      effect: "unknown",
      evidence: copyEvidence(input.evidence),
      detectedAt: input.detectedAt,
    };
  }

  detectRule(input: RuleDetectionInput): Residual | null {
    validateRule(input.rule);
    validateSubject({ kind: "rule", id: input.rule.id }, "rule subject");
    validateFieldContext(input.field);
    validateEvidence(input.evidence, "rule detection");
    assertCanonicalTimestamp(input.detectedAt, "detectedAt");
    if (input.traceId.length < 1) throw new Error("traceId must not be empty");

    const requiredEventTypes = input.rule.requiredEventTypes ?? [];
    const requiredCheckpoints = input.rule.requiredCheckpoints ?? [];
    if (requiredEventTypes.length === 0 && requiredCheckpoints.length === 0) {
      return null;
    }
    const traceEvents = input.events.filter(
      (event) => event.traceId === input.traceId,
    );
    const missingEventTypes = requiredEventTypes.filter(
      (type) => !traceEvents.some((event) => event.type === type),
    );
    const missingCheckpoints = requiredCheckpoints.filter(
      (checkpoint) =>
        !traceEvents.some((event) => eventHasCheckpoint(event, checkpoint)),
    );
    if (missingEventTypes.length === 0 && missingCheckpoints.length === 0) {
      return null;
    }

    const totalRequirements =
      requiredEventTypes.length + requiredCheckpoints.length;
    const missingRequirements =
      missingEventTypes.length + missingCheckpoints.length;
    return {
      id: `residual:rule:${encodeURIComponent(input.rule.id)}:${encodeURIComponent(input.id)}`,
      kind: "rule",
      baseline: toReference(
        { kind: "rule", id: input.rule.id },
        {
          ruleId: input.rule.id,
          requiredEventTypes,
          requiredCheckpoints,
        },
      ),
      observed: toReference(
        { kind: "trace", id: input.traceId },
        {
          traceId: input.traceId,
          eventCount: traceEvents.length,
          missingEventTypes,
          missingCheckpoints,
        },
      ),
      field: copyFieldContext(input.field),
      magnitude: missingRequirements / totalRequirements,
      confidence: 1,
      persistence: input.persistence ?? "transient",
      effect: "unknown",
      evidence: copyEvidence(input.evidence),
      detectedAt: input.detectedAt,
    };
  }
}

function resolveOutcomeVerification(
  input: OutcomeDetectionInput,
): ExplicitOutcomeVerification {
  if (input.expectation.verification === "exact") {
    return {
      matches: sameJson(input.expectation.expected, input.observation.actual),
      confidence: 1,
      explanation: "exact JSON comparison",
      evidence: [],
    };
  }
  if (input.verification === undefined) {
    throw new Error(
      `${input.expectation.verification} expectations require an explicit verification result`,
    );
  }
  validateOutcomeVerification(input.verification);
  return {
    matches: input.verification.matches,
    confidence: input.verification.confidence,
    explanation: input.verification.explanation,
    evidence: copyEvidence(input.verification.evidence),
  };
}

function validateExpectation(expectation: Expectation): void {
  if (expectation.id.length < 1) throw new Error("expectation id is required");
  validateSubject(expectation.subject, "expectation subject");
  assertCanonicalTimestamp(expectation.createdAt, "expectation createdAt");
  if (expectation.validUntil !== undefined) {
    assertCanonicalTimestamp(expectation.validUntil, "expectation validUntil");
    if (
      Date.parse(expectation.validUntil) < Date.parse(expectation.createdAt)
    ) {
      throw new Error("expectation validUntil cannot precede createdAt");
    }
  }
  if (expectation.verification === "predicate" && !expectation.predicateId) {
    throw new Error("predicate expectations require predicateId");
  }
  validateEvidence(expectation.evidence, "expectation");
}

function validateOutcomeObservation(observation: OutcomeObservation): void {
  if (observation.id.length < 1) throw new Error("observation id is required");
  validateSubject(observation.subject, "outcome observation subject");
  assertCanonicalTimestamp(observation.observedAt, "observation observedAt");
  validateEvidence(observation.evidence, "outcome observation");
}

function validateOutcomeVerification(
  verification: ExplicitOutcomeVerification,
): void {
  if (
    !Number.isFinite(verification.confidence) ||
    verification.confidence < 0 ||
    verification.confidence > 1
  ) {
    throw new Error("verification confidence must be between 0 and 1");
  }
  if (verification.explanation.length < 1) {
    throw new Error("verification explanation is required");
  }
  validateEvidence(verification.evidence, "outcome verification");
}

function validateRule(rule: RuleRef): void {
  if (rule.id.length < 1) throw new Error("rule id is required");
  for (const eventType of rule.requiredEventTypes ?? []) {
    if (eventType.length < 1) throw new Error("required event type is empty");
  }
  for (const checkpoint of rule.requiredCheckpoints ?? []) {
    if (checkpoint.length < 1) throw new Error("required checkpoint is empty");
  }
}

function validateFieldContext(field: FieldContext): void {
  if (field.taskType !== undefined && field.taskType.length < 1) {
    throw new Error("field taskType must not be empty");
  }
  if (
    !["strong", "medium", "weak"].includes(field.externalVerification) ||
    !["low", "medium", "high"].includes(field.consequence) ||
    !["easy", "partial", "hard"].includes(field.reversibility) ||
    !["short", "medium", "long"].includes(field.feedbackLatency)
  ) {
    throw new Error("field context contains an invalid classification");
  }
  for (const actor of field.actors) {
    if (actor.id.length < 1) throw new Error("field actor id is required");
  }
  for (const rule of field.explicitRules) validateRule(rule);
}

function validateSubject(subject: ResidualSubject, label: string): void {
  if (subject.kind.length < 1 || subject.id.length < 1) {
    throw new Error(`${label} must have a kind and id`);
  }
}

function validateEvidence(evidence: EvidenceRef[], label: string): void {
  for (const item of evidence) {
    if (
      item.eventId === undefined &&
      item.assetId === undefined &&
      item.artifactHash === undefined
    ) {
      throw new Error(
        `${label} evidence must identify an event, asset, or artifact`,
      );
    }
  }
}

function assertEvidence(evidence: EvidenceRef[], label: string): void {
  validateEvidence(evidence, label);
  if (evidence.length === 0) throw new Error(`${label} requires evidence`);
}

function eventHasCheckpoint(event: EventRecord, checkpoint: string): boolean {
  if (event.payload === null || typeof event.payload !== "object") return false;
  if (Array.isArray(event.payload)) return false;
  const payload = event.payload as JsonObject;
  if (payload.checkpoint === checkpoint) return true;
  return (
    Array.isArray(payload.checkpoints) &&
    payload.checkpoints.some((value) => value === checkpoint)
  );
}

function toReference(
  subject: ResidualSubject,
  value: JsonValue,
): ResidualReference {
  return { ...subject, value: cloneJson(value) };
}

function copyFieldContext(field: FieldContext): FieldContext {
  return {
    ...(field.taskType === undefined ? {} : { taskType: field.taskType }),
    externalVerification: field.externalVerification,
    consequence: field.consequence,
    reversibility: field.reversibility,
    feedbackLatency: field.feedbackLatency,
    actors: field.actors.map((actor) => ({ ...actor })),
    explicitRules: field.explicitRules.map((rule) => ({
      id: rule.id,
      ...(rule.requiredEventTypes === undefined
        ? {}
        : { requiredEventTypes: [...rule.requiredEventTypes] }),
      ...(rule.requiredCheckpoints === undefined
        ? {}
        : { requiredCheckpoints: [...rule.requiredCheckpoints] }),
    })),
  };
}

function copyEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
  return evidence.map((item) => ({ ...item }));
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  return stableStringify(left) === stableStringify(right);
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(stableStringify(value)) as JsonValue;
}

function calculateMagnitude(expected: JsonValue, actual: JsonValue): number {
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.min(
      1,
      Math.abs(actual - expected) / Math.max(1, Math.abs(expected)),
    );
  }
  return sameJson(expected, actual) ? 0 : 1;
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

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}
