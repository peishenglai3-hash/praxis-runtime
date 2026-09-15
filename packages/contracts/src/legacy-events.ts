import { z } from "zod";

import type { EventEnvelope } from "./events.js";
import type { JsonObject, JsonValue } from "./json.js";
import {
  legacyAnomalyClassSchema,
  legacyRelationClassSchema,
} from "./legacy.js";

/**
 * Canonical validation for the `legacy.*` event family.
 *
 * The store calls this before every append, so a caller that reaches the
 * generic `EventWriter` surface directly still cannot record an imported
 * first-generation record without the provenance, identity and fingerprint
 * that make the import auditable.
 *
 * Provenance is fixed per event type rather than caller-chosen:
 *   - `legacy.signal.imported`     `declared` (the source declared the value)
 *   - `legacy.pattern.imported`    `inferred` (a derived pattern, not a fact)
 *   - `legacy.graph-edge.imported` `inferred` (a derived association)
 *   - `legacy.anomaly`             `direct`   (an observation about the source)
 *   - `legacy.import.completed`    `direct`   (a record of the run itself)
 *
 * An imported record keeps the digest of the corpus it came from. That digest
 * participates in the event identity, so re-importing the same corpus is
 * idempotent while a different corpus can never collide with an earlier run.
 */

const nonEmptyString = z.string().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

const legacyEvidenceRef = z
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
    "legacy evidence must identify an event, asset, or artifact",
  );

const legacyCounts = z
  .object({
    scannedFiles: z.number().int().nonnegative(),
    signals: z.number().int().nonnegative(),
    patterns: z.number().int().nonnegative(),
    graphEdges: z.number().int().nonnegative(),
    anomalies: z.number().int().nonnegative(),
    exclusions: z.number().int().nonnegative(),
  })
  .strict();

const legacySignalImportedPayload = z
  .object({
    materialClassification: z.literal("declared"),
    sourceFingerprint: sha256,
    sourcePath: nonEmptyString,
    recordId: nonEmptyString,
    signalKind: nonEmptyString,
    category: nonEmptyString,
    value: z.string(),
    declaredTimestamp: z.string(),
    confidence: z.number().finite().min(0).max(1),
    source: nonEmptyString,
    declaredFields: z.array(nonEmptyString),
    absentFields: z.array(nonEmptyString),
  })
  .strict();

const legacyPatternImportedPayload = z
  .object({
    materialClassification: z.literal("inferred"),
    sourceFingerprint: sha256,
    sourcePath: nonEmptyString,
    patternId: nonEmptyString,
    trigger: z.string(),
    action: z.string(),
    confidence: z.number().finite().min(0).max(1),
    frequency: z.number().int().nonnegative(),
    collisionCount: z.number().int().positive(),
  })
  .strict();

const legacyGraphEdgeImportedPayload = z
  .object({
    materialClassification: z.literal("inferred"),
    sourceFingerprint: sha256,
    sourcePath: nonEmptyString,
    from: nonEmptyString,
    to: nonEmptyString,
    strength: z.number().finite(),
    frequency: z.number().int().nonnegative(),
    relationClass: legacyRelationClassSchema,
  })
  .strict();

const legacyAnomalyPayload = z
  .object({
    materialClassification: z.literal("declared"),
    sourceFingerprint: sha256,
    anomalyId: nonEmptyString,
    anomalyClass: legacyAnomalyClassSchema,
    reason: nonEmptyString,
    relativePath: nonEmptyString.optional(),
    affectedCount: z.number().int().positive(),
    declaredValue: z.string().optional(),
  })
  .strict();

const legacyImportCompletedPayload = z
  .object({
    materialClassification: z.literal("declared"),
    sourceFingerprint: sha256,
    root: nonEmptyString,
    planHash: sha256,
    status: z.enum(["applied", "already-imported"]),
    counts: legacyCounts,
    archiveEntryCount: z.number().int().nonnegative(),
  })
  .strict();

export const legacyEventTypes = [
  "legacy.signal.imported",
  "legacy.pattern.imported",
  "legacy.graph-edge.imported",
  "legacy.anomaly",
  "legacy.import.completed",
] as const;

export type LegacyEventType = (typeof legacyEventTypes)[number];

export type LegacySignalImportedPayload = z.infer<
  typeof legacySignalImportedPayload
>;
export type LegacyPatternImportedPayload = z.infer<
  typeof legacyPatternImportedPayload
