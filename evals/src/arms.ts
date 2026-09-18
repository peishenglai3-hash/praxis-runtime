/**
 * The ablation arms.
 *
 * The owner's brief §2 is blunt about the measurement that matters:
 *
 *   "核心问题不是「开着 Praxis 能不能成功？」而是「相比更简单的系统，Praxis
 *    带来了多少净收益，以及付出了多少成本？」"
 *
 * A run of Praxis that succeeds therefore proves nothing on its own. Every
 * claim this package makes about benefit is a *difference* against a simpler
 * arm run on the same scenario, and an arm that was never run produces
 * `not-comparable` rather than an implied zero.
 *
 * ## Why these six, and why the runtime already had them
 *
 * The runtime is a stack of phase boundaries — `Phase2Runtime` →
 * `Phase3Runtime` → `Phase4Runtime` → `Phase5Runtime` — and each boundary was
 * built to add exactly one of the mechanisms the brief names. The ablation
 * ladder is therefore **the existing class hierarchy, not a new one**. No
 * runtime file is modified to run an arm; that is what keeps this inside the
 * Practice Freeze, and it is also why the arms are a fair test: the code paths
 * being compared are the same ones the product actually runs.
 *
 * | Arm | Runtime boundary | What it adds |
 * | --- | --- | --- |
 * | `base` | none | the model, and nothing else |
 * | `state` | `Phase2Runtime` | append-first ledger, projections, `ContextPlanner` |
 * | `reflection` | `Phase3Runtime` | expectations, residual detection, reflection |
 * | `full` | `Phase4Runtime` | reusable assets, promotion, asset-fed context |
 * | `full-no-asset` | `Phase4Runtime`, empty registry | E — is the gain from *having* history, or from *institutionalising* it? |
 * | `full-stale-asset` | `Phase4Runtime`, superseded asset installed | F — can it challenge a rule that is now wrong? |
 *
 * `full-no-asset` and `full-stale-asset` are the two the brief marks
 * "必要时" (when necessary). They are included because they are the only arms
 * that can distinguish a runtime which *learns* from one which merely
 * *accumulates*, and a runtime which *corrects* from one which merely
 * *repeats*.
 */

import type { ArmId } from "./scenario.js";

export interface ArmCapabilities {
  /** Events are appended to a durable ledger. */
  readonly ledger: boolean;
  /** Projections are caught up and a `ContextPlan` is built from them. */
  readonly contextPlanner: boolean;
  /** An expectation is registered before the act and verified after it. */
  readonly expectations: boolean;
  /** Residuals are detected from the expectation/observation pair. */
  readonly residuals: boolean;
  /** The reflection controller runs over detected residuals. */
  readonly reflection: boolean;
  /** Candidates may be created and promoted to active reusable assets. */
  readonly assets: boolean;
  /** Active assets are fed back into the next episode's context. */
  readonly assetFeedback: boolean;
  /** Historical asset state is pre-seeded before episode 1 (empty for E). */
  readonly seededAssets: "none" | "empty-registry" | "superseded";
}

export interface ArmDefinition {
  readonly id: ArmId;
  /** Short label for tables. */
  readonly label: string;
  /** The owner's brief §2 letter, where the arm corresponds to one. */
  readonly briefLetter: "A" | "B" | "C" | "D" | "E" | "F";
  readonly capabilities: ArmCapabilities;
  /** What this arm is for, in one sentence. */
  readonly purpose: string;
  /** What a reader must not conclude from this arm. */
  readonly notA: string;
}

const NONE: ArmCapabilities = {
  ledger: false,
  contextPlanner: false,
  expectations: false,
  residuals: false,
  reflection: false,
  assets: false,
  assetFeedback: false,
  seededAssets: "none",
};

