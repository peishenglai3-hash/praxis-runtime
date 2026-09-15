import { z } from "zod";

import { utcTimestampSchema } from "./events.js";
import { jsonValueSchema } from "./events.js";
import type { EvidenceOrigin, EvidenceRef } from "./events.js";
import type { JsonValue } from "./json.js";

const nonEmptyString = z.string().min(1);

const evidenceRefSchema = z
  .object({
    eventId: nonEmptyString.optional(),
    assetId: nonEmptyString.optional(),
    artifactHash: nonEmptyString.optional(),
    origin: z.enum(["direct", "declared", "inferred", "institutional"]),
    exposureInfluenced: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.eventId !== undefined ||
      value.assetId !== undefined ||
      value.artifactHash !== undefined,
    "evidence must identify an event, asset, or artifact",
  );

const expectationSubjectSchema = z
  .object({ kind: nonEmptyString, id: nonEmptyString })
  .strict();

const referenceSchema = expectationSubjectSchema;

export interface ExpectationReference {
  kind: string;
  id: string;
}

export const verificationModeSchema = z.enum([
  "state",
  "tool",
  "external",
  "human",
]);

export type VerificationMode = z.infer<typeof verificationModeSchema>;

export const verificationPolicySchema = z
  .object({
    mode: verificationModeSchema,
    verifier: referenceSchema.optional(),
    criterion: jsonValueSchema,
    timeoutMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export interface VerificationPolicy {
  mode: VerificationMode;
  verifier?: ExpectationReference;
  criterion: JsonValue;
  timeoutMs?: number;
}

export const expectationStatusSchema = z.enum([
  "pending",
  "satisfied",
  "violated",
  "expired",
  "unknown",
]);

export type ExpectationStatus = z.infer<typeof expectationStatusSchema>;

const timeWindowFields = {
  createdAt: utcTimestampSchema,
  validFrom: utcTimestampSchema,
  evaluateBy: utcTimestampSchema.optional(),
  expiresAt: utcTimestampSchema.optional(),
};

const timeWindowRefinement = (
  value: {
    createdAt: string;
    validFrom: string;
    evaluateBy?: string | undefined;
    expiresAt?: string | undefined;
  },
  context: z.RefinementCtx,
): void => {
  const createdAt = Date.parse(value.createdAt);
  const validFrom = Date.parse(value.validFrom);
  if (validFrom < createdAt) {
    context.addIssue({
      code: "custom",
      path: ["validFrom"],
      message: "validFrom cannot precede createdAt",
    });
  }
  if (
    value.evaluateBy !== undefined &&
    Date.parse(value.evaluateBy) < validFrom
  ) {
    context.addIssue({
      code: "custom",
      path: ["evaluateBy"],
      message: "evaluateBy cannot precede validFrom",
    });
  }
  if (value.expiresAt !== undefined) {
    const lowerBound =
      value.evaluateBy === undefined ? validFrom : Date.parse(value.evaluateBy);
    if (Date.parse(value.expiresAt) < lowerBound) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt cannot precede evaluateBy or validFrom",
      });
    }
  }
};

export const expectationDefinitionSchema = z
  .object({
    id: nonEmptyString,
    traceId: nonEmptyString.optional(),
    source: referenceSchema,
    subject: expectationSubjectSchema,
    expected: jsonValueSchema,
    verification: verificationPolicySchema,
    ...timeWindowFields,
    evidence: z.array(evidenceRefSchema).min(1),
  })
  .strict()
  .superRefine(timeWindowRefinement);

export interface ExpectationDefinition {
  id: string;
  traceId?: string;
  source: ExpectationReference;
  subject: { kind: string; id: string };
  expected: JsonValue;
  verification: VerificationPolicy;
  createdAt: string;
  validFrom: string;
  evaluateBy?: string;
  expiresAt?: string;
  evidence: EvidenceRef[];
}

export const expectationRecordSchema = z
  .object({
    ...expectationDefinitionSchema.shape,
    status: expectationStatusSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine(timeWindowRefinement);

export interface ExpectationRecord extends ExpectationDefinition {
  status: ExpectationStatus;
  updatedAt: string;
}

export const verificationOutcomeSchema = z.enum([
  "satisfied",
  "violated",
  "unknown",
]);

export type VerificationOutcome = z.infer<typeof verificationOutcomeSchema>;

export const verificationResultSchema = z
  .object({
    id: nonEmptyString,
    expectationId: nonEmptyString,
    verifier: referenceSchema,
    observedAt: utcTimestampSchema,
    outcome: verificationOutcomeSchema,
    evidence: z.array(evidenceRefSchema).min(1),
    details: jsonValueSchema.optional(),
  })
  .strict();

export interface VerificationResult {
  id: string;
  expectationId: string;
  verifier: ExpectationReference;
  observedAt: string;
  outcome: VerificationOutcome;
  evidence: EvidenceRef[];
  details?: JsonValue;
}

export interface ExpectationCreatedPayload extends ExpectationRecord {
  materialClassification: "declared";
}

export interface ExpectationUpdatedPayload extends ExpectationRecord {
  materialClassification: "declared";
}

export interface ExpectationCancelledPayload {
  materialClassification: "declared";
  expectationId: string;
  cancelledAt: string;
  reason: string;
}

export interface VerificationRequestedPayload {
  materialClassification: "declared";
  expectationId: string;
  requestId: string;
  requestedAt: string;
  verifier: ExpectationReference;
  mode: VerificationMode;
}

export interface VerificationCompletedPayload {
  materialClassification: "declared";
  result: VerificationResult;
}

export interface ExpectationStatusChangedPayload {
  materialClassification: "declared";
  expectationId: string;
  from: ExpectationStatus;
  to: ExpectationStatus;
  changedAt: string;
  reason: string;
  verificationId?: string;
}

export type ExpectationEventPayload =
  | ExpectationCreatedPayload
  | ExpectationUpdatedPayload
  | ExpectationCancelledPayload
  | VerificationRequestedPayload
  | VerificationCompletedPayload
  | ExpectationStatusChangedPayload;

export function parseExpectationDefinition(
  value: unknown,
): ExpectationDefinition {
  return expectationDefinitionSchema.parse(value) as ExpectationDefinition;
}

export function parseExpectationRecord(value: unknown): ExpectationRecord {
  return expectationRecordSchema.parse(value) as ExpectationRecord;
}

export function parseVerificationResult(value: unknown): VerificationResult {
  return verificationResultSchema.parse(value) as VerificationResult;
}

export function copyEvidenceRefs(evidence: EvidenceRef[]): EvidenceRef[] {
  return evidence.map((item) => ({ ...item }));
}

export function evidenceOrigin(value: string): EvidenceOrigin | undefined {
  return ["direct", "declared", "inferred", "institutional"].includes(value)
    ? (value as EvidenceOrigin)
    : undefined;
}
