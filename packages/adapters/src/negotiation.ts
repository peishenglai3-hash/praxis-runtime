import {
  AdapterError,
  adapterCapabilityNames,
  parseAdapterCapabilities,
  type AdapterCapabilities,
  type AdapterCapabilityName,
  type AdapterCapabilityRequirement,
  type JsonObject,
  type ModelRequest,
} from "@praxis/contracts";

/**
 * Capability negotiation (Phase 6B, owner section 6).
 *
 * The rule the owner froze is that the runtime must not infer capabilities
 * from provider names:
 *
 *     forbidden:  if (provider === "openai") ...
 *     preferred:  if (capabilities.structuredOutput) ...
 *
 * This module is the only place that answers "can this adapter do that", and
 * its answer is fail-closed. A caller that needs a capability it does not get
 * is refused with a structured error, unless it said in advance that it would
 * accept less.
 */

export interface CapabilityNegotiation {
  adapterId: string;
  /** What the adapter declared. */
  available: AdapterCapabilities;
  /** What the call asked for. */
  requested: AdapterCapabilityRequirement;
  /** Requested capabilities the adapter does not have. */
  missing: AdapterCapabilityName[];
  /** `true` when nothing is missing. */
  satisfied: boolean;
  /** The capability set the call may rely on. */
  effective: AdapterCapabilities;
  /** `true` when the call proceeds with less than it asked for. */
  degraded: boolean;
  /** Why it is degraded. Present only when `degraded` is true. */
  degradedReason?: string;
}

export interface NegotiationInput {
  adapterId: string;
  available: AdapterCapabilities;
  requires?: AdapterCapabilityRequirement;
  allowDegradation?: boolean;
  context: { operationId: string; traceId: string };
}

function missingCapabilities(
  available: AdapterCapabilities,
  requested: AdapterCapabilityRequirement,
): AdapterCapabilityName[] {
  const missing: AdapterCapabilityName[] = [];
  for (const name of adapterCapabilityNames) {
    if (requested[name] === true && available[name] !== true) {
      missing.push(name);
    }
  }
  return missing;
}

/**
 * Resolve a call's capability requirements against an adapter's declaration.
 *
 * Throws `unsupported_capability` when something required is absent and the
 * caller did not pre-authorise degradation. The error lists what is missing
 * and what the adapter does have, so the caller can act without guessing.
 */
export function negotiateCapabilities(
  input: NegotiationInput,
): CapabilityNegotiation {
  const available = parseAdapterCapabilities(input.available);
  const requested = input.requires ?? {};
  const missing = missingCapabilities(available, requested);
  const satisfied = missing.length === 0;

  if (!satisfied && input.allowDegradation !== true) {
    throw new AdapterError({
      kind: "unsupported_capability",
      adapterId: input.adapterId,
      operationId: input.context.operationId,
      traceId: input.context.traceId,
      message: `${input.adapterId} cannot satisfy: ${missing.join(", ")}`,
      diagnostic: {
        missing,
        // Listing what *is* available is not a convenience: without it the
        // caller's only recovery is to guess at provider names, which is the
        // thing this module exists to prevent.
        available: adapterCapabilityNames.filter(
          (name) => available[name] === true,
        ),
      },
    });
  }

  return {
    adapterId: input.adapterId,
    available,
    requested,
    missing,
    satisfied,
    effective: available,
    degraded: !satisfied,
    ...(satisfied
      ? {}
      : {
          degradedReason: `proceeding without: ${missing.join(", ")}`,
        }),
  };
}

/**
 * Request-shape rules that follow from a negotiated capability set.
 *
 * These are refused as `invalid_request` rather than as a capability failure:
 * asking for structured output without saying what structure, or claiming an
 * idempotency guarantee without providing a key, is a malformed call, not an
 * adapter limitation.
 */
export function assertModelRequestShape(
  request: ModelRequest,
  context: { adapterId: string; operationId: string; traceId: string },
): void {
  const wantsStructured = request.requires?.structuredOutput === true;
  if (wantsStructured && request.responseSchema === undefined) {
    throw new AdapterError({
      kind: "invalid_request",
      adapterId: context.adapterId,
      operationId: context.operationId,
      traceId: context.traceId,
      message:
        "a request that requires structuredOutput must supply a responseSchema",
    });
  }
}

/**
 * The capability set, as a JSON object, for `ModelRunMetadata.capabilityMode`.
 *
 * `degraded` is included because a reader of a recorded run has to be able to
 * tell whether the call got what it asked for. A run that silently ran with
 * less is exactly the kind of thing that gets misread later as a complete one.
 */
export function capabilityModeOf(
  negotiation: CapabilityNegotiation,
): JsonObject {
  const mode: JsonObject = {};
  for (const name of adapterCapabilityNames) {
    mode[name] = negotiation.effective[name] === true;
  }
  if (negotiation.effective.maxContextTokens !== undefined) {
    mode["maxContextTokens"] = negotiation.effective.maxContextTokens;
  }
  mode["degraded"] = negotiation.degraded;
  return mode;
}
