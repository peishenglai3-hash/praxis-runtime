import { createHash } from "node:crypto";

import {
  AdapterError,
  type AdapterExecutionContext,
  type AdapterWriterRef,
  type JsonValue,
} from "@praxis/contracts";

/**
 * Shared timing and determinism helpers for the reference adapters.
 *
 * These exist so that every adapter in this package handles the two
 * first-class contract semantics the same way. An adapter that invents its own
 * cancellation behaviour is an adapter whose cancellation behaviour nobody
 * knows.
 */

/** A stable digest, used to make a dummy adapter's output deterministic. */
export function digestOf(value: JsonValue | string): string {
  const text = typeof value === "string" ? value : stableText(value);
  return createHash("sha256").update(text).digest("hex");
}

/**
 * A deterministic serialisation. Key order is sorted so that two structurally
 * equal values always produce the same digest, whatever order their keys were
 * built in.
 */
export function stableText(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableText(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableText(item)}`)
    .join(",")}}`;
}

/** The three fields every adapter error needs to identify itself. */
export function errorContext(
  adapterId: string,
  context: AdapterExecutionContext,
): { adapterId: string; operationId: string; traceId: string } {
  return {
    adapterId,
    operationId: context.operationId,
    traceId: context.traceId,
  };
}

function assertContext(
  adapterId: string,
  context: AdapterExecutionContext,
): void {
  if (context.operationId.length < 1) {
    throw new Error(`${adapterId}: execution context requires an operationId`);
  }
  if (context.traceId.length < 1) {
    throw new Error(`${adapterId}: execution context requires a traceId`);
  }
  if (!Number.isSafeInteger(context.timeoutMs) || context.timeoutMs < 1) {
    throw new Error(`${adapterId}: execution context requires a timeoutMs`);
  }
}

export interface WaitOptions {
  adapterId: string;
  context: AdapterExecutionContext;
  /** The work this wait stands in for. Affects the failure it reports. */
  sideEffectMayHaveOccurred?: boolean;
}

/**
 * Wait, honouring both the wall-clock budget and the cancellation signal.
 *
 * The two failures are distinct on purpose. A caller that cancelled gets
 * `cancellation`, which is not retryable — retrying would contradict the
 * cancellation. A budget that ran out gets `timeout`, whose retryability
 * depends on whether the work could already have changed something.
 *
 * When the wait stands in for work that may already have been sent, a budget
 * expiry is reported as `side_effect_uncertainty` instead: the call did not
 * merely take too long, it may have happened.
 */
export async function wait(
  milliseconds: number,
  options: WaitOptions,
): Promise<void> {
  const { adapterId, context } = options;
  assertContext(adapterId, context);
  if (milliseconds <= 0) return;

  const failure = (): AdapterError => {
    if (options.sideEffectMayHaveOccurred === true) {
      return new AdapterError({
        kind: "side_effect_uncertainty",
        ...errorContext(adapterId, context),
        message: `${adapterId}: the call may have taken effect before its budget ran out`,
        diagnostic: { budgetMs: context.timeoutMs, elapsedMs: milliseconds },
      });
    }
    return new AdapterError({
      kind: "timeout",
      ...errorContext(adapterId, context),
      diagnostic: { budgetMs: context.timeoutMs, elapsedMs: milliseconds },
    });
  };

  if (milliseconds > context.timeoutMs) throw failure();

  const signal = context.signal;
  if (signal?.aborted === true) {
    throw new AdapterError({
      kind: "cancellation",
      ...errorContext(adapterId, context),
      message: `${adapterId}: cancelled before the call started`,
    });
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => {
      finish(() =>
        reject(
          new AdapterError({
            kind: "cancellation",
            ...errorContext(adapterId, context),
            message: `${adapterId}: cancelled during the call`,
          }),
        ),
      );
    };
    // One timer, because the budget case is already handled above: this wait
    // is never longer than the budget, so the only race left is cancellation.
    const timer = setTimeout(() => {
      finish(resolve);
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The metadata every reference adapter reports. Kept in one place so the
 * conformance suite can require the same fields from all of them.
 */
export interface ReferenceRunInput {
  provider: string;
  model: string;
  operationId: string;
  capabilityMode: JsonValue;
  promptHash: string;
  configHash: string;
  counterfactual: boolean;
  scaffold?: string;
}

export function writerRefOf(
  writer: AdapterExecutionContext["writer"],
): AdapterWriterRef {
  return {
    writerId: writer.writerId,
    kind: writer.kind,
    role: writer.role,
  };
}
