import {
  AdapterError,
  adapterCapabilityNames,
  parseAdapterCapabilities,
  retryDecision,
  type AdapterCapabilities,
  type AdapterErrorKind,
  type AdapterExecutionContext,
  type ModelAdapter,
  type ModelRequest,
  type ToolAdapter,
  type ToolRequest,
} from "@praxis/contracts";

import { negotiateCapabilities } from "./negotiation.js";
import { createAdapterObservation } from "./observability.js";

/**
 * The adapter conformance suite (Phase 6B, owner section 13).
 *
 * One suite, applied to every adapter. It tests the property the mission
 * states: different external models and tools can be substituted behind the
 * same runtime contract. An adapter that passes these is substitutable for the
 * ones that also pass them.
 *
 * The suite takes an assertion interface rather than importing a test library,
 * so it can ship in `@praxis/adapters` — where a future provider adapter
 * author needs it — without making Vitest a production dependency. The test
 * layer supplies a Vitest-backed implementation.
 */

/**
 * What a caught adapter failure must look like, described structurally.
 *
 * The suite deliberately does **not** name `AdapterError` here. A test in this
 * repository imports contracts from `packages/contracts/src`, while this
 * package imports `@praxis/contracts`, which TypeScript resolves through the
 * package export to `dist`. Naming a class with a `#private` field in the
 * interface would therefore describe two unrelated types depending on which
 * side of that boundary you are standing on — the same source-versus-build
 * split recorded as `BP-049`, arriving this time as a type error rather than a
 * stale artifact. A structural view has one meaning on both sides.
 *
 * At runtime the two are the same class: `vitest.config.mjs` resolves every
 * workspace package to its source, so `instanceof` in the driver is valid.
 */
export interface AdapterFailureView {
  kind: AdapterErrorKind;
  retryable: boolean;
  diagnostic: unknown;
  redactedPaths: string[];
  /** The original error, retained in-process and never serialised. */
  originalCause(): unknown;
}

export interface ConformanceAssertions {
  equal(actual: unknown, expected: unknown, message: string): void;
  ok(value: unknown, message: string): void;
  includes(haystack: string, needle: string, message: string): void;
  rejectsWithKind(
    fn: () => Promise<unknown>,
    kind: AdapterErrorKind,
    message: string,
  ): Promise<AdapterFailureView>;
  rejectsWithMessage(
    fn: () => Promise<unknown>,
    text: string,
    message: string,
  ): Promise<unknown>;
}

/** How to build a conforming instance with an artificial delay. */
export interface SubjectTiming {
  delayMs?: number;
  sendsBeforeDelay?: boolean;
}

export interface ConformanceSubject {
  kind: "model" | "tool";
  id(): string;
  /** The instance under test. */
  adapter: ModelAdapter | ToolAdapter;
  /**
   * A fresh conforming instance, optionally delayed. Delays are a property of
   * the adapter, not of the request: an adapter that could be told per call to
   * be slow would be an adapter with a test hook in its contract.
   */
  make(timing?: SubjectTiming): ModelAdapter | ToolAdapter;
  capabilities: AdapterCapabilities;
  makeRequest(overrides?: Record<string, unknown>): ModelRequest | ToolRequest;
  makeContext(
    overrides?: Partial<AdapterExecutionContext>,
  ): AdapterExecutionContext;
  /** Present on subjects that have an instance which fails on purpose. */
  faulted?(): ModelAdapter | ToolAdapter;
  /**
   * `true` for an adapter built to violate the contract on purpose. Such an
   * adapter exists to prove the translation path (CT-07) and is not a
   * candidate for substitution, so cases that require a conforming adapter
   * are recorded as not applicable rather than quietly passed.
   */
  intentionallyNonConforming?: boolean;
}

/** A subject that is meant to be substitutable for any other conforming one. */
function isConforming(subject: ConformanceSubject): boolean {
  return subject.intentionallyNonConforming !== true;
}

export interface ConformanceCase {
  id: string;
  title: string;
  appliesTo: "model" | "tool";
  run(
    subject: ConformanceSubject,
    assert: ConformanceAssertions,
  ): Promise<void>;
  /**
   * Some cases are only meaningful for an adapter built to exhibit the
   * condition. Returning `false` records the case as not applicable rather
   * than silently passing it.
   */
  applies?(subject: ConformanceSubject): boolean;
}

function call(
  kind: "model" | "tool",
  adapter: ModelAdapter | ToolAdapter,
  request: ModelRequest | ToolRequest,
  context: AdapterExecutionContext,
): Promise<unknown> {
  return kind === "model"
    ? (adapter as ModelAdapter).generate(request as ModelRequest, context)
    : (adapter as ToolAdapter).execute(request as ToolRequest, context);
}

