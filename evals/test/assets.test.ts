import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runScenario } from "../src/run.js";
import type {
  HumanControlRequest,
  Subject,
  SubjectIdentity,
  SubjectOutput,
} from "../src/runner.js";
import type { Scenario } from "../src/scenario.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

function resultsDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "praxis-eval-assets-"));
  directories.push(directory);
  return directory;
}

function scenario(episodes: Scenario["episodes"]): Scenario {
  return {
    scenarioId: "sc-asset-lifecycle",
    scenarioVersion: "1.0.0",
    title: "asset lifecycle harness fixture",
    corpusType: "corpus-c",
    ladder: "6V-2",
    concurrency: "C0",
    frozenAt: "2026-09-18T00:00:00.000Z",
    field: {
      taskType: "workflow-repair",
      externalVerification: "strong",
      consequence: "medium",
      reversibility: "easy",
      feedbackLatency: "short",
      actors: [{ type: "human", id: "owner" }],
      placementRationale: "synthetic lifecycle fixture",
    },
    verifier: {
      kind: "test-runner",
      reference: "scripted independent verdict",
      independent: true,
    },
    episodes,
  };
}

function episode(
  episodeId: string,
  task: string,
  residualIsReal: boolean,
  shouldIntervene: boolean,
  shouldProduceCandidate: boolean,
  assetExpectation?: "none" | "help" | "ignore" | "challenge",
) {
  return {
    episodeId,
    task,
    oracle: {
      taskOutcome: residualIsReal ? "fail" : "succeed",
      residualIsReal,
      shouldIntervene,
      shouldProduceCandidate,
      rationale: "synthetic fixture has a frozen independent expectation",
    } as const,
    ...(assetExpectation === undefined ? {} : { assetExpectation }),
  };
}

class RecordingSubject implements Subject {
  readonly prompts: string[] = [];
  readonly #answers: readonly string[];
  #index = 0;

  constructor(answers: readonly string[]) {
    this.#answers = answers;
  }

  identity(): SubjectIdentity {
    return {
      provider: "scripted",
      model: "asset-lifecycle-subject",
      adapterId: "eval:asset-lifecycle",
      scaffold: "oracle",
      counterfactual: true,
    };
  }

  async generate(prompt: string): Promise<SubjectOutput> {
    this.prompts.push(prompt);
    const text = this.#answers[this.#index++];
    if (text === undefined) throw new Error("asset fixture answer underflow");
    return { text, inputTokens: null, outputTokens: null };
  }
}

function verifierFor(episodeId: string): boolean {
  return episodeId !== "asset-incident";
}

describe("FULL PRAXIS asset lifecycle", () => {
  it("runs residual → candidate → human confirmation → active → later reuse", async () => {
    const subject = new RecordingSubject(["failed", "repaired", "reused"]);
    const requests: HumanControlRequest[] = [];
    const run = await runScenario({
      scenario: scenario([
        episode(
          "asset-incident",
          "Apply the workflow; the external check will fail.",
          true,
          true,
          true,
        ),
        episode(
          "asset-validation",
          "Apply the corrected workflow and verify it.",
          false,
          false,
          false,
        ),
        episode(
          "asset-reuse",
          "Apply the workflow again using any validated reusable asset.",
          false,
          false,
          false,
          "help",
        ),
      ]),
      arm: "full",
      subject,
      resultsDirectory: resultsDirectory(),
      verifier: async (current) => verifierFor(current.episodeId),
      humanControl: (request) => {
        requests.push(request);
        return request.action === "activate";
      },
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(run.armErrors).toEqual([]);
    expect(run.records[0]).toMatchObject({ candidateCreated: true });
    expect(run.records[1]).toMatchObject({
      assetPromoted: true,
      humanIntervened: true,
    });
    expect(run.records[2]).toMatchObject({ assetPromoted: false });
    expect(requests).toEqual([
      {
        action: "activate",
        assetId: "eval-candidate-sc-asset-lifecycle",
        episodeId: "asset-validation",
      },
    ]);
    expect(subject.prompts[2]).toContain(
      "[active asset eval-candidate-sc-asset-lifecycle]",
    );
    expect(run.metrics.promotionPrecision.status).toBe("scored");
    expect(run.metrics.promotionPrecision.numerator).toBe(1);
  });

  it("does not promote a candidate without explicit human confirmation", async () => {
    const run = await runScenario({
      scenario: scenario([
        episode("asset-incident", "The workflow fails.", true, true, true),
        episode(
          "asset-validation",
          "The workflow succeeds.",
          false,
          false,
          false,
        ),
      ]),
      arm: "full",
      subject: new RecordingSubject(["failed", "repaired"]),
      resultsDirectory: resultsDirectory(),
      verifier: async (current) => verifierFor(current.episodeId),
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(run.armErrors).toEqual([]);
    expect(run.records.some((record) => record.assetPromoted)).toBe(false);
    expect(run.records[1]?.humanIntervened).toBe(false);
  });

  it("refuses insufficient evidence even when the human hook would confirm", async () => {
    const requests: HumanControlRequest[] = [];
    const run = await runScenario({
      scenario: scenario([
        episode("asset-incident", "The workflow fails once.", true, true, true),
      ]),
      arm: "full",
      subject: new RecordingSubject(["failed"]),
      resultsDirectory: resultsDirectory(),
      verifier: async () => false,
      humanControl: (request) => {
        requests.push(request);
        return true;
      },
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(run.armErrors).toEqual([]);
    expect(run.records[0]).toMatchObject({
      candidateCreated: true,
      assetPromoted: false,
    });
    expect(requests).toEqual([]);
  });

  it("seeds and challenges a stale asset only through human control", async () => {
    const subject = new RecordingSubject(["the old workflow is wrong"]);
    const requests: HumanControlRequest[] = [];
    const run = await runScenario({
      scenario: scenario([
        episode(
          "stale-challenge",
          "The previously active workflow is obsolete; challenge it.",
          false,
          true,
          false,
          "challenge",
        ),
      ]),
      arm: "full-stale-asset",
      subject,
      resultsDirectory: resultsDirectory(),
      verifier: async () => true,
      humanControl: (request) => {
        requests.push(request);
        return request.action === "challenge";
      },
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(run.armErrors).toEqual([]);
    expect(run.records[0]).toMatchObject({
      challengeRaised: true,
      humanIntervened: true,
    });
    expect(requests[0]?.action).toBe("challenge");
    expect(subject.prompts[0]).toContain(
      "[active asset eval-stale-sc-asset-lifecycle]",
    );
  });

  it("does not inject an active asset into an ignore episode", async () => {
    const subject = new RecordingSubject(["ignore the old rule"]);
    const run = await runScenario({
      scenario: scenario([
        episode(
          "asset-ignore",
          "Do this task without using the old workflow.",
          false,
          false,
          false,
          "ignore",
        ),
      ]),
      arm: "full-stale-asset",
      subject,
      resultsDirectory: resultsDirectory(),
      verifier: async () => true,
      humanControl: () => false,
      gitFacts: { commit: "0".repeat(40), dirty: false },
    });

    expect(run.armErrors).toEqual([]);
    expect(run.records[0]?.challengeRaised).toBe(false);
    expect(subject.prompts[0]).not.toContain(
      "[active asset eval-stale-sc-asset-lifecycle]",
    );
  });
});
