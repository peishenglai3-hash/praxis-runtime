import { z } from "zod";

import type { ActorRef } from "./events.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { WriterKind, WriterRole } from "./authorization.js";

/**
 * Provider-neutral adapter boundary (Bible section 10.2, EPIC-010).
 *
 * The Bible freezes two ports:
 *
 *   interface ModelAdapter { generate(request: ModelRequest): Promise<ModelResult>; }
 *   interface ToolAdapter  { execute(request: ToolRequest): Promise<ToolResult>; }
 *
 * They are implemented here with a second `AdapterExecutionContext` argument.
 * That is an **extension of a frozen signature**, registered as
 * `RFC MISMATCH: ADAPTER_EXECUTION_CONTEXT_VS_10_2`, not a quiet correction:
 * Bible section 10.2 requires a ToolAdapter to accept an `operationId`, and
 * the owner's Phase 6B brief additionally requires timeout, cancellation and
 * provenance to be first-class. None of those can be expressed in the request
 * DTO without mixing execution context into the description of the work.
 *
 * Nothing in this file may name a provider. A provider identifier is an opaque
 * label that is recorded and never branched on; if a caller needs to know
 * whether something is supported, it asks the capability declaration.
 */

// --- Capability declaration -------------------------------------------------

export const adapterCapabilityNames = [
  "streaming",
  "tools",
  "structuredOutput",
  "cancellation",
  "idempotencyKey",
  "persistentSession",
  "reasoningControl",
] as const;

export type AdapterCapabilityName = (typeof adapterCapabilityNames)[number];

/**
 * What an adapter can do. Every field is required so that a declaration is a
 * statement rather than an omission: an adapter that has not decided whether
 * it supports cancellation does not get to leave the question blank.
 *
 * `experimental` is deliberately a separate map rather than more top-level
 * fields. A capability that is not in the stable set cannot be required by a
 * caller, cannot be negotiated, and cannot become load-bearing by accident.
 */
export interface AdapterCapabilities {
  streaming: boolean;
  tools: boolean;
  structuredOutput: boolean;
  cancellation: boolean;
  idempotencyKey: boolean;
  persistentSession: boolean;
  reasoningControl: boolean;
  maxContextTokens?: number;
  experimental?: JsonObject;
}

const capabilityFlags = {
  streaming: z.boolean(),
  tools: z.boolean(),
  structuredOutput: z.boolean(),
  cancellation: z.boolean(),
  idempotencyKey: z.boolean(),
  persistentSession: z.boolean(),
  reasoningControl: z.boolean(),
} as const;

export const adapterCapabilitiesSchema = z
  .object({
    ...capabilityFlags,
    maxContextTokens: z.number().int().positive().optional(),
    experimental: z.record(z.string(), z.json()).optional(),
  })
  .strict();

/** A caller's requirement. Only stable capabilities can be required. */
export type AdapterCapabilityRequirement = Partial<
  Record<AdapterCapabilityName, boolean>
>;

export const adapterCapabilityRequirementSchema = z
  .object({
    streaming: z.boolean().optional(),
    tools: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
    cancellation: z.boolean().optional(),
    idempotencyKey: z.boolean().optional(),
    persistentSession: z.boolean().optional(),
    reasoningControl: z.boolean().optional(),
  })
  .strict();

// --- Execution context ------------------------------------------------------

/**
 * A reference to the writer, not the writer's capability list.
 *
 * An adapter has no use for a `WriterContext` and every reason not to hold
 * one: it is given what it needs to label a diagnostic, and nothing that
 * could be mistaken for an authorization.
 */
export interface AdapterWriterRef {
  writerId: string;
  kind: WriterKind;
  role: WriterRole;
}

export interface AdapterExecutionContext {
  /** The idempotency grouping key. Bible section 10.2 requires it on tools. */
  operationId: string;
  traceId: string;
  /** Wall-clock budget for the call. The adapter must honour it. */
  timeoutMs: number;
  /** Cancellation. The adapter must observe it where it declares support. */
  signal?: AbortSignal;
  actor: ActorRef;
  writer: AdapterWriterRef;
}

export const adapterExecutionContextSchema = z
  .object({
    operationId: z.string().min(1),
    traceId: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    actor: z
      .object({ type: z.string().min(1), id: z.string().min(1) })
      .strict(),
    writer: z
      .object({
        writerId: z.string().min(1),
        kind: z.string().min(1),
        role: z.string().min(1),
      })
      .strict(),
  })
  .strict();

// --- Model request / result -------------------------------------------------

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export const modelMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
  })
  .strict();

export interface ModelRequest {
  messages: ModelMessage[];
  /** An opaque hint. Never a branch condition; a hint may be ignored. */
  modelHint?: string;
  maxOutputTokens?: number;
  /** Capabilities this call needs. Negotiated before the call, fail-closed. */
  requires?: AdapterCapabilityRequirement;
  /**
   * Explicitly permit running with fewer capabilities than requested. Absent
   * or false means a mismatch is refused rather than silently degraded.
   */
  allowDegradation?: boolean;
  /** Required when `structuredOutput` is requested. */
  responseSchema?: JsonObject;
  metadata?: JsonObject;
}

export const modelRequestSchema = z
  .object({
    messages: z.array(modelMessageSchema).min(1),
    modelHint: z.string().min(1).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    requires: adapterCapabilityRequirementSchema.optional(),
    allowDegradation: z.boolean().optional(),
    responseSchema: z.record(z.string(), z.json()).optional(),
    metadata: z.record(z.string(), z.json()).optional(),
  })
  .strict();

