import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runScenario } from "../src/run.js";
import type { Subject } from "../src/runner.js";
import type { Scenario } from "../src/scenario.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

const scenario: Scenario = {
  scenarioId: "sc-verifier-unknown",
  scenarioVersion: "1.0.0",
  title: "unknown external verdict",
  corpusType: "corpus-c",
  ladder: "6V-1",
  concurrency: "C0",
  frozenAt: "2026-09-18T00:00:00.000Z",
  field: {
    taskType: "verification-boundary",
    externalVerification: "medium",
    consequence: "low",
    reversibility: "easy",
    feedbackLatency: "short",
    actors: [{ type: "human", id: "owner" }],
    placementRationale: "synthetic verifier negative control",
  },
  verifier: {
    kind: "external-api",
    reference: "deliberately unavailable verifier",
    independent: true,
  },
  episodes: [
    {
      episodeId: "unknown-1",
      task: "Perform a task whose external result cannot be read.",
      oracle: {
        taskOutcome: "either",
        residualIsReal: null,
        shouldIntervene: false,
        shouldProduceCandidate: false,
        rationale: "The external verifier returned no adjudication.",
      },
    },
  ],
};

const subject: Subject = {
  identity: () => ({
    provider: "scripted",
    model: "unknown-verdict-control",
    adapterId: "eval:unknown-verdict",
    scaffold: "oracle",
    counterfactual: true,
  }),
  generate: async () => ({
    text: "completed",
    inputTokens: null,
    outputTokens: null,
  }),
};

describe("unknown verifier results", () => {
  it("do not become failed observations or false residuals", async () => {
    const resultsDirectory = mkdtempSync(
      join(tmpdir(), "praxis-eval-unknown-"),
    );
    directories.push(resultsDirectory);

    const result = await runScenario({
      scenario,
      arm: "full",
      subject,
      resultsDirectory,
      verifier: async () => null,
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(result.armErrors).toEqual([]);
    expect(result.records[0]).toMatchObject({
      taskSucceeded: null,
      residualDetected: false,
      candidateCreated: false,
      assetPromoted: false,
    });
    expect(result.metrics.unadjudicatedCount).toBe(1);
    expect(result.metrics.falseResidualRate.status).toBe("unscored");
  });
});