export const ARMS: Readonly<Record<ArmId, ArmDefinition>> = Object.freeze({
  base: {
    id: "base",
    label: "BASE",
    briefLetter: "A",
    capabilities: NONE,
    purpose:
      "The model alone: the task text goes in, the answer comes out, and nothing is remembered.",
    notA:
      "It is not a weak version of Praxis. It is the baseline every other arm is " +
      "subtracted from, and a difference against it is the only quantity that " +
      "means anything.",
  },

  state: {
    id: "state",
    label: "STATE ONLY",
    briefLetter: "B",
    capabilities: {
      ...NONE,
      ledger: true,
      contextPlanner: true,
    },
    purpose:
      "History is recorded and context is selected from it — the memory arm, with " +
      "no residual, no reflection and no institutionalisation.",
    notA:
      "It is not a control for cost. It pays the ledger's storage and retrieval " +
      "cost while claiming none of the learning benefit, so the difference between " +
      "`base` and `state` is the price of remembering, not the value of it.",
  },

  reflection: {
    id: "reflection",
    label: "REFLECTION",
    briefLetter: "C",
    capabilities: {
      ...NONE,
      ledger: true,
      contextPlanner: true,
      expectations: true,
      residuals: true,
      reflection: true,
    },
    purpose:
      "State plus expectations, residual detection and the reflection controller — " +
      "the runtime can now notice that something went wrong.",
    notA:
      "Noticing is not correcting. This arm produces residuals and reflection " +
      "decisions that are recorded and then go nowhere, so a scenario whose " +
      "benefit depends on *reusing* a lesson should show no gain here.",
  },

  full: {
    id: "full",
    label: "FULL PRAXIS",
    briefLetter: "D",
    capabilities: {
      ...NONE,
      ledger: true,
      contextPlanner: true,
      expectations: true,
      residuals: true,
      reflection: true,
      assets: true,
      assetFeedback: true,
      seededAssets: "none",
    },
    purpose: "The complete Phase 6 runtime as it actually ships.",
    notA:
      "It is not the arm to quote when the question is whether assets help. " +
      "Compare `full` against `full-no-asset` for that; comparing it against " +
      "`base` conflates four mechanisms into one number.",
  },

  "full-no-asset": {
    id: "full-no-asset",
    label: "FULL, EMPTY REGISTRY",
    briefLetter: "E",
    capabilities: {
      ...NONE,
      ledger: true,
      contextPlanner: true,
      expectations: true,
      residuals: true,
      reflection: true,
      assets: true,
      assetFeedback: true,
      seededAssets: "empty-registry",
    },
    purpose:
      "FULL PRAXIS with a working asset subsystem and an empty registry: the " +
      "machinery is present, the institutional memory is not.",
    notA:
      "It does not isolate the *promotion gate* from the *asset*, because assets " +
      "promoted during the run are live for later episodes. It isolates the " +
      "value of history that predates the run.",
  },

  "full-stale-asset": {
    id: "full-stale-asset",
    label: "FULL, STALE ASSET",
    briefLetter: "F",
    capabilities: {
      ...NONE,
      ledger: true,
      contextPlanner: true,
      expectations: true,
      residuals: true,
      reflection: true,
      assets: true,
      assetFeedback: true,
      seededAssets: "superseded",
    },
    purpose:
      "FULL PRAXIS starting with an active asset that the scenario later " +
      "contradicts — the only arm that can demonstrate challenge and correction.",
    notA:
      "An arm that scores *better* here is not necessarily better. A runtime that " +
      "ignores a stale rule and a runtime that correctly overrides it can produce " +
      "the same task outcome; only the challenge events distinguish them, which is " +
      "why this arm reports `challenge` counts beside success.",
  },
});

export const ALL_ARM_IDS: readonly ArmId[] = Object.freeze([
  "base",
  "state",
  "reflection",
  "full",
  "full-no-asset",
  "full-stale-asset",
]);

/** The arms that must be run for a scenario's comparison to count as complete. */
export const MINIMUM_COMPARISON_ARMS: readonly ArmId[] = Object.freeze([
  "base",
  "state",
  "reflection",
  "full",
]);

/**
 * Mechanisms the arms claim but the harness does not yet drive.
 *
 * The header of this file says an arm must never silently degrade into a
 * simpler one. Declaring a capability the harness never exercises is the same
 * defect from the other direction: `full` lists `assets: true`, and a reader of
 * an ablation table would reasonably conclude that asset feedback was part of
 * what was measured. It is not, yet.
 *
 * This list is surfaced in every manifest the harness writes, so no result can
 * be read without it. The asset lifecycle is no longer listed here: Round 1
 * wiring exercises it in `evals/test/assets.test.ts`. Removing an entry
 * requires the code that exercises it, not a decision that the entry is
 * inconvenient.
 */
export const MECHANISMS_NOT_YET_WIRED: readonly string[] = Object.freeze([
  "scaffold variation — `scaffold` is recorded in the manifest but only one scaffold exists",
]);

export function arm(id: ArmId): ArmDefinition {
  const found = ARMS[id];
  if (found === undefined) throw new Error(`unknown arm "${id}"`);
  return found;
}

/**
 * Which arms a comparison is still missing.
 *
 * Reported rather than filled in. A scenario measured on three of four arms is
 * `INCOMPLETE`, and the missing arm is named — because the alternative is a
 * report that quietly compares `full` against `base` and calls it an ablation.
 */
export function missingArms(measured: readonly ArmId[]): ArmId[] {
  const present = new Set(measured);
  return MINIMUM_COMPARISON_ARMS.filter((id) => !present.has(id));
}
