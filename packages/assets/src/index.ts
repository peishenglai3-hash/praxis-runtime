import {
  defaultAssetPromotionPolicy,
  parseReusableAsset,
} from "@praxis/contracts";
import type {
  AssetCounterexample,
  AssetEpisodeEvidence,
  AssetKind,
  AssetPromotionDecision,
  AssetPromotionPolicyConfig,
  AssetPromotionReview,
  AssetStatus,
  AssetValidationReport,
  EvidenceRef,
  JsonValue,
  ReusableAsset,
} from "@praxis/contracts";

export class AssetLifecycleError extends Error {
  readonly code = "ASSET_LIFECYCLE_ERROR" as const;

  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AssetLifecycleError";
  }
}

export interface CreateAssetCandidateInput {
  id: string;
  kind: AssetKind;
  version: string;
  body: JsonValue;
  derivedFrom: EvidenceRef[];
  createdAt: string;
}

const lifecycleTransitions: Readonly<
  Record<AssetStatus, readonly AssetStatus[]>
> = {
  draft: ["candidate", "deprecated"],
  candidate: ["validated", "challenged", "deprecated"],
  validated: ["active", "challenged", "deprecated"],
  active: ["challenged", "deprecated"],
  challenged: ["candidate", "validated", "active", "deprecated"],
  deprecated: ["validated", "active"],
};

function assertTimestamp(value: string, field: string): void {
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new AssetLifecycleError(`${field} must be a canonical UTC timestamp`);
  }
}

function nextRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new AssetLifecycleError("asset revision must be a positive integer", {
      revision,
    });
  }
  const next = revision + 1;
  if (!Number.isSafeInteger(next)) {
    throw new AssetLifecycleError("asset revision exhausted", { revision });
  }
  return next;
}

export function assertAssetTransition(
  from: AssetStatus,
  to: AssetStatus,
): void {
  const allowedTransitions = lifecycleTransitions[from];
  if (
    allowedTransitions === undefined ||
    from === to ||
    !allowedTransitions.includes(to)
  ) {
    throw new AssetLifecycleError(
      `illegal reusable-asset lifecycle transition: ${from} -> ${to}`,
      { from, to },
    );
  }
}

