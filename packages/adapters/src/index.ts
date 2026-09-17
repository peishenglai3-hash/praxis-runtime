/**
 * `@praxis/adapters` — the provider boundary (Phase 6B / EPIC-010).
 *
 * This package is where a provider SDK is allowed to live. It is the only
 * core package excluded from the `core-does-not-depend-on-provider-sdks`
 * dependency-cruiser rule, and that exclusion is deliberate: Bible section
 * 10.2 says 「核心 DTO 禁止包含 OpenAI/DeepSeek/Gemini SDK 类型」 and ADR-0003
 * says provider SDK types stay *behind adapter ports*. Keeping them out of the
 * other packages achieves nothing if they are also kept out of the only place
 * that is supposed to have them.
 *
 * The package currently contains no provider SDK at all. Its content is the
 * deterministic reference adapters and the machinery every adapter needs, so
 * that the boundary can be proved before anything connects to a network.
 */

export {
  DummyModelAdapter,
  DummyToolAdapter,
  type DummyAdapterOptions,
} from "./dummy.js";

export {
  FaultPlanRunner,
  FaultyModelAdapter,
  FaultyToolAdapter,
  MalformedResponseModelAdapter,
  PartialCapabilityModelAdapter,
  PartialCapabilityToolAdapter,
  SlowModelAdapter,
  SlowToolAdapter,
  type FaultPlan,
} from "./faulty.js";

export {
  adapterConformanceCases,
  type ConformanceAssertions,
  type ConformanceCase,
  type ConformanceSubject,
  type SubjectTiming,
} from "./conformance.js";

export {
  assertModelRequestShape,
  capabilityModeOf,
  negotiateCapabilities,
  type CapabilityNegotiation,
  type NegotiationInput,
} from "./negotiation.js";

export {
  createAdapterObservation,
  InMemoryAdapterObserver,
  adapterOperations,
  type AdapterObservation,
  type AdapterObserver,
  type AdapterOperation,
} from "./observability.js";

export { digestOf, errorContext, stableText, wait } from "./timing.js";
