import { describe, expect, it } from "vitest";

import {
  AssetLifecycleError,
  createAssetCandidate,
  evaluateAssetPromotion,
  forkAsset,
  transitionAsset,
} from "../../packages/assets/src/index.js";
import type {
  AssetPromotionReview,
  ReusableAsset,
} from "../../packages/contracts/src/index.js";

const at = "2026-09-15T00:00:00.000Z";

function candidate(): ReusableAsset {
  return createAssetCandidate({
    id: "asset-1",
    kind: "skill",
    version: "1.0.0",
    body: { instruction: "keep evidence visible" },
    derivedFrom: [{ eventId: "source-1", origin: "inferred" }],
    createdAt: at,
  });
}

function review(
  targetStatus: "validated" | "active" = "validated",
): AssetPromotionReview {
  return {
    targetStatus,
    episodes: [
      {
        episodeId: "episode-1",
        evidence: [{ eventId: "episode-1-event", origin: "direct" }],
        exposureInfluenced: false,
      },
      {
        episodeId: "episode-2",
        evidence: [{ eventId: "episode-2-event", origin: "direct" }],
        exposureInfluenced: false,
      },
    ],
    counterexamples: [],
    validation: {
      validatorId: "validator:test",
      passed: true,
      evidence: [{ eventId: "validation-event", origin: "declared" }],
    },
    ...(targetStatus === "active" ? { humanConfirmed: true } : {}),
  };
}

describe("reusable asset domain", () => {
  it("enforces lifecycle transitions and revision increments", () => {
    const validated = transitionAsset(candidate(), "validated", at);
    expect(validated.status).toBe("validated");
    expect(validated.revision).toBe(2);

    expect(() => transitionAsset(validated, "candidate", at)).toThrowError(
      AssetLifecycleError,
    );
    expect(() => transitionAsset(validated, "validated", at)).toThrowError(
      "illegal reusable-asset lifecycle transition",
    );
  });

  it("keeps fork lineage independent from its source asset", () => {
    const source = transitionAsset(candidate(), "validated", at);
    const fork = forkAsset(source, "asset-fork", "2026-09-15T00:00:01.000Z");

    expect(fork.id).toBe("asset-fork");
    expect(fork.revision).toBe(1);
    expect(fork.status).toBe("candidate");
    expect(fork.forkedFrom).toEqual({
      id: "asset-1",
      version: "1.0.0",
      revision: 2,
    });
    expect(source.status).toBe("validated");
    expect(source.revision).toBe(2);
  });

  it("requires independent episodes, validation, and human confirmation", () => {
    const source = candidate();
    const validated = evaluateAssetPromotion(source, review());
    expect(validated).toMatchObject({
      allowed: true,
      independentEpisodeCount: 2,
      exposureInfluencedEvidenceCount: 0,
    });

    const active = evaluateAssetPromotion(source, review("active"));
    expect(active.allowed).toBe(false);
    expect(active.reasons).toContain(
      "illegal reusable-asset lifecycle transition: candidate -> active",
    );

    const candidateWithExposureOnly = {
      ...review(),
      episodes: [
        {
          episodeId: "episode-1",
          evidence: [{ eventId: "exposed-1", origin: "inferred" as const }],
          exposureInfluenced: true,
        },
        {
          episodeId: "episode-2",
          evidence: [{ eventId: "exposed-2", origin: "inferred" as const }],
          exposureInfluenced: true,
        },
      ],
    };
    const exposureDecision = evaluateAssetPromotion(
      source,
      candidateWithExposureOnly,
    );
    expect(exposureDecision.allowed).toBe(false);
    expect(exposureDecision.independentEpisodeCount).toBe(0);
    expect(exposureDecision.exposureInfluencedEvidenceCount).toBe(2);

    const unresolved = evaluateAssetPromotion(source, {
      ...review(),
      counterexamples: [
        { id: "counterexample-1", severity: "severe", resolved: false },
      ],
    });
    expect(unresolved.allowed).toBe(false);
    expect(unresolved.reasons).toContain(
      "an unresolved severe counterexample blocks promotion",
    );
  });

  it("does not count one provenance root as multiple independent episodes", () => {
    const decision = evaluateAssetPromotion(candidate(), {
      ...review(),
      episodes: [
        {
          episodeId: "episode-a",
          evidence: [{ eventId: "same-source", origin: "direct" }],
          exposureInfluenced: false,
        },
        {
          episodeId: "episode-b",
          evidence: [{ eventId: "same-source", origin: "direct" }],
          exposureInfluenced: false,
        },
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.independentEpisodeCount).toBe(1);
    expect(decision.reasons).toContain(
      "promotion requires evidence from at least 2 independent episodes",
    );
  });
});
