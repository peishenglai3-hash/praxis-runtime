import { z } from "zod";

import type { EventEnvelope } from "./events.js";
import { jsonValueSchema, utcTimestampSchema } from "./events.js";
import type { JsonObject, JsonValue } from "./json.js";
import { stableStringify } from "./json.js";

const nonEmptyString = z.string().min(1);
const evidenceOrigin = z.enum([
  "direct",
  "declared",
  "inferred",
  "institutional",
]);

const phase3Evidence = z
  .object({
    eventId: nonEmptyString.optional(),
    assetId: nonEmptyString.optional(),
    artifactHash: nonEmptyString.optional(),
    origin: evidenceOrigin,
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

const subject = z.object({ kind: nonEmptyString, id: nonEmptyString }).strict();

const reference = z
  .object({ kind: nonEmptyString, id: nonEmptyString, value: jsonValueSchema })
  .strict();

const actor = z
  .object({
    type: z.enum(["human", "agent", "system", "tool", "model"]),
    id: nonEmptyString,
  })
  .strict();

const rule = z
  .object({
    id: nonEmptyString,
    requiredEventTypes: z.array(nonEmptyString).optional(),
    requiredCheckpoints: z.array(nonEmptyString).optional(),
  })
  .strict();

const fieldContext = z
  .object({
    taskType: nonEmptyString.optional(),
    externalVerification: z.enum(["strong", "medium", "weak"]),
    consequence: z.enum(["low", "medium", "high"]),
    reversibility: z.enum(["easy", "partial", "hard"]),
    feedbackLatency: z.enum(["short", "medium", "long"]),
    actors: z.array(actor),
    explicitRules: z.array(rule),
  })
  .strict();

const expectationRegisteredPayload = z
  .object({
    materialClassification: z.literal("declared"),
    expectationId: nonEmptyString,
    subject,
    expected: jsonValueSchema,
    verification: z.enum(["exact", "predicate", "external"]),
    predicateId: nonEmptyString.optional(),
    createdAt: utcTimestampSchema,
    validUntil: utcTimestampSchema.optional(),
    evidence: z.array(phase3Evidence).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verification === "predicate" && value.predicateId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["predicateId"],
        message: "predicate expectations require predicateId",
      });
    }
    if (
      value.validUntil !== undefined &&
      Date.parse(value.validUntil) < Date.parse(value.createdAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "validUntil cannot precede createdAt",
      });
    }
  });

const residualKind = z.enum([
  "outcome",
  "timing",
  "rule",
  "representation",
  "relation",
  "retrospective",
]);

const residualDetectedPayload = z
  .object({
    materialClassification: z.literal("inferred"),
    residualId: nonEmptyString,
    kind: residualKind,
    baselineId: nonEmptyString.optional(),
    baseline: reference.optional(),
    observed: reference,
    field: fieldContext,
    magnitude: z.number().finite().min(0).max(1).optional(),
    confidence: z.number().finite().min(0).max(1),
    persistence: z.enum(["transient", "repeated", "persistent"]),
    effect: z.literal("unknown"),
    evidence: z.array(phase3Evidence).min(1),
    detectedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "outcome") {
      if (value.baselineId === undefined) {
        context.addIssue({
          code: "custom",
          path: ["baselineId"],
          message: "outcome residuals require baselineId",
        });
      }
      if (value.baseline === undefined) {
        context.addIssue({
          code: "custom",
          path: ["baseline"],
          message: "outcome residuals require baseline",
        });
      }
    }
    if (value.kind === "timing") {
      const observedValue = value.observed.value;
      const isObject =
        observedValue !== null &&
        typeof observedValue === "object" &&
        !Array.isArray(observedValue);
      const cursorSeq = isObject
        ? (observedValue as Record<string, unknown>).cursorSeq
        : undefined;
      const latestRelevantSeq = isObject
        ? (observedValue as Record<string, unknown>).latestRelevantSeq
        : undefined;
      if (
        typeof cursorSeq !== "number" ||
        !Number.isSafeInteger(cursorSeq) ||
        cursorSeq < 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["observed", "value", "cursorSeq"],
          message: "timing cursorSeq must be a non-negative safe integer",
        });
      }
      if (
        typeof latestRelevantSeq !== "number" ||
        !Number.isSafeInteger(latestRelevantSeq) ||
        latestRelevantSeq < 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["observed", "value", "latestRelevantSeq"],
          message:
            "timing latestRelevantSeq must be a non-negative safe integer",
        });
      }
      if (
        typeof cursorSeq === "number" &&
        Number.isSafeInteger(cursorSeq) &&
        typeof latestRelevantSeq === "number" &&
        Number.isSafeInteger(latestRelevantSeq) &&
        latestRelevantSeq < cursorSeq
      ) {
        context.addIssue({
          code: "custom",
          path: ["observed", "value", "latestRelevantSeq"],
          message: "timing latestRelevantSeq cannot precede cursorSeq",
        });
      }
    }
  });

