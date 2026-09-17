import type { JsonObject, JsonValue } from "./json.js";
import type { AdapterSideEffect } from "./adapters.js";

/**
 * Provider-neutral adapter error taxonomy (Phase 6B).
 *
 * A raw provider exception must never reach the runtime as runtime semantics.
 * The taxonomy below is the whole vocabulary the runtime is allowed to reason
 * about; anything an adapter cannot classify is `unknown_external_failure`,
 * which is deliberately the least useful and therefore the least dangerous
 * thing to say.
 */

export const adapterErrorKinds = [
  "authentication_failure",
  "authorization_failure",
  "unsupported_capability",
  "invalid_request",
  "timeout",
  "cancellation",
  "rate_limit",
  "transient_provider_failure",
  "permanent_provider_failure",
  "malformed_provider_response",
  "side_effect_uncertainty",
  "unknown_external_failure",
] as const;

export type AdapterErrorKind = (typeof adapterErrorKinds)[number];

/**
 * The default answer to "may this be tried again", before the side-effect
 * classification is considered.
 *
 * `timeout` defaults to retryable because a read that timed out is usually
 * safe to repeat. It is **not** safe when the call may already have changed
 * something, and `retryDecision` is what applies that override. An adapter
 * must not re-derive retryability on its own.
 */
export const adapterErrorDefaultRetryable: Readonly<
  Record<AdapterErrorKind, boolean>
> = Object.freeze({
  authentication_failure: false,
  authorization_failure: false,
  unsupported_capability: false,
  invalid_request: false,
  timeout: true,
  cancellation: false,
  rate_limit: true,
  transient_provider_failure: true,
  permanent_provider_failure: false,
  malformed_provider_response: false,
  side_effect_uncertainty: false,
  unknown_external_failure: false,
});

/** One short sentence per kind, so logs read the same across providers. */
export const adapterErrorSummaries: Readonly<Record<AdapterErrorKind, string>> =
  Object.freeze({
    authentication_failure: "the provider rejected the supplied credentials",
    authorization_failure: "the credentials are valid but not permitted",
    unsupported_capability: "the adapter cannot do what the call required",
    invalid_request: "the request was rejected as malformed",
    timeout: "the operation exceeded its wall-clock budget",
    cancellation: "the caller cancelled the operation",
    rate_limit: "the provider is throttling this caller",
    transient_provider_failure: "the provider failed in a way that may pass",
    permanent_provider_failure:
      "the provider failed in a way that will not pass",
    malformed_provider_response:
      "the provider returned something the adapter could not interpret",
    side_effect_uncertainty:
      "the external effect may or may not have happened and cannot be seen from here",
    unknown_external_failure:
      "an external failure the adapter could not classify",
  });

// --- Provider-safe diagnostics ----------------------------------------------

/**
 * Key names that carry credentials. `idempotencyKey` is deliberately absent:
 * it is a caller-supplied grouping id, not a secret, and redacting it would
 * destroy the one field that makes a retry diagnosable.
 */
const forbiddenDiagnosticKeys = new Set([
  "authorization",
  "apikey",
  "accesskey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "clientsecret",
  "password",
  "passwd",
  "credential",
  "credentials",
  "privatekey",
  "bearer",
  "cookie",
  "setcookie",
  "sessiontoken",
]);

/** Values that are secrets whatever they are called. */
const secretValuePattern =
  /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+\S{16,})/;

const redacted = "[redacted]" as const;
const truncatedSuffix = "…[truncated]" as const;
const maxStringLength = 512;
const maxDepth = 4;
const maxEntries = 32;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface SanitisedDiagnostic {
  value: JsonObject;
  /** Dotted paths whose value was withheld, so a reader knows it happened. */
  redactedPaths: string[];
}