export type ModelFinishReason =
  "stop" | "length" | "tool_call" | "content_filter" | "unknown";

export interface AdapterUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * Bible issue 092. Recorded for every model call, and required for a replay to
 * be distinguishable from a live run — section 15's EPIC-010 risk row says a
 * replay missing model/scaffold metadata 「会被误解为真实历史重演」.
 */
export interface ModelRunMetadata {
  /** An opaque adapter-declared label, recorded and never branched on. */
  provider: string;
  model: string;
  /** Reasoning/effort configuration actually used, if any. */
  reasoning?: JsonObject;
  scaffold?: string;
  toolSchemaVersion?: string;
  /** Hash of the prompt actually sent. Not the prompt. */
  promptHash: string;
  configHash: string;
  /** The capability set actually used, after negotiation. */
  capabilityMode: JsonObject;
  /**
   * `true` when this result came from a recorded replay rather than a live
   * call. A counterfactual run is not history and must not be read as it.
   */
  counterfactual: boolean;
}

export const modelRunMetadataSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoning: z.record(z.string(), z.json()).optional(),
    scaffold: z.string().min(1).optional(),
    toolSchemaVersion: z.string().min(1).optional(),
    promptHash: z.string().min(1),
    configHash: z.string().min(1),
    capabilityMode: z.record(z.string(), z.json()),
    counterfactual: z.boolean(),
  })
  .strict();

export interface ModelResult {
  output: string;
  /** Present when `structuredOutput` was negotiated and used. */
  structured?: JsonValue;
  finishReason: ModelFinishReason;
  usage?: AdapterUsage;
  run: ModelRunMetadata;
}

export const modelResultSchema = z
  .object({
    output: z.string(),
    structured: z.json().optional(),
    finishReason: z.enum([
      "stop",
      "length",
      "tool_call",
      "content_filter",
      "unknown",
    ]),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    run: modelRunMetadataSchema,
  })
  .strict();

// --- Tool request / result --------------------------------------------------

/**
 * How much damage a tool call can do if it is repeated or if its outcome is
 * unknown. The runtime — not the adapter — decides whether a retry is allowed,
 * and it decides from this classification.
 */
export type AdapterSideEffect = "none" | "reversible" | "irreversible";

export const adapterSideEffectSchema = z.enum([
  "none",
  "reversible",
  "irreversible",
]);

/**
 * The state of an external effect. `unknown` is a first-class outcome, not an
 * error path: a timeout after an irreversible call has been sent leaves the
 * world in a state the adapter cannot see, and saying so is the honest answer.
 */
export type AdapterEffectStatus = "applied" | "not_applied" | "unknown";

export const adapterEffectStatusSchema = z.enum([
  "applied",
  "not_applied",
  "unknown",
]);

export interface ToolRequest {
  tool: string;
  input: JsonObject;
  /** Declared by the caller. An adapter must not lower this classification. */
  sideEffect: AdapterSideEffect;
  /** Passed through to a provider that supports a native idempotency key. */
  idempotencyKey?: string;
  metadata?: JsonObject;
}

export const toolRequestSchema = z
  .object({
    tool: z.string().min(1),
    input: z.record(z.string(), z.json()),
    sideEffect: adapterSideEffectSchema,
    idempotencyKey: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.json()).optional(),
  })
  .strict();

export interface ToolRunMetadata {
  provider: string;
  tool: string;
  /** The idempotency key actually sent, when one was. */
  idempotencyKeySent?: string;
  capabilityMode: JsonObject;
  counterfactual: boolean;
}

export const toolRunMetadataSchema = z
  .object({
    provider: z.string().min(1),
    tool: z.string().min(1),
    idempotencyKeySent: z.string().min(1).optional(),
    capabilityMode: z.record(z.string(), z.json()),
    counterfactual: z.boolean(),
  })
  .strict();

export interface ToolResult {
  output: JsonValue;
  effectStatus: AdapterEffectStatus;
  usage?: AdapterUsage;
  run: ToolRunMetadata;
}

export const toolResultSchema = z
  .object({
    output: z.json(),
    effectStatus: adapterEffectStatusSchema,
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    run: toolRunMetadataSchema,
  })
  .strict();

// --- Ports ------------------------------------------------------------------

export interface ModelAdapter {
  readonly id: string;
  capabilities(): AdapterCapabilities | Promise<AdapterCapabilities>;
  generate(
    request: ModelRequest,
    context: AdapterExecutionContext,
  ): Promise<ModelResult>;
}

export interface ToolAdapter {
  readonly id: string;
  capabilities(): AdapterCapabilities | Promise<AdapterCapabilities>;
  execute(
    request: ToolRequest,
    context: AdapterExecutionContext,
  ): Promise<ToolResult>;
}

// --- Parsers ----------------------------------------------------------------

export function parseAdapterCapabilities(value: unknown): AdapterCapabilities {
  return adapterCapabilitiesSchema.parse(value) as AdapterCapabilities;
}

export function parseModelRequest(value: unknown): ModelRequest {
  return modelRequestSchema.parse(value) as ModelRequest;
}

export function parseModelResult(value: unknown): ModelResult {
  return modelResultSchema.parse(value) as ModelResult;
}

export function parseToolRequest(value: unknown): ToolRequest {
  return toolRequestSchema.parse(value) as ToolRequest;
}

export function parseToolResult(value: unknown): ToolResult {
  return toolResultSchema.parse(value) as ToolResult;
}

export function parseModelRunMetadata(value: unknown): ModelRunMetadata {
  return modelRunMetadataSchema.parse(value) as ModelRunMetadata;
}
