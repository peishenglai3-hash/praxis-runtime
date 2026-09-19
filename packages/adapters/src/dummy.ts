import {
  AdapterError,
  type AdapterCapabilities,
  type AdapterExecutionContext,
  type ModelAdapter,
  type ModelRequest,
  type ModelResult,
  type ToolAdapter,
  type ToolRequest,
  type ToolResult,
} from "@praxis/contracts";

import {
  assertModelRequestShape,
  capabilityModeOf,
  negotiateCapabilities,
} from "./negotiation.js";
import {
  createAdapterObservation,
  type AdapterObserver,
} from "./observability.js";
import { digestOf, errorContext, stableText, wait } from "./timing.js";

/**
 * The dummy adapters Bible section 10.2 requires first:
 *
 *   先实现 DummyModelAdapter/DummyToolAdapter，使核心全部测试不依赖联网服务。
 *
 * They are deterministic, offline, and honest about what they cannot do. The
 * declaration matters as much as the behaviour: a dummy that claimed
 * `streaming: true` would let a caller build against a capability nothing in
 * this repository has.
 */

const dummyCapabilities: AdapterCapabilities = Object.freeze({
  streaming: false,
  tools: false,
  structuredOutput: true,
  cancellation: true,
  idempotencyKey: true,
  persistentSession: false,
  reasoningControl: true,
  maxContextTokens: 8192,
});

export interface DummyAdapterOptions {
  /** Defaults to the class's own id. An opaque label, never branched on. */
  provider?: string;
  capabilities?: Partial<AdapterCapabilities>;
  observer?: AdapterObserver;
  scaffold?: string;
  /** Marks results as produced from a replay rather than a live call. */
  counterfactual?: boolean;
  /** A delay before the call completes. Used to exercise budgets. */
  delayMs?: number;
  /**
   * Whether the delay happens *after* the external call has been sent. When
   * it is, a budget expiry for an irreversible effect is reported as
   * `side_effect_uncertainty` rather than `timeout` — the call may have
   * happened, and Phase 6B section 9 says not to pretend otherwise.
   */
  sendsBeforeDelay?: boolean;
}

function mergeCapabilities(
  overrides: Partial<AdapterCapabilities> | undefined,
): AdapterCapabilities {
  return { ...dummyCapabilities, ...overrides };
}

function nowIso(): string {
  return new Date().toISOString();
}

abstract class DummyBase {
  readonly id: string;
  readonly #provider: string;
  readonly #capabilities: AdapterCapabilities;
  readonly #observer: AdapterObserver | undefined;
  readonly #scaffold: string | undefined;
  readonly #counterfactual: boolean;
  readonly #delayMs: number;
  readonly #sendsBeforeDelay: boolean;

  protected constructor(id: string, options: DummyAdapterOptions) {
    this.id = id;
    this.#provider = options.provider ?? id;
    this.#capabilities = mergeCapabilities(options.capabilities);
    this.#observer = options.observer;
    this.#scaffold = options.scaffold;
    this.#counterfactual = options.counterfactual ?? false;
    this.#delayMs = options.delayMs ?? 0;
    this.#sendsBeforeDelay = options.sendsBeforeDelay ?? false;
  }

  capabilities(): AdapterCapabilities {
    return this.#capabilities;
  }

  protected get provider(): string {
    return this.#provider;
  }

  protected get scaffold(): string | undefined {
    return this.#scaffold;
  }

  protected get counterfactual(): boolean {
    return this.#counterfactual;
  }

  protected get observer(): AdapterObserver | undefined {
    return this.#observer;
  }

  protected get delayMs(): number {
    return this.#delayMs;
  }

  /**
   * Stand in for the wait a real call would take.
   *
   * `mayHaveTakenEffect` is what distinguishes a slow read from a slow
   * mutation: the first can be retried, the second cannot until someone looks
   * at the world.
   *
   * The cancellation check happens even when there is nothing to wait for.
   * The conformance suite caught the earlier version returning early on a
   * zero delay, which meant an instant call was the one call that never
   * noticed it had been cancelled.
   */
  protected async settle(
    context: AdapterExecutionContext,
    mayHaveTakenEffect: boolean,
  ): Promise<void> {
    if (context.signal?.aborted === true) {
      throw new AdapterError({
        kind: "cancellation",
        ...errorContext(this.id, context),
        message: `${this.id}: cancelled before the call started`,
      });
    }
    if (this.#delayMs <= 0) return;
    await wait(this.#delayMs, {
      adapterId: this.id,
      context,
      ...(this.#sendsBeforeDelay && mayHaveTakenEffect
        ? { sideEffectMayHaveOccurred: true }
        : {}),
    });
  }

