import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ALL_ARM_IDS,
  MINIMUM_COMPARISON_ARMS,
  missingArms,
} from "../src/arms.js";
import { manifestSchema } from "../src/manifest.js";
import { validateAgainst } from "../src/schema.js";
import { computeMetrics } from "../src/metrics.js";
import { loadScenario } from "../src/scenario.js";
import { runScenario, type RunResult } from "../src/run.js";
import { FailingSubject, ScriptedSubject } from "../src/scripted-subject.js";
import type { ArmId } from "../src/scenario.js";

/**
 * The oracle path.
 *
 * This is the test the counterevidence scan says no evaluation project ever
 * found its own defect without. SWE-bench calls it `--gold`, Terminal-Bench
 * `--agent oracle`, Inspect Evals `mockllm`. Here it is a scripted subject whose
 * answers are known before the run, driven through the *same* runner a live
 * subject uses, with the metrics checked against values computed by hand.
 *
 * It runs with no network, no credential and no model, which is deliberate: a
 * self-test that needs the thing it is testing cannot be run when that thing is
 * broken.
 *
 * What it proves, and only this: the harness measures what it claims to
 * measure. It proves nothing whatever about the runtime's behaviour under a
 * real model — every manifest written here carries `counterfactual: true` for
 * that reason.
 */

const scenarioPath = resolve(
  fileURLToPath(new URL("../scenarios", import.meta.url)),
);

/** The scenario's verdicts, written out independently of the scenario file. */
const EXPECTED_VERDICTS: Readonly<Record<string, boolean>> = Object.freeze({
  "abs-01-rename-a": true,
  "abs-01-rename-b": true,
  "abs-01-list": true,
  // The one genuine failure, and so the only source of a real residual.
  "abs-01-conflict": false,
});

let directory: string;
const results: Partial<Record<ArmId, RunResult>> = {};

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "praxis-eval-oracle-"));
  const { scenario } = loadScenario(
    "sc-abs-01-low-risk-abstention",
    scenarioPath,
  );
  for (const arm of MINIMUM_COMPARISON_ARMS) {
    results[arm] = await runScenario({
      scenario,
      arm,
      subject: new ScriptedSubject([
        "Renamed three files.",
        "Renamed two files.",
        "report.md, report-final.md",
        "report.md already exists; refusing to overwrite.",
      ]),
      resultsDirectory: directory,
      // The environment is the judge. The scripted subject's own claim that it
      // succeeded is never consulted.
      verifier: async (episode) => EXPECTED_VERDICTS[episode.episodeId] ?? null,
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });
  }
});

afterAll(() => {
  if (directory !== undefined)
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
});

describe("every arm runs end to end with no model", () => {
  it("ran all four comparison arms", () => {
    expect(missingArms(Object.keys(results) as ArmId[])).toEqual([]);
  });

  it("completed every episode without the arm's mechanism throwing", () => {
    for (const arm of MINIMUM_COMPARISON_ARMS) {
      expect(results[arm]!.armErrors, `${arm} had arm errors`).toEqual([]);
    }
  });

  it("produces the verifier's verdicts and not the subject's claims", () => {
    for (const arm of MINIMUM_COMPARISON_ARMS) {
      const records = results[arm]!.records;
      expect(records.map((r) => r.episodeId)).toEqual(
        Object.keys(EXPECTED_VERDICTS),
      );
      expect(records.map((r) => r.taskSucceeded)).toEqual(
        Object.values(EXPECTED_VERDICTS),
      );
    }
  });
});

describe("BASE measures nothing it does not have", () => {
  it("detects no residual on any episode", () => {
    expect(results.base!.records.every((r) => !r.residualDetected)).toBe(true);
  });

  it("reports the false-residual rate as UNSCORED, not as zero", () => {
    // The assertion this whole file exists for. BASE raised no residuals, so
    // there is no denominator, so there is no rate. A harness that reported
    // `0.000` here would hand any ablation table a perfect false-positive score
    // for the arm that does not implement the mechanism at all.
    const metricRate = results.base!.metrics.falseResidualRate;
    expect(metricRate.status).toBe("unscored");
    expect(metricRate.value).toBeNull();
    expect(metricRate.denominator).toBe(0);
  });

  it("still reports a task-success rate, because that denominator is real", () => {
    const metricRate = results.base!.metrics.taskSuccess;
    expect(metricRate.status).toBe("scored");
    expect(metricRate.denominator).toBe(4);
    expect(metricRate.value).toBe(0.75);
  });

  it("exposes no context", () => {
    expect(
      results.base!.records.every((r) => r.contextItemsExposed === 0),
    ).toBe(true);
  });
});

describe("STATE pays for memory without claiming to learn", () => {
  it("records the ledger and exposes context, unlike BASE", () => {
    const exposed = results.state!.records.map((r) => r.contextItemsExposed);
    expect(exposed.some((count) => count > 0)).toBe(true);
  });

  it("still detects no residual, because residual detection is not its mechanism", () => {
    expect(results.state!.records.every((r) => !r.residualDetected)).toBe(true);
  });
});