const budget = z
  .object({
    maxDepth: z.number().int().nonnegative(),
    maxHypotheses: z.number().int().nonnegative(),
    maxToolCalls: z.number().int().nonnegative(),
    maxElapsedMs: z.number().int().nonnegative(),
  })
  .strict();

const budgetUsed = z
  .object({
    depth: z.number().int().nonnegative(),
    hypotheses: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    elapsedMs: z.number().int().nonnegative(),
  })
  .strict();

const evidenceDelta = z
  .object({
    fromSeq: z.number().int().nonnegative(),
    toSeq: z.number().int().nonnegative(),
    evidence: z.array(phase3Evidence),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.toSeq < value.fromSeq) {
      context.addIssue({
        code: "custom",
        path: ["toSeq"],
        message: "toSeq cannot precede fromSeq",
      });
    }
    if (value.toSeq === value.fromSeq && value.evidence.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "a zero-width evidence delta must be empty",
      });
    }
    if (value.toSeq > value.fromSeq && value.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "a positive evidence delta requires evidence",
      });
    }
  });

const hypothesis = z
  .object({
    id: nonEmptyString,
    statement: nonEmptyString,
    support: z.array(phase3Evidence).min(1),
    counterevidence: z.array(phase3Evidence),
    testability: nonEmptyString,
    estimatedCost: z.number().finite().nonnegative(),
  })
  .strict();

const permissionByKind = {
  "collect-evidence": "none",
  "verify-external": "external-verifier",
  "request-human-confirmation": "human-confirmation",
} as const;

const action = z
  .object({
    id: nonEmptyString,
    kind: z.enum([
      "collect-evidence",
      "verify-external",
      "request-human-confirmation",
    ]),
    requiredPermission: z.enum([
      "none",
      "external-verifier",
      "human-confirmation",
    ]),
    parameters: z.record(z.string(), jsonValueSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (permissionByKind[value.kind] !== value.requiredPermission) {
      context.addIssue({
        code: "custom",
        path: ["requiredPermission"],
        message: "requiredPermission does not match action kind",
      });
    }
  });

const reflectionProposedPayload = z
  .object({
    materialClassification: z.literal("inferred"),
    residualId: nonEmptyString,
    decision: z.enum(["STOP", "CONTINUE", "ESCALATE"]),
    reasons: z.array(nonEmptyString).min(1),
    hypotheses: z.array(hypothesis),
    recommendedActions: z.array(action),
    budget,
    budgetUsed,
    evidenceDelta,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.budgetUsed.depth > value.budget.maxDepth ||
      value.budgetUsed.hypotheses > value.budget.maxHypotheses ||
      value.budgetUsed.toolCalls > value.budget.maxToolCalls ||
      value.budgetUsed.elapsedMs > value.budget.maxElapsedMs
    ) {
      context.addIssue({
        code: "custom",
        path: ["budgetUsed"],
        message: "budget usage exceeds its budget",
      });
    }
    if (value.budgetUsed.hypotheses < value.hypotheses.length) {
      context.addIssue({
        code: "custom",
        path: ["budgetUsed", "hypotheses"],
        message: "hypothesis usage is inconsistent",
      });
    }
    if (value.decision !== "STOP" && value.budgetUsed.depth < 1) {
      context.addIssue({
        code: "custom",
        path: ["budgetUsed", "depth"],
        message: "non-STOP reflection must consume at least one depth unit",
      });
    }
    if (value.decision === "STOP") {
      if (value.hypotheses.length > 0 || value.recommendedActions.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["decision"],
          message: "STOP cannot recommend further work",
        });
      }
    } else if (value.hypotheses.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["hypotheses"],
        message: "non-STOP requires a hypothesis",
      });
    }
  });

