import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseScenario } from "../src/scenario.js";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifestPath = resolve(
  repoRoot,
  "evals/scenarios/reentry-round1-scenarios.json",
);

describe("Round 1 scenario manifest", () => {
  it("is loadable, synthetic, and contains the ten narrative episodes", () => {
    const scenario = parseScenario(
      manifestPath,
      JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
    );

    expect(scenario.corpusType).toBe("corpus-c");
    expect(scenario.episodes).toHaveLength(10);
    expect(
      new Set(scenario.episodes.map((episode) => episode.episodeId)).size,
    ).toBe(10);
    expect(
      scenario.episodes.filter(
        (episode) => episode.oracle.shouldProduceCandidate,
      ),
    ).toHaveLength(1);
    expect(
      scenario.episodes.filter(
        (episode) => episode.assetExpectation === "challenge",
      ),
    ).toHaveLength(1);
  });
});
