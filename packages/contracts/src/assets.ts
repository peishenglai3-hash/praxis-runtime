import { z } from "zod";

import type {
  EventAppendResult,
  EventEnvelope,
  EvidenceRef,
} from "./events.js";
import { jsonValueSchema, utcTimestampSchema } from "./events.js";
import type { JsonValue } from "./json.js";
import type { WriterContext } from "./authorization.js";

export const assetKinds = [
  "rule",
  "skill",
  "workflow",
  "agent-policy",
  "summary",
  "pattern",
] as const;

export type AssetKind = (typeof assetKinds)[number];

export const assetKindSchema = z.enum(assetKinds);

export const assetStatuses = [
  "draft",
  "candidate",
  "validated",
  "active",
  "challenged",
  "deprecated",
] as const;

export type AssetStatus = (typeof assetStatuses)[number];

export const assetStatusSchema = z.enum(assetStatuses);

const nonEmptyString = z.string().min(1);

const evidenceRefSchema = z
  .object({
    eventId: nonEmptyString.optional(),
    assetId: nonEmptyString.optional(),
    artifactHash: nonEmptyString.optional(),
    origin: z.enum(["direct", "declared", "inferred", "institutional"]),
    exposureInfluenced: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.eventId !== undefined ||
      value.assetId !== undefined ||
      value.artifactHash !== undefined,
    "asset provenance must identify an event, asset, or artifact",
  );

export interface AssetRef {
  id: string;
  version: string;
  revision: number;
}

export const assetRefSchema = z
  .object({
    id: nonEmptyString,
    version: nonEmptyString,
    revision: z.number().int().positive(),
  })
  .strict();

export interface ReusableAsset {
  id: string;
  kind: AssetKind;
  version: string;
  revision: number;
  status: AssetStatus;
  body: JsonValue;
  derivedFrom: EvidenceRef[];
  forkedFrom?: AssetRef;
  createdAt: string;
  updatedAt: string;
}

export const reusableAssetSchema = z
  .object({
    id: nonEmptyString,
    kind: assetKindSchema,
    version: nonEmptyString,
    revision: z.number().int().positive(),
    status: assetStatusSchema,
    body: jsonValueSchema,
    derivedFrom: z.array(evidenceRefSchema).min(1),
    forkedFrom: assetRefSchema.optional(),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "asset updatedAt cannot precede createdAt",
      });
    }
    if (
      value.forkedFrom !== undefined &&
      value.forkedFrom.id === value.id &&
      value.forkedFrom.revision >= value.revision
    ) {
      context.addIssue({
        code: "custom",
        path: ["forkedFrom"],
        message: "forked asset must have a distinct lineage revision",
      });
    }
  });

export function parseReusableAsset(value: unknown): ReusableAsset {
  return reusableAssetSchema.parse(value) as ReusableAsset;
}

export interface AssetEpisodeEvidence {
  episodeId: string;
  evidence: EvidenceRef[];
  exposureInfluenced: boolean;
}

export interface AssetCounterexample {
  id: string;
  severity: "low" | "medium" | "severe";
  resolved: boolean;
  evidence?: EvidenceRef[];
}

export interface AssetValidationReport {
  validatorId: string;
  passed: boolean;
  evidence: EvidenceRef[];
}

export interface AssetPromotionReview {
  targetStatus: "validated" | "active";
  episodes: AssetEpisodeEvidence[];
  counterexamples: AssetCounterexample[];
  validation: AssetValidationReport;
  humanConfirmed?: boolean;
}

export interface AssetPromotionPolicyConfig {
  minimumEvidence: number;
  minimumIndependentEpisodes: number;
}

export const defaultAssetPromotionPolicy: AssetPromotionPolicyConfig = {
  minimumEvidence: 2,
  minimumIndependentEpisodes: 2,
};

export interface AssetPromotionDecision {
  allowed: boolean;
  targetStatus: AssetPromotionReview["targetStatus"];
  reasons: string[];
  evidenceCount: number;
  independentEpisodeCount: number;
  exposureInfluencedEvidenceCount: number;
}

/**
 * The only persistence path for a managed reusable-asset lifecycle event.
 * Implementations must commit the ledger event and the asset catalog update
 * atomically, so a revision conflict cannot leave a half-recorded asset.
 */
export interface AssetEventWriter {
  appendAssetEvent(
    event: EventEnvelope,
    writer: WriterContext,
    asset: ReusableAsset,
    expectedRevision?: number,
  ): EventAppendResult;
}

export interface AssetReader {
  getAsset(id: string): ReusableAsset | null;
  listAssets(): ReusableAsset[];
}