describe("REFLECTION notices, and the numbers say exactly how much", () => {
  it("detects a residual on the episode the environment says failed", () => {
    const detected = results.reflection!.records.filter(
      (r) => r.residualDetected,
    );
    expect(detected.map((r) => r.episodeId)).toEqual(["abs-01-conflict"]);
  });

  it("detects nothing on the three episodes where nothing was wrong", () => {
    const detected = results
      .reflection!.records.filter((r) => r.residualDetected)
      .map((r) => r.episodeId);
    expect(detected).not.toContain("abs-01-rename-a");
    expect(detected).not.toContain("abs-01-list");
  });

  it("has a real false-residual denominator, and scores zero over it", () => {
    // The complement of the BASE assertion: here the denominator exists because
    // a residual was raised and the environment could adjudicate it. `0 of 1`
    // is a result; `0 of 0` is not.
    const metricRate = results.reflection!.metrics.falseResidualRate;
    expect(metricRate.status).toBe("scored");
    expect(metricRate.denominator).toBe(1);
    expect(metricRate.numerator).toBe(0);
    expect(metricRate.value).toBe(0);
  });

  it("scores a missed-residual rate over the episodes that really had a problem", () => {
    const metricRate = results.reflection!.metrics.missedResidualRate;
    expect(metricRate.denominator).toBe(1);
    expect(metricRate.numerator).toBe(0);
  });

  it("produces no candidate asset", () => {
    expect(results.reflection!.records.every((r) => !r.candidateCreated)).toBe(
      true,
    );
  });
});

describe("the metric that matters most for 6V-1", () => {
  it("scores abstention over the episodes that called for it", () => {
    // Three of four episodes have `shouldIntervene: false`. Abstention is
    // measured against those three, not against all four.
    const metricRate = results.reflection!.metrics.abstentionAccuracy;
    expect(metricRate.denominator).toBe(3);
    expect(metricRate.numerator).toBe(3);
  });

  it("is not scored when no episode called for abstention", () => {
    // Synthetic records: the property must hold structurally, not by luck of
    // this scenario's shape.
    const metrics = computeMetrics([
      {
        arm: "base",
        scenarioId: "s",
        scenarioVersion: "1",
        episodeId: "e1",
        oracle: {
          taskOutcome: "succeed",
          residualIsReal: true,
          shouldIntervene: true,
          shouldProduceCandidate: false,
          rationale: "the only episode, and it called for intervention",
        },
        taskSucceeded: true,
        residualDetected: true,
        residualKinds: ["outcome"],
        reflectionDecision: "CONTINUE",
        candidateCreated: false,
        assetPromoted: false,
        challengeRaised: false,
        contextItemsExposed: 0,
        humanIntervened: false,
        latencyMs: 1,
        inputTokens: null,
        outputTokens: null,
      },
    ]);
    expect(metrics.abstentionAccuracy.status).toBe("unscored");
    expect(metrics.abstentionAccuracy.denominator).toBe(0);
  });
});

describe("incremental benefit is refused rather than guessed", () => {
  it("reports not-comparable when the harness only ran one arm", async () => {
    const { scenario } = loadScenario(
      "sc-abs-01-low-risk-abstention",
      scenarioPath,
    );
    const solo = await runScenario({
      scenario,
      arm: "base",
      subject: new ScriptedSubject(["a", "b", "c", "d"]),
      resultsDirectory: directory,
      verifier: async (episode) => EXPECTED_VERDICTS[episode.episodeId] ?? null,
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });
    expect(solo.metrics.incrementalTaskBenefit.status).toBe("not-comparable");
    expect(solo.metrics.incrementalTaskBenefit.delta).toBeNull();
  });
});

describe("every manifest this harness writes satisfies the frozen schema", () => {
  it("conforms for each arm, checked against the real schema file", () => {
    // The 6V-0 defect, as an assertion. Nine records were invalid and nothing
    // said so; here nothing can be written without being checked first.
    const schema = manifestSchema();
    for (const arm of ALL_ARM_IDS) {
      const run = results[arm];
      if (run === undefined) continue;
      const document: unknown = JSON.parse(
        readFileSync(run.manifestPath, "utf8"),
      );
      expect(validateAgainst(schema, document), `${arm} manifest`).toEqual([]);
    }
  });

  it("records counterfactual: true, so a scripted run cannot be read as history", () => {
    const document = JSON.parse(
      readFileSync(results.base!.manifestPath, "utf8"),
    ) as {
      subject: { counterfactual: boolean; scaffold: string };
    };
    expect(document.subject.counterfactual).toBe(true);
    expect(document.subject.scaffold).toBe("oracle");
  });

  it("records the full 40-character runtime commit and a dirty flag", () => {
    const document = JSON.parse(
      readFileSync(results.base!.manifestPath, "utf8"),
    ) as {
      runtimeCommit: string;
      runtimeDirty: boolean;
    };
    expect(document.runtimeCommit).toHaveLength(40);
    expect(document.runtimeDirty).toBe(false);
  });
});

describe("the negative control: a subject that always fails", () => {
  it("produces error records, not silent success, and still writes a valid manifest", async () => {
    const { scenario } = loadScenario(
      "sc-abs-01-low-risk-abstention",
      scenarioPath,
    );
    const run = await runScenario({
      scenario,
      arm: "reflection",
      subject: new FailingSubject(),
      resultsDirectory: directory,
      verifier: async () => true,
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    // The verifier said "true" for every episode, but the subject never
    // answered. A harness that let the verifier's verdict stand would report a
    // 100% success rate for a run in which nothing worked.
    expect(run.records.every((r) => r.taskSucceeded === null)).toBe(true);
    expect(run.armErrors).toHaveLength(4);
    expect(run.records.every((r) => typeof r.error === "string")).toBe(true);

    // And no episode counts as a success, because an episode that threw did not
    // succeed at the task.
    expect(run.metrics.taskSuccess.denominator).toBe(0);
    expect(run.metrics.taskSuccess.status).toBe("unscored");

    const document: unknown = JSON.parse(
      readFileSync(run.manifestPath, "utf8"),
    );
    expect(validateAgainst(manifestSchema(), document)).toEqual([]);
    expect((document as { notes: string }).notes).toContain("armErrors=4");
  });
});