/**
 * Reduce arbitrary metadata to something safe to persist or log.
 *
 * The reduction **never throws**. Throwing here would turn a diagnosable
 * provider failure into a second failure inside the error path, and the
 * likely outcome of that is a raw exception escaping with the secret intact.
 * Instead the offending value is replaced and its path is reported, so the
 * record says "something was withheld here" rather than pretending the field
 * was empty.
 */
export function sanitiseAdapterDiagnostic(
  input: JsonObject | undefined,
): SanitisedDiagnostic {
  const redactedPaths: string[] = [];

  function walk(value: JsonValue, path: string, depth: number): JsonValue {
    if (typeof value === "string") {
      if (secretValuePattern.test(value)) {
        redactedPaths.push(path);
        return redacted;
      }
      return value.length > maxStringLength
        ? `${value.slice(0, maxStringLength)}${truncatedSuffix}`
        : value;
    }
    if (Array.isArray(value)) {
      if (depth >= maxDepth) return [];
      return value
        .slice(0, maxEntries)
        .map((item, index) => walk(item, `${path}[${index}]`, depth + 1));
    }
    if (value !== null && typeof value === "object") {
      if (depth >= maxDepth) return {};
      const output: JsonObject = {};
      for (const [key, entry] of Object.entries(value).slice(0, maxEntries)) {
        const childPath = path.length === 0 ? key : `${path}.${key}`;
        if (forbiddenDiagnosticKeys.has(normaliseKey(key))) {
          redactedPaths.push(childPath);
          output[key] = redacted;
          continue;
        }
        output[key] = walk(entry, childPath, depth + 1);
      }
      return output;
    }
    return value;
  }

  const value = input === undefined ? {} : (walk(input, "", 0) as JsonObject);
  return { value, redactedPaths };
}

// --- The error --------------------------------------------------------------

export interface AdapterErrorInput {
  kind: AdapterErrorKind;
  adapterId: string;
  operationId: string;
  traceId: string;
  /** An adapter-authored sentence. Never a raw provider payload. */
  message?: string;
  /** Provider-safe by contract; sanitised again here regardless. */
  diagnostic?: JsonObject;
  /** Overrides the taxonomy default. An adapter may not raise retryability. */
  retryable?: boolean;
  /** Kept in-process for diagnosis. Never serialised. */
  cause?: unknown;
}

/**
 * The one error an adapter is allowed to throw.
 *
 * The original cause is retained so in-process diagnosis does not lose it, and
 * is excluded from every serialised form so it cannot reach a log, an event
 * payload, or a doctor report. `toJSON` is what makes that structural rather
 * than a matter of remembering.
 */
export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly adapterId: string;
  readonly operationId: string;
  readonly traceId: string;
  readonly retryable: boolean;
  readonly diagnostic: JsonObject;
  readonly redactedPaths: string[];
  readonly #originalCause: unknown;

  constructor(input: AdapterErrorInput) {
    if (input.adapterId.length < 1) {
      throw new Error("adapter error requires an adapter id");
    }
    if (input.operationId.length < 1) {
      throw new Error("adapter error requires an operationId");
    }
    if (input.traceId.length < 1) {
      throw new Error("adapter error requires a traceId");
    }
    const sanitised = sanitiseAdapterDiagnostic(input.diagnostic);
    const summary = adapterErrorSummaries[input.kind];
    super(input.message ?? `${input.adapterId}: ${summary}`);
    this.name = "AdapterError";
    this.kind = input.kind;
    this.adapterId = input.adapterId;
    this.operationId = input.operationId;
    this.traceId = input.traceId;
    const fallback = adapterErrorDefaultRetryable[input.kind];
    // An adapter may narrow retryability and may not widen it: claiming a
    // permanent failure is transient is how a blind retry loop starts. So an
    // explicit `false` narrows, and any other value — including an adapter
    // asserting `true` for a kind the taxonomy calls permanent — falls back to
    // the taxonomy's own answer.
    this.retryable = input.retryable === false ? false : fallback;
    this.diagnostic = sanitised.value;
    this.redactedPaths = sanitised.redactedPaths;
    this.#originalCause = input.cause;
  }

  /** The original error, for in-process diagnosis only. */
  originalCause(): unknown {
    return this.#originalCause;
  }

  /** The provider-safe document. The cause is structurally absent. */
  toJSON(): AdapterErrorDocument {
    return {
      schemaVersion: "1",
      errorKind: this.kind,
      adapterId: this.adapterId,
      operationId: this.operationId,
      traceId: this.traceId,
      summary: adapterErrorSummaries[this.kind],
      retryable: this.retryable,
      diagnostic: this.diagnostic,
      ...(this.redactedPaths.length === 0
        ? {}
        : { redactedPaths: [...this.redactedPaths] }),
    };
  }
}

