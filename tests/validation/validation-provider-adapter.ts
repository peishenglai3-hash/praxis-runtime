import { createHash } from "node:crypto";

import {
  AdapterError,
  type AdapterCapabilities,
  type AdapterErrorKind,
  type AdapterExecutionContext,
  type ModelAdapter,
  type ModelRequest,
  type ModelResult,
} from "../../packages/contracts/src/index.js";

/**
 * A **validation** adapter for 6V-0, not a production support declaration.
 *
 * 6V-0 asks one question: when a real provider fails, does the failure land in
 * the twelve kinds of the Phase 6B taxonomy, or does something arrive that none
 * of them describes? The question cannot be answered by reading a provider's
 * documentation, and it cannot be answered by another dummy — a subject that
 * cannot fail in ways nobody anticipated tests nothing about anticipation.
 *
 * ## Why this file is here and not in `packages/adapters`
 *
 * `packages/adapters` is scanned by the conformance suite for provider names
 * and is allowed to depend on `@praxis/contracts` alone. A real adapter has to
 * name its provider somewhere and speak HTTP, so it cannot live in the shipped
 * boundary without either weakening that rule or lying to the scan. The
 * boundary's own claim — that provider detail is *scoped* — is only meaningful
 * if the scoped thing sits outside it.
 *
 * So this sits in `tests/`, is typechecked like everything else, is not
 * exported by any package, and is not published. Nothing in `packages/` or
 * `apps/` imports it, and nothing should.
 *
 * ## Credentials
 *
 * The key is read from the environment and never written anywhere: not into a
 * run manifest, not into a diagnostic, not into a commit. `sanitiseAdapterDiagnostic`
 * is the second line of defence and this file is the first — no header is ever
 * put into a diagnostic in the first place.
 */

const defaultEndpoint = "https://api.deepseek.com/chat/completions";

/**
 * HTTP status to taxonomy kind.
 *
 * **This table is an inference, and 6V-0 exists to test it.** Every entry is a
 * claim that the provider means what the status code conventionally means;
 * where the claim is wrong, the run shows it, and the run is the point. A
 * status that is not here becomes `unknown_external_failure`, which is the
 * correct answer for a genuinely unclassifiable failure and a *defect* when it
 * is being used as a bin.
 */
export function classifyHttpStatus(status: number): AdapterErrorKind {
  if (status === 401) return "authentication_failure";
  if (status === 403) return "authorization_failure";
  if (status === 400 || status === 404 || status === 422)
    return "invalid_request";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return "transient_provider_failure";
  }
  if (status === 501 || status === 505) return "permanent_provider_failure";
  return "unknown_external_failure";
}

/** Network-level failure codes, before any HTTP response exists. */
export function classifyNetworkCode(
  code: string | undefined,
): AdapterErrorKind {
  switch (code) {
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return "timeout";
    case "ABORT_ERR":
      return "cancellation";
    case "ECONNRESET":
    case "ECONNREFUSED":
    case "EPIPE":
    case "EAI_AGAIN":
    case "ENOTFOUND":
      return "transient_provider_failure";
    default:
      return "unknown_external_failure";
  }
}

interface ProviderResponse {
  model?: unknown;
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

export interface ValidationAdapterOptions {
  /** Read from the environment by the caller; never defaulted from a file. */
  apiKey: string;
  /** The provider's opaque label, recorded and never branched on. */
  provider?: string;
  /** The model as the provider names it. */
  model?: string;
  endpoint?: string;
  /** Injected so a test can serve a canned response without a network. */
  fetchImpl?: typeof fetch;
}

export class ValidationProviderAdapter implements ModelAdapter {
  readonly id: string;
  readonly #apiKey: string;
  readonly #provider: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: ValidationAdapterOptions) {
    if (options.apiKey.length === 0) {
      throw new Error("the validation adapter requires a provider key");
    }
    this.#apiKey = options.apiKey;
    this.#provider = options.provider ?? "validation-provider";
    this.#model = options.model ?? "validation-model";
    this.id = `validation:${this.#provider}`;
    this.#endpoint = options.endpoint ?? defaultEndpoint;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /**
   * Declared honestly rather than optimistically. `cancellation` is true
   * because AbortSignal is honoured below. `streaming`, `tools` and
   * `structuredOutput` are false because this adapter does not implement them —
   * a capability claimed and not implemented is worse than one not offered,
   * because a caller negotiates against the claim.
   */
  capabilities(): AdapterCapabilities {
    return {
      streaming: false,
      tools: false,
      structuredOutput: false,
      cancellation: true,
      idempotencyKey: false,
      persistentSession: false,
      reasoningControl: false,
    };
  }

