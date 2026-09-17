import {
  sanitiseAdapterDiagnostic,
  type AdapterErrorKind,
  type AdapterUsage,
  type JsonObject,
} from "@praxis/contracts";

/**
 * Provider-neutral adapter observability (Phase 6B, owner section 10).
 *
 * The rule is that the shared vocabulary is provider-neutral and
 * provider-specific detail is scoped. There is deliberately no
 * `openaiLatency` or `claudeLatency` field here and there never will be: a
 * core field named after a vendor is a vendor decision that has been mistaken
 * for a design.
 *
 * What is recorded is what every adapter can supply, plus an explicit
 * `providerMetadata` bag for the rest. That bag is sanitised on the way in,
 * so a provider that puts a token in its error detail cannot get it into a
 * log by way of this record.
 */

export const adapterOperations = ["model.generate", "tool.execute"] as const;
export type AdapterOperation = (typeof adapterOperations)[number];

export interface AdapterObservation {
  operation: AdapterOperation;
  /** Which adapter served the call. */
  adapterId: string;
  /** The opaque provider label the adapter declares. */
  provider: string;
  /** The model or tool as the provider names it. */
  target: string;
  operationId: string;
  traceId: string;
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  /** Present when `status` is `error`. Never a raw provider exception. */
  errorKind?: AdapterErrorKind;
  usage?: AdapterUsage;
  /** The capability set actually used, after negotiation. */
  capabilityMode: JsonObject;
  /** `true` when the run came from a replay rather than a live call. */
  counterfactual: boolean;
  /** Provider-specific detail, scoped. Sanitised before it is stored. */
  providerMetadata?: JsonObject;
  /** Dotted paths in `providerMetadata` whose value was withheld. */
  redactedPaths?: string[];
}

export interface AdapterObserver {
  record(observation: AdapterObservation): void;
}

/** The default observer: keeps observations in memory for a caller to read. */
export class InMemoryAdapterObserver implements AdapterObserver {
  readonly #observations: AdapterObservation[] = [];

  record(observation: AdapterObservation): void {
    this.#observations.push(observation);
  }

  observations(): readonly AdapterObservation[] {
    return this.#observations;
  }

  clear(): void {
    this.#observations.length = 0;
  }
}

export function createAdapterObservation(input: {
  operation: AdapterOperation;
  adapterId: string;
  provider: string;
  target: string;
  operationId: string;
  traceId: string;
  startedAt: string;
  finishedAt: string;
  status: "ok" | "error";
  errorKind?: AdapterErrorKind;
  usage?: AdapterUsage;
  capabilityMode: JsonObject;
  counterfactual: boolean;
  providerMetadata?: JsonObject;
}): AdapterObservation {
  const sanitised = sanitiseAdapterDiagnostic(input.providerMetadata);
  const durationMs = Math.max(
    0,
    Date.parse(input.finishedAt) - Date.parse(input.startedAt),
  );
  return {
    operation: input.operation,
    adapterId: input.adapterId,
    provider: input.provider,
    target: input.target,
    operationId: input.operationId,
    traceId: input.traceId,
    startedAt: input.startedAt,
    durationMs,
    status: input.status,
    ...(input.errorKind === undefined ? {} : { errorKind: input.errorKind }),
    ...(input.usage === undefined ? {} : { usage: input.usage }),
    capabilityMode: input.capabilityMode,
    counterfactual: input.counterfactual,
    ...(input.providerMetadata === undefined
      ? {}
      : { providerMetadata: sanitised.value }),
    ...(sanitised.redactedPaths.length === 0
      ? {}
      : { redactedPaths: [...sanitised.redactedPaths] }),
  };
}