export interface AdapterErrorDocument {
  schemaVersion: "1";
  errorKind: AdapterErrorKind;
  adapterId: string;
  operationId: string;
  traceId: string;
  summary: string;
  retryable: boolean;
  diagnostic: JsonObject;
  redactedPaths?: string[];
}

export function isAdapterError(value: unknown): value is AdapterError {
  return value instanceof AdapterError;
}

/**
 * Convert anything thrown by an adapter into the taxonomy.
 *
 * An adapter that throws a foreign error is not trusted to have classified it,
 * so the result is `unknown_external_failure` — the kind that permits nothing.
 * The original is kept as the cause so the information is not lost, only
 * demoted.
 */
export function asAdapterError(
  value: unknown,
  context: { adapterId: string; operationId: string; traceId: string },
): AdapterError {
  if (isAdapterError(value)) return value;
  return new AdapterError({
    kind: "unknown_external_failure",
    adapterId: context.adapterId,
    operationId: context.operationId,
    traceId: context.traceId,
    cause: value,
  });
}

/** A serialisable, cause-free form for logs and reports. */
export function serialiseAdapterError(
  error: AdapterError,
): AdapterErrorDocument {
  return error.toJSON();
}

// --- Retry policy -----------------------------------------------------------

export interface RetryDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Phase 6B, section 9: a timed-out call that may already have changed
 * something must not be retried blindly.
 *
 * The rule is stated once, here, and applies to every adapter. An adapter that
 * wants to retry asks this function; the runtime asks it too, so the two
 * cannot disagree.
 */
export function retryDecision(input: {
  error: AdapterError;
  sideEffect: AdapterSideEffect;
  /** The caller has independently confirmed the external state. */
  effectVerifiedAbsent?: boolean;
}): RetryDecision {
  const { error, sideEffect } = input;

  if (error.kind === "side_effect_uncertainty") {
    if (input.effectVerifiedAbsent === true) {
      return {
        allowed: true,
        reason:
          "the previous attempt's effect was verified absent, so the retry cannot duplicate it",
      };
    }
    return {
      allowed: false,
      reason:
        "the previous attempt may already have taken effect; verify the external state before retrying",
    };
  }

  if (sideEffect === "irreversible") {
    if (input.effectVerifiedAbsent === true) {
      return {
        allowed: true,
        reason:
          "the previous attempt's effect was verified absent, so the retry cannot duplicate it",
      };
    }
    if (error.kind === "timeout" || error.kind === "unknown_external_failure") {
      return {
        allowed: false,
        reason:
          "an irreversible operation ended without a known outcome; a retry could apply it twice",
      };
    }
  }

  if (error.kind === "cancellation") {
    return {
      allowed: false,
      reason:
        "the caller cancelled this operation; a retry would contradict it",
    };
  }

  return {
    allowed: error.retryable,
    reason: error.retryable
      ? `${error.kind} is retryable for a ${sideEffect} operation`
      : `${error.kind} is not retryable`,
  };
}

/**
 * The effect status an adapter must report when it cannot see the outcome.
 * Named so that a timeout inside an irreversible call has one obvious answer
 * rather than an invented one.
 */
export const SIDE_EFFECT_STATUS_UNKNOWN = "unknown" as const;