  protected observe(input: {
    operation: "model.generate" | "tool.execute";
    target: string;
    context: AdapterExecutionContext;
    startedAt: string;
    status: "ok" | "error";
    errorKind?: Parameters<typeof createAdapterObservation>[0]["errorKind"];
    usage?: Parameters<typeof createAdapterObservation>[0]["usage"];
    capabilityMode: Parameters<
      typeof createAdapterObservation
    >[0]["capabilityMode"];
    providerMetadata?: Parameters<
      typeof createAdapterObservation
    >[0]["providerMetadata"];
  }): void {
    if (this.#observer === undefined) return;
    this.#observer.record(
      createAdapterObservation({
        operation: input.operation,
        adapterId: this.id,
        provider: this.#provider,
        target: input.target,
        operationId: input.context.operationId,
        traceId: input.context.traceId,
        startedAt: input.startedAt,
        finishedAt: nowIso(),
        status: input.status,
        ...(input.errorKind === undefined
          ? {}
          : { errorKind: input.errorKind }),
        ...(input.usage === undefined ? {} : { usage: input.usage }),
        capabilityMode: input.capabilityMode,
        counterfactual: this.#counterfactual,
        ...(input.providerMetadata === undefined
          ? {}
          : { providerMetadata: input.providerMetadata }),
      }),
    );
  }
}

export class DummyModelAdapter extends DummyBase implements ModelAdapter {
  constructor(id = "dummy-model", options: DummyAdapterOptions = {}) {
    super(id, options);
  }

  async generate(
    request: ModelRequest,
    context: AdapterExecutionContext,
  ): Promise<ModelResult> {
    const startedAt = nowIso();
    const negotiation = negotiateCapabilities({
      adapterId: this.id,
      available: this.capabilities(),
      ...(request.requires === undefined ? {} : { requires: request.requires }),
      ...(request.allowDegradation === undefined
        ? {}
        : { allowDegradation: request.allowDegradation }),
      context,
    });
    assertModelRequestShape(request, errorContext(this.id, context));
    const capabilityMode = capabilityModeOf(negotiation);

    try {
      // A generation has no external effect to duplicate.
      await this.settle(context, false);
    } catch (error) {
      this.observe({
        operation: "model.generate",
        target: request.modelHint ?? this.provider,
        context,
        startedAt,
        status: "error",
        ...(error instanceof AdapterError ? { errorKind: error.kind } : {}),
        capabilityMode,
      });
      throw error;
    }

    const promptHash = digestOf(
      stableText({
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    );
    const model = request.modelHint ?? `${this.id}:default`;
    const configHash = digestOf(
      stableText({
        provider: this.provider,
        model,
        capabilityMode,
        scaffold: this.scaffold ?? "",
      }),
    );
    const output = `${this.id}:${promptHash.slice(0, 16)}`;
    const result: ModelResult = {
      output,
      ...(negotiation.effective.structuredOutput &&
      request.responseSchema !== undefined
        ? {
            structured: {
              digest: promptHash,
              shape: String(
                (request.responseSchema as Record<string, unknown>)["type"] ??
                  "unspecified",
              ),
            },
          }
        : {}),
      finishReason: "stop",
      usage: {
        inputTokens: request.messages.reduce(
          (total, message) => total + message.content.length,
          0,
        ),
        outputTokens: output.length,
      },
      run: {
        provider: this.provider,
        model,
        ...(negotiation.effective.reasoningControl
          ? { reasoning: { mode: "deterministic" } }
          : {}),
        ...(this.scaffold === undefined ? {} : { scaffold: this.scaffold }),
        promptHash,
        configHash,
        capabilityMode,
        counterfactual: this.counterfactual,
      },
    };

    this.observe({
      operation: "model.generate",
      target: model,
      context,
      startedAt,
      status: "ok",
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      capabilityMode,
    });
    return result;
  }
}

export class DummyToolAdapter extends DummyBase implements ToolAdapter {
  constructor(id = "dummy-tool", options: DummyAdapterOptions = {}) {
    super(id, options);
  }

  async execute(
    request: ToolRequest,
    context: AdapterExecutionContext,
  ): Promise<ToolResult> {
    const startedAt = nowIso();
    const negotiation = negotiateCapabilities({
      adapterId: this.id,
      available: this.capabilities(),
      context,
    });
    const capabilityMode = capabilityModeOf(negotiation);

    try {
      // Only an irreversible effect can be duplicated by a retry, so only it
      // turns a budget expiry into `side_effect_uncertainty`.
      await this.settle(context, request.sideEffect === "irreversible");
    } catch (error) {
      this.observe({
        operation: "tool.execute",
        target: request.tool,
        context,
        startedAt,
        status: "error",
        ...(error instanceof AdapterError ? { errorKind: error.kind } : {}),
        capabilityMode,
      });
      throw error;
    }

    const output = {
      tool: request.tool,
      digest: digestOf(
        stableText({ tool: request.tool, input: request.input }),
      ),
    };
    const result: ToolResult = {
      output,
      // A read leaves nothing applied; anything else did happen, and saying
      // so is the whole point of the field.
      effectStatus: request.sideEffect === "none" ? "not_applied" : "applied",
      run: {
        provider: this.provider,
        tool: request.tool,
        // Reporting a key that was sent is only true if this adapter can send
        // one. An adapter declaring `idempotencyKey: false` must not claim it
        // passed one through, or the capability declaration is decoration.
        ...(negotiation.effective.idempotencyKey === true &&
        request.idempotencyKey !== undefined
          ? { idempotencyKeySent: request.idempotencyKey }
          : {}),
        capabilityMode,
        counterfactual: this.counterfactual,
      },
    };

    this.observe({
      operation: "tool.execute",
      target: request.tool,
      context,
      startedAt,
      status: "ok",
      capabilityMode,
    });
    return result;
  }
}