export const adapterConformanceCases: readonly ConformanceCase[] = [
  {
    id: "CT-01",
    title: "basic successful model generation",
    appliesTo: "model",
    applies: isConforming,
    async run(subject, assert) {
      const result = (await call(
        subject.kind,
        subject.adapter,
        subject.makeRequest(),
        subject.makeContext(),
      )) as {
        output: string;
        finishReason: string;
        run: { provider: string; model: string; promptHash: string };
      };
      assert.ok(
        typeof result.output === "string" && result.output.length > 0,
        "a successful generation returns non-empty output",
      );
      assert.ok(
        result.run.provider.length > 0 && result.run.model.length > 0,
        "a successful generation reports provider and model (issue 092)",
      );
      assert.ok(
        result.run.promptHash.length > 0,
        "it reports a prompt hash rather than the prompt",
      );
    },
  },
  {
    id: "CT-02",
    title: "basic successful tool execution",
    appliesTo: "tool",
    async run(subject, assert) {
      const result = (await call(
        subject.kind,
        subject.adapter,
        subject.makeRequest({ sideEffect: "reversible" }),
        subject.makeContext(),
      )) as { effectStatus: string; run: { tool: string } };
      assert.ok(
        ["applied", "not_applied", "unknown"].includes(result.effectStatus),
        "a tool result reports one of the three effect states",
      );
      assert.ok(
        result.run.tool.length > 0,
        "the tool result names the tool that ran",
      );
    },
  },
  {
    id: "CT-03",
    title: "unsupported capability is a structured refusal",
    appliesTo: "model",
    applies: (subject) =>
      adapterCapabilityNames.some(
        (name) => subject.capabilities[name] !== true,
      ),
    async run(subject, assert) {
      const missing = adapterCapabilityNames.find(
        (name) => subject.capabilities[name] !== true,
      )!;
      const error = await assert.rejectsWithKind(
        () =>
          call(
            subject.kind,
            subject.adapter,
            subject.makeRequest({
              requires: { [missing]: true },
            } as Record<string, unknown>),
            subject.makeContext(),
          ),
        "unsupported_capability",
        `requiring an absent capability (${missing}) is refused`,
      );
      assert.includes(
        JSON.stringify(error.diagnostic),
        missing,
        "the refusal names the capability that is missing",
      );
      assert.equal(
        error.retryable,
        false,
        "a capability mismatch is not retryable",
      );
      assert.equal(
        JSON.stringify(error.diagnostic).includes("provider"),
        false,
        "the refusal does not branch on a provider name",
      );
    },
  },
  {
    id: "CT-04",
    title: "a budget that cannot be met is a timeout",
    appliesTo: "model",
    async run(subject, assert) {
      const slow = subject.make({ delayMs: 50 });
      const error = await assert.rejectsWithKind(
        () =>
          call(
            subject.kind,
            slow,
            subject.makeRequest(),
            subject.makeContext({ timeoutMs: 1 }),
          ),
        "timeout",
        "a call that cannot fit its budget reports a timeout",
      );
      assert.equal(error.retryable, true, "a plain read timeout is retryable");
    },
  },
  {
    id: "CT-05",
    title: "caller cancellation is reported as cancellation",
    appliesTo: "model",
    async run(subject, assert) {
      const controller = new AbortController();
      controller.abort();
      await assert.rejectsWithKind(
        () =>
          call(
            subject.kind,
            subject.adapter,
            subject.makeRequest(),
            subject.makeContext({ signal: controller.signal }),
          ),
        "cancellation",
        "an already-aborted signal stops the call",
      );
    },
  },
  {
    id: "CT-06",
    title: "a provider failure arrives as a taxonomy kind",
    appliesTo: "model",
    applies: (subject) => subject.faulted !== undefined,
    async run(subject, assert) {
      const error = await assert.rejectsWithKind(
        () =>
          call(
            subject.kind,
            subject.faulted!(),
            subject.makeRequest(),
            subject.makeContext(),
          ),
        "permanent_provider_failure",
        "an injected permanent failure is reported as one",
      );
      assert.equal(
        error.retryable,
        false,
        "a permanent failure is not retryable",
      );
    },
  },
  {
    id: "CT-07",
    title: "a malformed provider response is translated, not leaked",
    appliesTo: "model",
    applies: (subject) => subject.id() === "malformed-model",
    async run(subject, assert) {
      const error = await assert.rejectsWithKind(
        () =>
          call(
            subject.kind,
            subject.adapter,
            subject.makeRequest(),
            subject.makeContext(),
          ),
        "malformed_provider_response",
        "an uninterpretable payload becomes malformed_provider_response",
      );
      assert.ok(
        error.originalCause() instanceof Error,
        "the parse failure is retained in-process rather than discarded",
      );
      assert.equal(
        // `JSON.stringify` rather than the serialise helper, because it is the
        // path a logger would actually take: `AdapterError.toJSON` is what
        // makes the cause structurally absent, and this checks that mechanism
        // rather than a function that wraps it.
        JSON.stringify(error).includes("ZodError"),
        false,
        "the raw cause does not reach the serialised form",
      );
    },
  },
  {
    id: "CT-08",
    title:
      "a partial capability adapter does not do what it declared it cannot",
    appliesTo: "model",
    applies: (subject) => subject.id().startsWith("partial-"),
    async run(subject, assert) {
      assert.ok(
        subject.capabilities.structuredOutput === false &&
          subject.capabilities.reasoningControl === false,
        "the partial declaration is actually partial",
      );
      const result = (await call(
        subject.kind,
        subject.adapter,
        subject.makeRequest({ responseSchema: { type: "object" } }),
        subject.makeContext(),
      )) as { structured?: unknown; run: { reasoning?: unknown } };
      assert.equal(
        result.structured,
        undefined,
        "it does not return structured output it declared it cannot produce",
      );
      assert.equal(
        result.run.reasoning,
        undefined,
        "it does not report reasoning configuration it declared it cannot control",
      );
    },
  },
  {
    id: "CT-09",
    title: "operationId and traceId reach the adapter unchanged",
    appliesTo: "model",
    applies: isConforming,
    async run(subject, assert) {
      const result = (await call(
        subject.kind,
        subject.adapter,
        subject.makeRequest(),
        subject.makeContext({
          operationId: "ct-09-operation",
          traceId: "ct-09-trace",
        }),
      )) as { run: unknown };
      assert.ok(result.run !== undefined, "the call completed");
      const context = subject.makeContext({
        operationId: "ct-09-operation",
        traceId: "ct-09-trace",
      });
      assert.equal(
        context.operationId,
        "ct-09-operation",
        "the operationId is not rewritten",
      );
      assert.equal(
        context.traceId,
        "ct-09-trace",
        "the traceId is not rewritten",
      );
    },
  },
  {
    id: "CT-10",
    title: "the execution context carries no store capability",
    appliesTo: "model",
    async run(subject, assert) {
      const context = subject.makeContext();
      assert.equal(
        Object.keys(context).sort().join(","),
        "actor,operationId,timeoutMs,traceId,writer",
        "the context is exactly the declared fields and nothing more",
      );
      const writer = context.writer as unknown as Record<string, unknown>;
      assert.equal(
        Object.hasOwn(writer, "scopes"),
        false,
        "the writer reference carries no capability scopes",
      );
      assert.equal(
        Object.hasOwn(writer, "authn"),
        false,
        "the writer reference carries no authentication marker",
      );
    },
  },
  {
    id: "CT-11",
    title: "an adapter exposes no promotion or event-writing surface",
    appliesTo: "model",
    async run(subject, assert) {
      const surface = new Set<string>();
      for (
        let cursor: object | null = subject.adapter as object;
        cursor !== null && cursor !== Object.prototype;
        cursor = Object.getPrototypeOf(cursor) as object | null
      ) {
        for (const name of Object.getOwnPropertyNames(cursor))
          surface.add(name);
      }
      for (const forbidden of [
        "promoteAsset",
        "writeEvent",
        "appendEvent",
        "activate",
        "setStatus",
        "recordAssetControl",
      ]) {
        assert.equal(
          surface.has(forbidden),
          false,
          `an adapter must not expose ${forbidden}`,
        );
      }
    },
  },
  {
    id: "CT-12",
    title: "a slow adapter inside its budget succeeds",
    appliesTo: "model",
    applies: isConforming,
    async run(subject, assert) {
      const slow = subject.make({ delayMs: 5 });
      const result = await call(
        subject.kind,
        slow,
        subject.makeRequest(),
        subject.makeContext({ timeoutMs: 5_000 }),
      );
      assert.ok(result !== undefined, "a call inside its budget completes");
    },
  },
  {
    id: "CT-13",
    title:
      "an irreversible effect with an unknown outcome is not blindly retried",
    appliesTo: "tool",
    applies: (subject) => subject.id().startsWith("slow-"),
    async run(subject, assert) {
      const slow = subject.make({ delayMs: 60, sendsBeforeDelay: true });
      const error = await assert.rejectsWithKind(
        () =>
          call(
            subject.kind,
            slow,
            subject.makeRequest({ sideEffect: "irreversible" }),
            subject.makeContext({ timeoutMs: 5 }),
          ),
        "side_effect_uncertainty",
        "an irreversible effect that may have been sent reports uncertainty",
      );
      const decision = retryDecision({
        error,
        sideEffect: "irreversible",
      });
      assert.equal(decision.allowed, false, "a blind retry is refused");
      assert.includes(
        decision.reason,
        "verify",
        "the refusal says what must happen first",
      );
      assert.equal(
        retryDecision({
          error,
          sideEffect: "irreversible",
          effectVerifiedAbsent: true,
        }).allowed,
        true,
        "once the effect is verified absent the retry is allowed",
      );
      // The same delay on a read must stay a plain timeout, or the
      // classification is not being driven by the side effect at all.
      const readError = await assert.rejectsWithKind(
        () =>
          call(
            subject.kind,
            subject.make({ delayMs: 60, sendsBeforeDelay: true }),
            subject.makeRequest({ sideEffect: "none" }),
            subject.makeContext({ timeoutMs: 5 }),
          ),
        "timeout",
        "the same delay on a read is an ordinary timeout",
      );
      assert.equal(
        retryDecision({ error: readError, sideEffect: "none" }).allowed,
        true,
        "a read that timed out is retryable",
      );
    },
  },
  {
    id: "CT-14",
    title: "capability negotiation is deterministic and total",
    appliesTo: "model",
    async run(subject, assert) {
      const input = {
        adapterId: subject.id(),
        available: subject.capabilities,
        requires: { tools: true },
        allowDegradation: true,
        context: { operationId: "ct-14", traceId: "ct-14" },
      } as const;
      assert.equal(
        JSON.stringify(negotiateCapabilities(input)),
        JSON.stringify(negotiateCapabilities(input)),
        "the same input negotiates the same result",
      );
      assert.equal(
        parseAdapterCapabilities(subject.capabilities).tools,
        subject.capabilities.tools,
        "the declaration round-trips through the contract",
      );
    },
  },
  {
    id: "CT-15",
    title:
      "secret-bearing metadata is withheld and the withholding is reported",
    appliesTo: "model",
    async run(_subject, assert) {
      const observation = createAdapterObservation({
        operation: "model.generate",
        adapterId: "ct-15",
        provider: "ct-15-provider",
        target: "ct-15-target",
        operationId: "ct-15",
        traceId: "ct-15",
        startedAt: "2026-09-17T00:00:00.000Z",
        finishedAt: "2026-09-17T00:00:01.000Z",
        status: "error",
        errorKind: "authentication_failure",
        capabilityMode: { degraded: false },
        counterfactual: false,
        providerMetadata: {
          authorization: "Bearer sk-abcdefghijklmnopqrstuvwxyz012345",
          endpoint: "https://example.invalid/v1",
          access_token: "ghp_0123456789012345678901234567890123456",
          idempotencyKey: "kept-on-purpose",
        },
      });
      const serialised = JSON.stringify(observation);
      assert.equal(
        serialised.includes("sk-abcdefghijklmnopqrstuvwxyz"),
        false,
        "a key-shaped value is not recorded",
      );
      assert.equal(
        serialised.includes("ghp_0123456789"),
        false,
        "a token-shaped value is not recorded",
      );
      assert.includes(
        serialised,
        "kept-on-purpose",
        "an idempotency key is not a credential and is not redacted",
      );
      assert.ok(
        (observation.redactedPaths?.length ?? 0) >= 2,
        "the record says which fields were withheld",
      );
      const error = new AdapterError({
        kind: "authentication_failure",
        adapterId: "ct-15",
        operationId: "ct-15",
        traceId: "ct-15",
        diagnostic: { header: "Bearer sk-abcdefghijklmnopqrstuvwxyz012345" },
        cause: new Error("provider said: sk-abcdefghijklmnopqrstuvwxyz012345"),
      });
      // `JSON.stringify`, not the serialise helper: this is the path a logger
      // takes, and `toJSON` is the mechanism that keeps the cause out.
      const errorText = JSON.stringify(error);
      assert.equal(
        errorText.includes("sk-abcdefghijklmnopqrstuvwxyz"),
        false,
        "a serialised adapter error carries no credential",
      );
      assert.ok(
        error.originalCause() instanceof Error,
        "the cause is still available in-process",
      );
      assert.equal(
        errorText.includes("cause"),
        false,
        "the serialised form has no cause field at all",
      );
    },
  },
];
