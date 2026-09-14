import { z } from "zod";

import type { JsonValue } from "./json.js";

export type ActorType = "human" | "agent" | "system" | "tool" | "model";

export interface ActorRef {
  type: ActorType;
  id: string;
}

export interface SourceRef {
  kind: string;
  provider?: string;
  ref?: string;
}

export type EvidenceOrigin =
  "direct" | "declared" | "inferred" | "institutional";

export interface EvidenceRef {
  eventId?: string;
  assetId?: string;
  artifactHash?: string;
  origin: EvidenceOrigin;
  exposureInfluenced?: boolean;
}

export interface EventLinks {
  causedBy?: string[];
  respondsTo?: string[];
  supersedes?: string[];
  derivedFrom?: string[];
}

export interface Provenance {
  origin: EvidenceOrigin;
  confidence: number;
}

export interface EventEnvelope<TPayload extends JsonValue = JsonValue> {
  schemaVersion: "1";
  eventVersion: string;
  id: string;
  type: string;
  occurredAt: string;
  observedAt: string;
  recordedAt: string;
  actor: ActorRef;
  sessionId?: string;
  traceId?: string;
  operationId?: string;
  source: SourceRef;
  payload: TPayload;
  evidence?: EvidenceRef[];
  links?: EventLinks;
  provenance: Provenance;
}

export interface EventRecord<
  TPayload extends JsonValue = JsonValue,
> extends EventEnvelope<TPayload> {
  seq: number;
  contentHash: string;
}

export interface EventAppendResult {
  record: EventRecord;
  inserted: boolean;
}

export interface EventReader {
  getById(id: string): EventRecord | null;
  getByOperationId(operationId: string): EventRecord[];
  lookupOperationState(operationId: string): OperationState | null;
  query(query?: EventQuery): EventRecord[];
  getSince(seq: number, limit?: number): EventRecord[];
  getLastSeq(): number;
}

export interface EventQuery {
  afterSeq?: number;
  beforeSeq?: number;
  type?: string;
  sessionId?: string;
  traceId?: string;
  actor?: ActorRef;
  limit?: number;
}

export type OperationStatus = "requested" | "succeeded" | "failed" | "unknown";

export interface OperationState {
  operationId: string;
  events: EventRecord[];
  status: OperationStatus;
}

export interface EventWriter {
  append(event: EventEnvelope): EventAppendResult;
}

export interface EventBatchWriter {
  /**
   * Appends all events atomically: implementations must provide all-or-none
   * semantics and return idempotent results only after the whole batch agrees.
   */
  appendBatch(events: EventEnvelope[]): EventAppendResult[];
}

function isJsonValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.every((item) => isJsonValue(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.entries(value).every(([, item]) =>
      isJsonValue(item, ancestors),
    );
  } finally {
    ancestors.delete(value);
  }
}

export const jsonValueSchema: z.ZodType<JsonValue> =
  z.custom<JsonValue>(isJsonValue);

export const utcTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "timestamp must be a canonical UTC ISO-8601 string",
  )
  .refine((value) => {
    const milliseconds = Date.parse(value);
    return (
      Number.isSafeInteger(milliseconds) &&
      new Date(milliseconds).toISOString() === value
    );
  }, "timestamp is not a valid calendar date");

const actorSchema = z
  .object({
    type: z.enum(["human", "agent", "system", "tool", "model"]),
    id: z.string().min(1),
  })
  .strict();

const sourceRefSchema = z
  .object({
    kind: z.string().min(1),
    provider: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
  })
  .strict();

const evidenceOriginSchema = z.enum([
  "direct",
  "declared",
  "inferred",
  "institutional",
]);

const evidenceRefSchema = z
  .object({
    eventId: z.string().min(1).optional(),
    assetId: z.string().min(1).optional(),
    artifactHash: z.string().min(1).optional(),
    origin: evidenceOriginSchema,
    exposureInfluenced: z.boolean().optional(),
  })
  .strict();

const eventLinksSchema = z
  .object({
    causedBy: z.array(z.string().min(1)).optional(),
    respondsTo: z.array(z.string().min(1)).optional(),
    supersedes: z.array(z.string().min(1)).optional(),
    derivedFrom: z.array(z.string().min(1)).optional(),
  })
  .strict();

const provenanceSchema = z
  .object({
    origin: evidenceOriginSchema,
    confidence: z.number().finite(),
  })
  .strict();

export const eventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("1"),
    eventVersion: z.string().regex(/^\d+$/, "eventVersion must be numeric"),
    id: z.string().min(1),
    type: z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/),
    occurredAt: utcTimestampSchema,
    observedAt: utcTimestampSchema,
    recordedAt: utcTimestampSchema,
    actor: actorSchema,
    sessionId: z.string().min(1).optional(),
    traceId: z.string().min(1).optional(),
    operationId: z.string().min(1).optional(),
    source: sourceRefSchema,
    payload: jsonValueSchema,
    evidence: z.array(evidenceRefSchema).optional(),
    links: eventLinksSchema.optional(),
    provenance: provenanceSchema,
  })
  .strict();

export function parseEventEnvelope(value: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(value) as EventEnvelope;
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return eventEnvelopeSchema.safeParse(value).success;
}
