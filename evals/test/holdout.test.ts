import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runScenario, type HoldoutEntry } from "../src/run.js";
import {
  type Subject,
  type SubjectEpisodeContext,
  type SubjectIdentity,
  type SubjectOutput,
} from "../src/runner.js";
import type { Scenario } from "../src/scenario.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

function resultDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "praxis-eval-holdout-"));
  directories.push(directory);
  return directory;
}

function scenario(): Scenario {
  return {
    scenarioId: "holdout-boundary",
    scenarioVersion: "1.0.0",
    title: "holdout boundary fixture",
    corpusType: "corpus-i",
    ladder: "6V-2",
    concurrency: "C0",
    field: {
      taskType: "historical-replay",
      externalVerification: "strong",
      consequence: "low",
      reversibility: "easy",
      feedbackLatency: "short",
      actors: [{ type: "human", id: "owner" }],
      placementRationale:
        "synthetic boundary fixture with evaluator-only material",
    },
    verifier: {
      kind: "human",
      reference: "evaluator-only holdout callback",
      independent: true,
    },
    frozenAt: "2026-09-18T00:00:00.000Z",
    episodes: [
      {
        episodeId: "historical-episode-01",
        task: "Perform the input-window task.",
        oracle: {
          taskOutcome: "succeed",
          residualIsReal: false,
          shouldIntervene: false,
          shouldProduceCandidate: false,
          rationale: "The holdout is used only by the evaluator.",
        },
      },
    ],
    corpusProvenance: {
      sourceLocation: "local-only://holdout-boundary-fixture",
      sourceLicence: "UNVERIFIED",
      privacyStatus: "redacted",
      redactionRequired: true,
      provenanceQuality: "reconstructed",
      inRepository: false,
    },
  };
}

const identity: SubjectIdentity = {
  provider: "scripted",
  model: "holdout-test",
  adapterId: "eval:holdout",
  scaffold: "oracle",
  counterfactual: true,
};

class SafeSubject implements Subject {
  identity(): SubjectIdentity {
    return identity;
  }

  async generate(
    _prompt: string,
    _context?: SubjectEpisodeContext,
  ): Promise<SubjectOutput> {
    return { text: "input-only answer", inputTokens: 1, outputTokens: 1 };
  }
}

class LeakingSubject implements Subject {
  identity(): SubjectIdentity {
    return identity;
  }

  async generate(
    _prompt: string,
    context?: SubjectEpisodeContext,
  ): Promise<SubjectOutput> {
    context?.holdout.read();
    return { text: "unreachable", inputTokens: 1, outputTokens: 1 };
  }
}

const holdout: ReadonlyMap<string, HoldoutEntry> = new Map([
  [
    "historical-episode-01",
    { reference: "archive://future#record-02", value: { accepted: true } },
  ],
]);

describe("subject/evaluator holdout boundary", () => {
  it("keeps evaluator material available to the verifier but not the subject", async () => {
    let observed: HoldoutEntry | undefined;
    const result = await runScenario({
      scenario: scenario(),
      arm: "base",
      subject: new SafeSubject(),
      resultsDirectory: resultDirectory(),
      holdout,
      verifier: async (_episode, _output, entry) => {
        observed = entry;
        return entry?.reference === "archive://future#record-02";
      },
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(observed?.value).toEqual({ accepted: true });
    expect(result.holdoutIsolation).toBe("PASS");
    expect(result.holdoutLeakageCount).toBe(0);
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      holdoutIsolation: string;
      holdoutLeakageCount: number;
      notes: string;
    };
    expect(manifest.holdoutIsolation).toBe("PASS");
    expect(manifest.holdoutLeakageCount).toBe(0);
    expect(manifest.notes).not.toContain("accepted");
  });

  it("fails closed and records leakage when a subject attempts a holdout read", async () => {
    const result = await runScenario({
      scenario: scenario(),
      arm: "base",
      subject: new LeakingSubject(),
      resultsDirectory: resultDirectory(),
      holdout,
      verifier: async () => true,
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(result.holdoutIsolation).toBe("FAIL");
    expect(result.holdoutLeakageCount).toBe(1);
    expect(result.armErrors.join("\n")).toContain("future holdout");
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      holdoutIsolation: string;
      holdoutLeakageCount: number;
    };
    expect(manifest.holdoutIsolation).toBe("FAIL");
    expect(manifest.holdoutLeakageCount).toBe(1);
  });

  it("does not hide a prohibited read merely because no holdout was supplied", async () => {
    const result = await runScenario({
      scenario: scenario(),
      arm: "base",
      subject: new LeakingSubject(),
      resultsDirectory: resultDirectory(),
      verifier: async () => true,
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(result.holdoutIsolation).toBe("FAIL");
    expect(result.holdoutLeakageCount).toBe(1);
  });
});