export function createAssetCandidate(
  input: CreateAssetCandidateInput,
): ReusableAsset {
  assertTimestamp(input.createdAt, "asset createdAt");
  if (input.id.length < 1) {
    throw new AssetLifecycleError("asset id is required");
  }
  if (input.version.length < 1) {
    throw new AssetLifecycleError("asset version is required");
  }
  return parseReusableAsset({
    id: input.id,
    kind: input.kind,
    version: input.version,
    revision: 1,
    status: "candidate",
    body: input.body,
    derivedFrom: input.derivedFrom,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function transitionAsset(
  assetInput: ReusableAsset,
  status: AssetStatus,
  updatedAt: string,
): ReusableAsset {
  const asset = parseReusableAsset(assetInput);
  assertTimestamp(updatedAt, "asset updatedAt");
  assertAssetTransition(asset.status, status);
  return parseReusableAsset({
    ...asset,
    revision: nextRevision(asset.revision),
    status,
    updatedAt,
  });
}

export function forkAsset(
  assetInput: ReusableAsset,
  newAssetId: string,
  createdAt: string,
): ReusableAsset {
  const asset = parseReusableAsset(assetInput);
  assertTimestamp(createdAt, "asset fork createdAt");
  if (newAssetId.length < 1 || newAssetId === asset.id) {
    throw new AssetLifecycleError(
      "asset fork requires a distinct non-empty asset id",
    );
  }
  return parseReusableAsset({
    id: newAssetId,
    kind: asset.kind,
    version: asset.version,
    revision: 1,
    status: "candidate",
    body: asset.body,
    derivedFrom: [
      ...asset.derivedFrom,
      { assetId: asset.id, origin: "declared" },
    ],
    forkedFrom: {
      id: asset.id,
      version: asset.version,
      revision: asset.revision,
    },
    createdAt,
    updatedAt: createdAt,
  });
}

function assertPolicyConfig(config: AssetPromotionPolicyConfig): void {
  if (
    !Number.isSafeInteger(config.minimumEvidence) ||
    config.minimumEvidence < 1 ||
    !Number.isSafeInteger(config.minimumIndependentEpisodes) ||
    config.minimumIndependentEpisodes < 1
  ) {
    throw new AssetLifecycleError(
      "asset promotion thresholds must be positive safe integers",
      { config },
    );
  }
}

function assertPromotionReviewShape(
  review: unknown,
): asserts review is AssetPromotionReview {
  if (review === null || typeof review !== "object") {
    throw new AssetLifecycleError("asset promotion review is malformed");
  }
  const value = review as Record<string, unknown>;
  if (value.targetStatus !== "validated" && value.targetStatus !== "active") {
    throw new AssetLifecycleError("asset promotion target status is malformed");
  }
  if (!Array.isArray(value.episodes) || !Array.isArray(value.counterexamples)) {
    throw new AssetLifecycleError(
      "asset promotion evidence lists are malformed",
    );
  }
  for (const episode of value.episodes) {
    if (
      episode === null ||
      typeof episode !== "object" ||
      typeof (episode as Record<string, unknown>).episodeId !== "string" ||
      !Array.isArray((episode as Record<string, unknown>).evidence) ||
      typeof (episode as Record<string, unknown>).exposureInfluenced !==
        "boolean"
    ) {
      throw new AssetLifecycleError("asset episode evidence is malformed");
    }
    for (const evidence of (episode as { evidence: unknown[] }).evidence) {
      assertEvidenceRefShape(evidence, "asset episode evidence");
    }
  }
  for (const counterexample of value.counterexamples) {
    if (
      counterexample === null ||
      typeof counterexample !== "object" ||
      typeof (counterexample as Record<string, unknown>).id !== "string" ||
      !["low", "medium", "severe"].includes(
        (counterexample as Record<string, unknown>).severity as string,
      ) ||
      typeof (counterexample as Record<string, unknown>).resolved !== "boolean"
    ) {
      throw new AssetLifecycleError("asset counterexample is malformed");
    }
    const evidence = (counterexample as Record<string, unknown>).evidence;
    if (evidence !== undefined && !Array.isArray(evidence)) {
      throw new AssetLifecycleError(
        "asset counterexample evidence is malformed",
      );
    }
    if (Array.isArray(evidence)) {
      for (const item of evidence) {
        assertEvidenceRefShape(item, "asset counterexample evidence");
      }
    }
  }
  const validation = value.validation;
  if (validation === null || typeof validation !== "object") {
    throw new AssetLifecycleError("asset validation report is malformed");
  }
  const validationValue = validation as Record<string, unknown>;
  if (
    typeof validationValue.validatorId !== "string" ||
    typeof validationValue.passed !== "boolean" ||
    !Array.isArray(validationValue.evidence)
  ) {
    throw new AssetLifecycleError("asset validation report is malformed");
  }
  for (const evidence of validationValue.evidence as unknown[]) {
    assertEvidenceRefShape(evidence, "asset validation evidence");
  }
  if (
    value.humanConfirmed !== undefined &&
    typeof value.humanConfirmed !== "boolean"
  ) {
    throw new AssetLifecycleError("asset human confirmation is malformed");
  }
}

function assertEvidenceRefShape(value: unknown, label: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AssetLifecycleError(`${label} is malformed`);
  }
  const evidence = value as Record<string, unknown>;
  const hasReference = ["eventId", "assetId", "artifactHash"].some(
    (key) => typeof evidence[key] === "string" && evidence[key].length > 0,
  );
  if (
    !hasReference ||
    !["direct", "declared", "inferred", "institutional"].includes(
      evidence.origin as string,
    ) ||
    (evidence.exposureInfluenced !== undefined &&
      typeof evidence.exposureInfluenced !== "boolean")
  ) {
    throw new AssetLifecycleError(`${label} is malformed`);
  }
}

function evidenceIdentity(evidence: EvidenceRef): string {
  return [
    evidence.eventId ?? "",
    evidence.assetId ?? "",
    evidence.artifactHash ?? "",
  ].join("\u001f");
}

function countEpisodeEvidence(episodes: AssetEpisodeEvidence[]): {
  evidenceCount: number;
  independentEpisodeCount: number;
  exposureInfluencedEvidenceCount: number;
} {
  const episodeIds = new Set<string>();
  const independentEvidenceRoots = new Set<string>();
  let evidenceCount = 0;
  let exposureInfluencedEvidenceCount = 0;
  for (const episode of episodes) {
    if (episode.episodeId.length < 1) {
      throw new AssetLifecycleError("asset evidence episodeId is required");
    }
    if (episodeIds.has(episode.episodeId)) {
      throw new AssetLifecycleError(
        "asset promotion review contains duplicate episode ids",
      );
    }
    episodeIds.add(episode.episodeId);
    if (episode.evidence.length > 0 && !episode.exposureInfluenced) {
      for (const evidence of episode.evidence) {
        independentEvidenceRoots.add(evidenceIdentity(evidence));
      }
    }
    evidenceCount += episode.evidence.length;
    if (episode.exposureInfluenced) {
      exposureInfluencedEvidenceCount += episode.evidence.length;
    }
  }
  return {
    evidenceCount,
    independentEpisodeCount: independentEvidenceRoots.size,
    exposureInfluencedEvidenceCount,
  };
}

export function evaluateAssetPromotion(
  assetInput: ReusableAsset,
  review: AssetPromotionReview,
  config: AssetPromotionPolicyConfig = defaultAssetPromotionPolicy,
): AssetPromotionDecision {
  const asset = parseReusableAsset(assetInput);
  assertPromotionReviewShape(review);
  assertPolicyConfig(config);
  const counts = countEpisodeEvidence(review.episodes);
  const reasons: string[] = [];

  try {
    assertAssetTransition(asset.status, review.targetStatus);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  if (asset.derivedFrom.length < 1) {
    reasons.push("asset has no derivation provenance");
  }
  if (counts.evidenceCount < config.minimumEvidence) {
    reasons.push(
      `promotion requires at least ${config.minimumEvidence} evidence items`,
    );
  }
  if (counts.independentEpisodeCount < config.minimumIndependentEpisodes) {
    reasons.push(
      `promotion requires evidence from at least ${config.minimumIndependentEpisodes} independent episodes`,
    );
  }
  if (!review.validation.passed) {
    reasons.push("asset validator did not pass");
  }
  if (
    review.validation.validatorId.length < 1 ||
    review.validation.evidence.length < 1
  ) {
    reasons.push("asset validation report lacks validator provenance");
  }
  const unresolvedSevere = review.counterexamples.filter(
    (counterexample: AssetCounterexample) =>
      counterexample.severity === "severe" && !counterexample.resolved,
  );
  if (unresolvedSevere.length > 0) {
    reasons.push("an unresolved severe counterexample blocks promotion");
  }
  if (review.targetStatus === "active" && review.humanConfirmed !== true) {
    reasons.push("active promotion requires explicit human confirmation");
  }

  return {
    allowed: reasons.length === 0,
    targetStatus: review.targetStatus,
    reasons,
    ...counts,
  };
}

export function assertAssetValidationReport(
  validation: AssetValidationReport,
): void {
  if (
    validation === null ||
    typeof validation !== "object" ||
    typeof validation.validatorId !== "string" ||
    typeof validation.passed !== "boolean" ||
    !Array.isArray(validation.evidence) ||
    validation.validatorId.length < 1 ||
    validation.evidence.length < 1
  ) {
    throw new AssetLifecycleError(
      "asset validation report must identify a validator and evidence",
    );
  }
}