  async generate(
    request: ModelRequest,
    context: AdapterExecutionContext,
  ): Promise<ModelResult> {
    const body = JSON.stringify({
      model: this.#model,
      messages: request.messages,
      ...(request.maxOutputTokens === undefined
        ? {}
        : { max_tokens: request.maxOutputTokens }),
    });
    const promptHash = hash(body);

    // The budget is the smaller of what the caller allowed and what the
    // context demands. Whichever fires, the failure has to be attributable to
    // a *timeout* rather than to a network error, so they are distinguished
    // below rather than collapsed.
    const budget = Math.max(1, Math.min(context.timeoutMs, 60_000));
    const timer = AbortSignal.timeout(budget);
    const signal =
      context.signal === undefined
        ? timer
        : AbortSignal.any([timer, context.signal]);

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#apiKey}`,
        },
        body,
        signal,
      });
    } catch (error) {
      throw this.#errorFromThrown(error, context, timer, promptHash);
    }

    const text = await response.text();

    if (!response.ok) {
      throw new AdapterError({
        kind: classifyHttpStatus(response.status),
        adapterId: this.id,
        operationId: context.operationId,
        traceId: context.traceId,
        // The provider's body is *not* copied in. A status code is the
        // provider's own vocabulary and is safe to record; its message is not
        // ours to vouch for, and its request id belongs in the scoped bag.
        diagnostic: { status: response.status },
        cause: error_(response.status, text),
      });
    }

    let parsed: ProviderResponse;
    try {
      parsed = JSON.parse(text) as ProviderResponse;
    } catch {
      throw new AdapterError({
        kind: "malformed_provider_response",
        adapterId: this.id,
        operationId: context.operationId,
        traceId: context.traceId,
        diagnostic: { stage: "parse", bytes: text.length },
        cause: error_(response.status, text),
      });
    }

    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") {
      throw new AdapterError({
        kind: "malformed_provider_response",
        adapterId: this.id,
        operationId: context.operationId,
        traceId: context.traceId,
        diagnostic: { stage: "shape", choices: parsed.choices?.length ?? 0 },
        cause: error_(response.status, text),
      });
    }

    const usage = parsed.usage;
    return {
      output: content,
      finishReason: finishReasonOf(choice?.finish_reason),
      ...(usage === undefined
        ? {}
        : {
            usage: {
              ...(typeof usage.prompt_tokens === "number"
                ? { inputTokens: usage.prompt_tokens }
                : {}),
              ...(typeof usage.completion_tokens === "number"
                ? { outputTokens: usage.completion_tokens }
                : {}),
              ...(typeof usage.total_tokens === "number"
                ? { totalTokens: usage.total_tokens }
                : {}),
            },
          }),
      run: {
        provider: this.#provider,
        model: typeof parsed.model === "string" ? parsed.model : this.#model,
        promptHash,
        configHash: hash(JSON.stringify(this.capabilities())),
        capabilityMode: { ...this.capabilities() },
        // A live call. A counterfactual run is not history and must not be
        // read as it, so this is stated rather than defaulted.
        counterfactual: false,
      },
    };
  }

  /**
   * Tell a timeout apart from a cancellation apart from a network fault.
   *
   * This is the classification 6V-0 is really testing. `AbortSignal.timeout`
   * and a caller's signal both surface as an abort, and reporting a deliberate
   * cancellation as a timeout would make the taxonomy's `cancellation` kind
   * unreachable in practice.
   */
  #errorFromThrown(
    error: unknown,
    context: AdapterExecutionContext,
    timer: AbortSignal,
    promptHash: string,
  ): AdapterError {
    const code = (error as { code?: string } | undefined)?.code;
    const cancelledByCaller = context.signal?.aborted === true;
    const timedOut = timer.aborted;

    let kind: AdapterErrorKind;
    if (cancelledByCaller) kind = "cancellation";
    else if (timedOut) kind = "timeout";
    else kind = classifyNetworkCode(code);

    return new AdapterError({
      kind,
      adapterId: this.id,
      operationId: context.operationId,
      traceId: context.traceId,
      diagnostic: { promptHash, ...(code === undefined ? {} : { code }) },
      cause: error,
    });
  }
}

function finishReasonOf(value: unknown): ModelResult["finishReason"] {
  switch (value) {
    case "stop":
    case "length":
    case "tool_call":
    case "content_filter":
    case "unknown":
      return value;
    default:
      // A finish reason this taxonomy does not have is reported as `unknown`
      // rather than widening the enum from outside the contracts package.
      return "unknown";
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A carrier for the provider's raw text, kept in-process and never serialised. */
function error_(status: number, text: string): Error {
  const error = new Error(
    `provider responded ${status} with ${text.length} bytes`,
  );
  error.name = "ProviderResponseError";
  return error;
}