>;
export type LegacyGraphEdgeImportedPayload = z.infer<
  typeof legacyGraphEdgeImportedPayload
>;
export type LegacyAnomalyPayload = z.infer<typeof legacyAnomalyPayload>;
export type LegacyImportCompletedPayload = z.infer<
  typeof legacyImportCompletedPayload
>;

export type LegacyEventPayload =
  | LegacySignalImportedPayload
  | LegacyPatternImportedPayload
  | LegacyGraphEdgeImportedPayload
  | LegacyAnomalyPayload
  | LegacyImportCompletedPayload;

const schemaByType = {
  "legacy.signal.imported": legacySignalImportedPayload,
  "legacy.pattern.imported": legacyPatternImportedPayload,
  "legacy.graph-edge.imported": legacyGraphEdgeImportedPayload,
  "legacy.anomaly": legacyAnomalyPayload,
  "legacy.import.completed": legacyImportCompletedPayload,
} satisfies Record<LegacyEventType, z.ZodType>;

export function isLegacyEventType(type: string): type is LegacyEventType {
  return (legacyEventTypes as readonly string[]).includes(type);
}

export function validateLegacyEventPayload(
  type: string,
  payload: JsonValue,
): LegacyEventPayload | undefined {
  if (!isLegacyEventType(type)) return undefined;
  const parsed = schemaByType[type].safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `${type} payload failed canonical schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data as LegacyEventPayload;
}

function provenanceOriginFor(
  type: LegacyEventType,
): "declared" | "inferred" | "direct" {
  switch (type) {
    case "legacy.signal.imported":
      return "declared";
    case "legacy.pattern.imported":
    case "legacy.graph-edge.imported":
      return "inferred";
    default:
      return "direct";
  }
}

export function validateLegacyEventEnvelope(event: EventEnvelope): void {
  const payload = validateLegacyEventPayload(event.type, event.payload);
  if (payload === undefined) return;
  const type = event.type as LegacyEventType;

  const expectedOrigin = provenanceOriginFor(type);
  if (event.provenance.origin !== expectedOrigin) {
    throw new Error(
      `${type} must have ${expectedOrigin} provenance, received ${event.provenance.origin}`,
    );
  }
  if (event.provenance.confidence < 0 || event.provenance.confidence > 1) {
    throw new Error(`${type} provenance confidence must be within 0..1`);
  }

  const parsedEvidence = z
    .array(legacyEvidenceRef)
    .min(1)
    .safeParse(event.evidence);
  if (!parsedEvidence.success) {
    throw new Error(`${type} envelope evidence is invalid`);
  }

  const expectedId = legacyEventId(type, payload);
  if (event.id !== expectedId) {
    throw new Error(
      `${type} must use the deterministic identifier ${expectedId}`,
    );
  }
  if (event.operationId !== expectedId) {
    throw new Error(`${type} must use ${expectedId} as its idempotency key`);
  }
  if (event.source.ref !== payload.sourceFingerprint) {
    throw new Error(
      `${type} source.ref must carry the legacy source fingerprint`,
    );
  }
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Deterministic event identity. A corpus change produces new identifiers; an
 * identical re-import reproduces the same identifiers and is therefore
 * idempotent at the ledger boundary.
 */
export function legacyEventId(
  type: LegacyEventType,
  payload: LegacyEventPayload,
): string {
  const fingerprint = payload.sourceFingerprint;
  switch (type) {
    case "legacy.signal.imported":
      return `legacy-signal:${fingerprint}:${encode((payload as LegacySignalImportedPayload).recordId)}`;
    case "legacy.pattern.imported":
      return `legacy-pattern:${fingerprint}:${encode((payload as LegacyPatternImportedPayload).patternId)}`;
    case "legacy.graph-edge.imported": {
      const edge = payload as LegacyGraphEdgeImportedPayload;
      return `legacy-graph-edge:${fingerprint}:${encode(edge.from)}:${encode(edge.to)}`;
    }
    case "legacy.anomaly":
      return `legacy-anomaly:${fingerprint}:${encode((payload as LegacyAnomalyPayload).anomalyId)}`;
    default:
      return `legacy-import-completed:${fingerprint}`;
  }
}

export function legacyPayloadAsObject(
  type: string,
  payload: JsonValue,
): JsonObject | undefined {
  const validated = validateLegacyEventPayload(type, payload);
  if (validated === undefined) return undefined;
  return validated as unknown as JsonObject;
}