export type Phase3EventPayload =
  | z.infer<typeof expectationRegisteredPayload>
  | z.infer<typeof residualDetectedPayload>
  | z.infer<typeof reflectionProposedPayload>;

export function validatePhase3EventPayload(
  type: string,
  payload: unknown,
): Phase3EventPayload | undefined {
  const schema =
    type === "expectation.registered"
      ? expectationRegisteredPayload
      : type === "residual.detected"
        ? residualDetectedPayload
        : type === "reflection.proposed"
          ? reflectionProposedPayload
          : undefined;
  if (schema === undefined) return undefined;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `${type} payload failed canonical schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data as Phase3EventPayload;
}

export function validatePhase3EventEnvelope(event: EventEnvelope): void {
  const payload = validatePhase3EventPayload(event.type, event.payload);
  if (payload === undefined) return;

  const envelopeEvidence = z
    .array(phase3Evidence)
    .min(1)
    .safeParse(event.evidence);
  if (!envelopeEvidence.success) {
    throw new Error(`${event.type} envelope evidence is invalid`);
  }
  const normalizedEnvelopeEvidence = envelopeEvidence.data;

  if (
    event.provenance.origin !== "declared" &&
    event.type === "expectation.registered"
  ) {
    throw new Error("expectation.registered must have declared provenance");
  }
  if (
    event.provenance.origin !== "inferred" &&
    event.type !== "expectation.registered"
  ) {
    throw new Error(`${event.type} must have inferred provenance`);
  }

  if (event.type === "expectation.registered") {
    const expectation = payload as z.infer<typeof expectationRegisteredPayload>;
    if (
      event.id !==
        `expectation-registered:${encodeURIComponent(expectation.expectationId)}` ||
      event.operationId !== expectation.expectationId ||
      event.occurredAt !== expectation.createdAt ||
      event.observedAt !== expectation.createdAt ||
      event.recordedAt !== expectation.createdAt
    ) {
      throw new Error(
        "expectation.registered identity or timestamp is invalid",
      );
    }
    if (
      stableStringify(normalizedEnvelopeEvidence as unknown as JsonValue) !==
      stableStringify(expectation.evidence as unknown as JsonValue)
    ) {
      throw new Error("expectation.registered evidence is not canonical");
    }
    return;
  }

  if (event.type === "residual.detected") {
    const residual = payload as z.infer<typeof residualDetectedPayload>;
    if (
      event.id !==
        `residual-detected:${encodeURIComponent(residual.residualId)}` ||
      event.operationId !== residual.residualId ||
      event.occurredAt !== residual.detectedAt ||
      event.observedAt !== residual.detectedAt ||
      event.recordedAt !== residual.detectedAt
    ) {
      throw new Error("residual.detected identity or timestamp is invalid");
    }
    if (
      stableStringify(normalizedEnvelopeEvidence as unknown as JsonValue) !==
      stableStringify(residual.evidence as unknown as JsonValue)
    ) {
      throw new Error("residual.detected evidence is not canonical");
    }
    return;
  }

  const reflection = payload as z.infer<typeof reflectionProposedPayload>;
  if (
    event.id !==
      `reflection-proposed:${encodeURIComponent(reflection.residualId)}:${reflection.evidenceDelta.toSeq}` ||
    event.operationId !==
      `reflection:${reflection.residualId}:${reflection.evidenceDelta.toSeq}`
  ) {
    throw new Error("reflection.proposed identity is invalid");
  }
}

export function phase3PayloadAsObject(
  type: string,
  payload: unknown,
): JsonObject | undefined {
  const validated = validatePhase3EventPayload(type, payload);
  if (validated === undefined) return undefined;
  return validated as unknown as JsonObject;
}
