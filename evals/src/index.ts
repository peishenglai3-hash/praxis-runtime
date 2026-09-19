/**
 * `@praxis/evals` — the external evaluator for `praxis-runtime`.
 *
 * ## The boundary, in one paragraph
 *
 * This package depends on the runtime. **Nothing in the runtime depends on this
 * package**, and that is enforced rather than intended — see
 * [`../docs/ADR/ADR-0015-evaluation-harness-boundary.md`] for the decision and
 * `evals/test/boundary.test.ts` for the check. The direction matters because an
 * evaluator that the subject can reach is an evaluator the subject can
 * influence, and the whole point of Phase 6V is to find out what the runtime
 * does when it is not the one keeping score.
 *
 * Nothing here is on the runtime's critical path. `pnpm verify` does not run
 * these experiments; they need credentials, a model and time, and a gate that
 * needs a network is not a gate.
 */

export {
  formatRate,
  incrementalBenefit,
  rate,
  UNSCORED,
  type IncrementalBenefit,
  type Rate,
  type RateStatus,
} from "./rate.js";

export {
  buildManifest,
  gitFacts,
  manifestSchema,
  manifestSchemaPath,
  ManifestConformanceError,
  writeManifest,
  assertIsoTimestamp,
  type Concurrency,
  type CorpusType,
  type GitFacts,
  type Ladder,
} from "./manifest.js";

export {
  UnsupportedSchemaKeywordError,
  validateAgainst,
  Validator,
  type SchemaViolation,
} from "./schema.js";

export {
  arm,
  ARMS,
  ALL_ARM_IDS,
  MECHANISMS_NOT_YET_WIRED,
  MINIMUM_COMPARISON_ARMS,
  missingArms,
  type ArmCapabilities,
  type ArmDefinition,
} from "./arms.js";

export {
  loadScenario,
  loadScenarios,
  parseScenario,
  ScenarioLoadError,
  scenariosDirectory,
  type ArmId,
  type CorpusProvenance,
  type Episode,
  type FieldPlacement,
  type LoadedScenario,
  type OracleExpectation,
  type Scenario,
  type VerifierSpec,
} from "./scenario.js";

export {
  computeMetrics,
  type EpisodeRecord,
  type MetricSet,
  type ScenarioComparison,
} from "./metrics.js";

export {
  BaseArmRuntime,
  createArmRuntime,
  PraxisArmRuntime,
  type ArmRuntime,
  type EpisodeContext,
  type EpisodeObservation,
  type EpisodeVerdict,
  type HumanControl,
  type HumanControlRequest,
  type Subject,
  type SubjectIdentity,
  type SubjectOutput,
} from "./runner.js";

export {
  commandVerifier,
  runScenario,
  sweepScenario,
  type RunOptions,
  type RunResult,
  type ScenarioSweepResult,
} from "./run.js";

export { FailingSubject, ScriptedSubject } from "./scripted-subject.js";
