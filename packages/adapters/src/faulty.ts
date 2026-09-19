import {
  AdapterError,
  parseModelResult,
  type AdapterCapabilities,
  type AdapterErrorKind,
  type AdapterExecutionContext,
  type JsonObject,
  type ModelRequest,
  type ModelResult,
  type ToolRequest,
  type ToolResult,
} from "@praxis/contracts";

import {
  DummyModelAdapter,
  DummyToolAdapter,
  type DummyAdapterOptions,
} from "./dummy.js";

/**
 * Adapters that misbehave on purpose.
 *
 * Phase 6B section 12 requires a conforming set that proves the contract
 * without a single network call. Every adapter here is a legitimate
 * implementation of the port: it fails in a way the contract allows, and the
 * conformance suite treats that as conforming. An adapter that failed *outside*
 * the taxonomy would not be — distinguishing the two is what CT-06 is for.
 */

// --- Slow -------------------------------------------------------------------

export class SlowModelAdapter extends DummyModelAdapter {
  constructor(
    id = "slow-model",
    options: DummyAdapterOptions & { delayMs: number },
  ) {
    super(id, options);
  }
}

export class SlowToolAdapter extends DummyToolAdapter {
  constructor(
    id = "slow-tool",
    options: DummyAdapterOptions & {
      delayMs: number;
      sendsBeforeDelay?: boolean;
    },
  ) {
    super(id, options);
  }
}

// --- Fault injection --------------------------------------------------------

export interface FaultPlan {
  kind: AdapterErrorKind;
  /**
   * The 1-based attempt to fail on. Omitted means every attempt fails.
   * `attempt: 1` is how a retry is tested: the second call succeeds, so the
   * caller can be judged on whether it retried correctly rather than on
   * whether it retried at all.
   */
  attempt?: number;
  /** Provider-safe diagnostic detail. */
  diagnostic?: JsonObject;
  /** An internal cause, used to prove the cause never escapes serialisation. */
  cause?: unknown;
}

/**
 * Holds the attempt counter and decides whether this call is the failing one.
 *
 * Composed rather than inherited: a shared mutable inherited counter between
 * a model adapter and a tool adapter is the kind of thing that makes a test
 * pass for the wrong reason.
 */
export class FaultPlanRunner {
  #attempts = 0;
  readonly #plan: FaultPlan | undefined;

  constructor(plan?: FaultPlan) {
    this.#plan = plan;
  }

  attempts(): number {
    return this.#attempts;
  }

  reset(): void {
    this.#attempts = 0;
  }

  next(id: string, context: AdapterExecutionContext): AdapterError | undefined {
    this.#attempts += 1;
    const plan = this.#plan;
    if (plan === undefined) return undefined;
    if (plan.attempt !== undefined && plan.attempt !== this.#attempts) {
      return undefined;
    }
    return new AdapterError({
      kind: plan.kind,
      adapterId: id,
      operationId: context.operationId,
      traceId: context.traceId,
      ...(plan.diagnostic === undefined ? {} : { diagnostic: plan.diagnostic }),
      ...(plan.cause === undefined ? {} : { cause: plan.cause }),
    });
  }
}

export class FaultyModelAdapter extends DummyModelAdapter {
  readonly faults: FaultPlanRunner;

  constructor(
    id = "faulty-model",
    options: DummyAdapterOptions & { fault?: FaultPlan } = {},
  ) {
    super(id, options);
    this.faults = new FaultPlanRunner(options.fault);
  }

  override async generate(
    request: ModelRequest,
    context: AdapterExecutionContext,
  ): Promise<ModelResult> {
    const fault = this.faults.next(this.id, context);
    if (fault !== undefined) throw fault;
    return super.generate(request, context);
  }
}

export class FaultyToolAdapter extends DummyToolAdapter {
  readonly faults: FaultPlanRunner;

  constructor(
    id = "faulty-tool",
    options: DummyAdapterOptions & { fault?: FaultPlan } = {},
  ) {
    super(id, options);
    this.faults = new FaultPlanRunner(options.fault);
  }

  override async execute(
    request: ToolRequest,
    context: AdapterExecutionContext,
  ): Promise<ToolResult> {
    const fault = this.faults.next(this.id, context);
    if (fault !== undefined) throw fault;
    return super.execute(request, context);
  }
}

// --- Malformed provider response --------------------------------------------

/**
 * An adapter whose provider returns something it cannot interpret.
 *
 * It is written to *actually* take the conversion path — it builds a payload,
 * runs it through the contract parser, and translates the parse failure into
 * `malformed_provider_response`. An adapter that simply threw the label would
 * prove the label exists and nothing about the path that produces it.
 */
export class MalformedResponseModelAdapter extends DummyModelAdapter {
  constructor(id = "malformed-model", options: DummyAdapterOptions = {}) {
    super(id, options);
  }

  override async generate(
    request: ModelRequest,
    context: AdapterExecutionContext,
  ): Promise<ModelResult> {
    const good = await super.generate(request, context);
    // A provider that answered with the right shape but the wrong types.
    const providerPayload = {
      ...good,
      finishReason: 42,
    } as unknown;
    try {
      return parseModelResult(providerPayload);
    } catch (cause) {
      throw new AdapterError({
        kind: "malformed_provider_response",
        adapterId: this.id,
        operationId: context.operationId,
        traceId: context.traceId,
        message: `${this.id}: the provider payload did not match the contract`,
        cause,
      });
    }
  }
}

// --- Partial capability -----------------------------------------------------

/**
 * An adapter that declares a genuinely narrower capability set.
 *
 * Every `false` here is a claim about behaviour, and the base implementation
 * honours each one: it does not stream, does not return `structured` output,
 * does not report reasoning configuration, and does not pass an idempotency
 * key through. `cancellation` stays `true` because the base implementation
 * really does observe the signal — declaring otherwise would be the exact
 * dishonesty this contract exists to prevent.
 */
const partialCapabilities: AdapterCapabilities = Object.freeze({
  streaming: false,
  tools: false,
  structuredOutput: false,
  cancellation: true,
  idempotencyKey: false,
  persistentSession: false,
  reasoningControl: false,
});

export class PartialCapabilityModelAdapter extends DummyModelAdapter {
  constructor(id = "partial-model", options: DummyAdapterOptions = {}) {
    super(id, { ...options, capabilities: partialCapabilities });
  }
}

export class PartialCapabilityToolAdapter extends DummyToolAdapter {
  constructor(id = "partial-tool", options: DummyAdapterOptions = {}) {
    super(id, { ...options, capabilities: partialCapabilities });
  }
}
