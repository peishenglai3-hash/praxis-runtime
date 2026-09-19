import { z } from "zod";

import { utcTimestampSchema } from "./events.js";

/**
 * First-generation Legacy migration contracts.
 *
 * These shapes describe *auditable material*, not mechanism facts. A legacy
 * record is imported with an explicit provenance origin and keeps the declared
 * source path and fingerprint, so a later reader can always tell an imported
 * first-generation record apart from a directly observed runtime event.
 *
 * The contracts deliberately have no failure-repair surface: an anomaly is a
 * first-class record, and there is no field through which an importer may
 * assert a value the source did not contain.
 */

const nonEmptyString = z.string().min(1);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 hex");

/**
 * The recognised first-generation artifact families. Anything the scanner
 * meets that is not described here becomes `unmapped_path` rather than being
 * silently dropped or guessed at.
 */
export const legacyArtifactKinds = [
  "signal_index",
  "signal_body",
  "signal_buffer",
  "pattern_body",
  "graph_state",
  "event_log",
  "event_record",
  "subscription_index",
  "profile_document",
  "source_manifest",
  "unmapped_path",
] as const;

export type LegacyArtifactKind = (typeof legacyArtifactKinds)[number];

export const legacyArtifactKindSchema = z.enum(legacyArtifactKinds);

/**
 * Anomaly classes the importer must be able to report. The first six are the
 * classes named by the Bible; the last three were added by the Phase 5 audit
 * because the first-generation corpus contains them and they are not
 * expressible as any of the original six.
 */
export const legacyAnomalyClasses = [
  "possible_overwrite",
  "ambiguous_pattern",
  "source_metadata_conflict",
  "unrecoverable_field",
  "cartesian_relation",
  "parse_error",
  "encoding_marker",
  "unmapped_path",
  "privacy_sensitive",
] as const;

export type LegacyAnomalyClass = (typeof legacyAnomalyClasses)[number];

export const legacyAnomalyClassSchema = z.enum(legacyAnomalyClasses);

export const legacyParseStatuses = [
  "parsed",
  "partially_parsed",
  "failed",
  "skipped",
] as const;

export type LegacyParseStatus = (typeof legacyParseStatuses)[number];

export const legacyParseStatusSchema = z.enum(legacyParseStatuses);

/** One observed file under the legacy source root. */
export interface LegacySourceEntry {
  relativePath: string;
  artifactKind: LegacyArtifactKind;
  sizeBytes: number;
  modifiedAtMs: number;
  sha256: string;
  parseStatus: LegacyParseStatus;
  anomalyClasses: LegacyAnomalyClass[];
}

export const legacySourceEntrySchema = z
  .object({
    relativePath: nonEmptyString,
    artifactKind: legacyArtifactKindSchema,
    sizeBytes: z.number().int().nonnegative(),
    modifiedAtMs: z.number().int(),
    sha256: sha256Schema,
    parseStatus: legacyParseStatusSchema,
    anomalyClasses: z.array(legacyAnomalyClassSchema),
  })
  .strict();

/**
 * A detected anomaly. `declaredValue` carries the source material that the
 * anomaly is about when the anomaly is itself evidence of loss (a restarting
 * identifier sequence, a conflicting version declaration, a dropped field
 * name). It is never used to supply a value the source is missing.
 */
export interface LegacyAnomaly {
  id: string;
  class: LegacyAnomalyClass;
  reason: string;
  relativePath?: string;
  artifactKind?: LegacyArtifactKind;
  affectedCount: number;
  declaredValue?: string;
}

export const legacyAnomalySchema = z
  .object({
    id: nonEmptyString,
    class: legacyAnomalyClassSchema,
    reason: nonEmptyString,
    relativePath: nonEmptyString.optional(),
    artifactKind: legacyArtifactKindSchema.optional(),
    affectedCount: z.number().int().positive(),
    declaredValue: z.string().optional(),
  })
  .strict();

export interface LegacySourceInventory {
  root: string;
  fingerprint: string;
  scannedAt: string;
  fileCount: number;
  totalBytes: number;
  entries: LegacySourceEntry[];
  anomalies: LegacyAnomaly[];
  countsByArtifactKind: Record<string, number>;
  countsByAnomalyClass: Record<string, number>;
}

export const legacySourceInventorySchema = z
  .object({
    root: nonEmptyString,
    fingerprint: sha256Schema,
    scannedAt: utcTimestampSchema,
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    entries: z.array(legacySourceEntrySchema),
    anomalies: z.array(legacyAnomalySchema),
    countsByArtifactKind: z.record(z.string(), z.number().int().nonnegative()),
    countsByAnomalyClass: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

/**
 * Theory-grounded fields the first-generation writer declared as optional and
 * then never persisted. Their absence is recorded, not repaired.
 */
export const legacyOptionalSignalFields = [
  "order_of_worth",
  "justification",
  "test_count",
  "test_survival_rate",
  "reflexive_effect",
  "context_label",
] as const;

export type LegacyOptionalSignalField =
  (typeof legacyOptionalSignalFields)[number];

export interface LegacySignalRecord {
  recordId: string;
  signalKind: string;
  category: string;
  value: string;
  occurredAt: string;
  declaredTimestamp: string;
  confidence: number;
  source: string;
  sourcePath?: string;
  declaredFields: string[];
  absentFields: string[];
}

export const legacySignalRecordSchema = z
  .object({
    recordId: nonEmptyString,
    signalKind: nonEmptyString,
    category: nonEmptyString,
    value: z.string(),
    occurredAt: utcTimestampSchema,
    declaredTimestamp: z.string(),
    confidence: z.number().finite().min(0).max(1),
    source: nonEmptyString,
    sourcePath: nonEmptyString.optional(),
    declaredFields: z.array(nonEmptyString),
    absentFields: z.array(nonEmptyString),
  })
  .strict();

export interface LegacyPatternRecord {
  patternId: string;
  trigger: string;
  action: string;
  confidence: number;
  frequency: number;
  createdAt: string;
  lastSeen: string;
  sourcePaths: string[];
  collisionCount: number;
}

export const legacyPatternRecordSchema = z
  .object({
    patternId: nonEmptyString,
    trigger: z.string(),
    action: z.string(),
    confidence: z.number().finite().min(0).max(1),
    frequency: z.number().int().nonnegative(),
    createdAt: utcTimestampSchema,
    lastSeen: utcTimestampSchema,
    sourcePaths: z.array(nonEmptyString).min(1),
    collisionCount: z.number().int().positive(),
  })
  .strict();

/**
 * An imported association. `relationClass` records how the edge was produced:
 * a co-occurrence between two value groups, or the category-level cartesian
 * projection the first-generation visualiser derived from them.
 */
export const legacyRelationClasses = [
  "value_pair",
  "category_cartesian",
] as const;

export type LegacyRelationClass = (typeof legacyRelationClasses)[number];

export const legacyRelationClassSchema = z.enum(legacyRelationClasses);

export interface LegacyGraphEdge {
  from: string;
  to: string;
  strength: number;
  frequency: number;
  relationClass: LegacyRelationClass;
  /**
   * When the source says its association graph was built. The first generation
   * records one build time for the whole graph, not a time per association, so
   * an association with no build time is imported without a claimed instant
   * rather than with the import's own clock read.
   */
  declaredBuiltAt?: string;
}

export const legacyGraphEdgeSchema = z
  .object({
    from: nonEmptyString,
    to: nonEmptyString,
    strength: z.number().finite(),
    frequency: z.number().int().nonnegative(),
    relationClass: legacyRelationClassSchema,
    declaredBuiltAt: utcTimestampSchema.optional(),
  })
  .strict();

/** A record the privacy rule set excluded from import. */
export interface LegacyExclusion {
  ruleId: string;
  relativePath: string;
  reason: string;
}

export const legacyExclusionSchema = z
  .object({
    ruleId: nonEmptyString,
    relativePath: nonEmptyString,
    reason: nonEmptyString,
  })
  .strict();

export interface LegacyArchiveEntry {
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  archivedPath: string;
}

export const legacyArchiveEntrySchema = z
  .object({
    relativePath: nonEmptyString,
    sha256: sha256Schema,
    sizeBytes: z.number().int().nonnegative(),
    archivedPath: nonEmptyString,
  })
  .strict();

export interface LegacyArchiveManifest {
  archiveRoot: string;
  createdAt: string;
  sourceFingerprint: string;
  entries: LegacyArchiveEntry[];
}

export const legacyArchiveManifestSchema = z
  .object({
    archiveRoot: nonEmptyString,
    createdAt: utcTimestampSchema,
    sourceFingerprint: sha256Schema,
    entries: z.array(legacyArchiveEntrySchema),
  })
  .strict();

export interface LegacyMigrationCounts {
  scannedFiles: number;
  signals: number;
  patterns: number;
  graphEdges: number;
  anomalies: number;
  exclusions: number;
}

export const legacyMigrationCountsSchema = z
  .object({
    scannedFiles: z.number().int().nonnegative(),
    signals: z.number().int().nonnegative(),
    patterns: z.number().int().nonnegative(),
    graphEdges: z.number().int().nonnegative(),
    anomalies: z.number().int().nonnegative(),
    exclusions: z.number().int().nonnegative(),
  })
  .strict();

/**
 * A dry-run plan. `planHash` is the confirmation token: committing an import
 * requires presenting the hash of the plan the operator actually reviewed, so
 * a changed source or a changed rule set invalidates the confirmation.
 */
export interface LegacyMigrationPlan {
  planHash: string;
  sourceFingerprint: string;
  root: string;
  createdAt: string;
  inventory: LegacySourceInventory;
  signals: LegacySignalRecord[];
  patterns: LegacyPatternRecord[];
  graphEdges: LegacyGraphEdge[];
  exclusions: LegacyExclusion[];
  counts: LegacyMigrationCounts;
}

export const legacyMigrationPlanSchema = z
  .object({
    planHash: sha256Schema,
    sourceFingerprint: sha256Schema,
    root: nonEmptyString,
    createdAt: utcTimestampSchema,
    inventory: legacySourceInventorySchema,
    signals: z.array(legacySignalRecordSchema),
    patterns: z.array(legacyPatternRecordSchema),
    graphEdges: z.array(legacyGraphEdgeSchema),
    exclusions: z.array(legacyExclusionSchema),
    counts: legacyMigrationCountsSchema,
  })
  .strict();

export const legacyMigrationReportStatuses = [
  "dry-run",
  "applied",
  "already-imported",
] as const;

export type LegacyMigrationReportStatus =
  (typeof legacyMigrationReportStatuses)[number];

export const legacyMigrationReportStatusSchema = z.enum(
  legacyMigrationReportStatuses,
);

export interface LegacyAnomalySummary {
  class: LegacyAnomalyClass;
  count: number;
}

export const legacyAnomalySummarySchema = z
  .object({
    class: legacyAnomalyClassSchema,
    count: z.number().int().nonnegative(),
  })
  .strict();

/**
 * The stored outcome of one import run. It contains counts, classes and
 * digests; it never contains record values. That keeps the report safe to
 * print, export and attach to a gate document.
 */
export interface LegacyMigrationReport {
  runId: string;
  status: LegacyMigrationReportStatus;
  planHash: string;
  sourceFingerprint: string;
  root: string;
  counts: LegacyMigrationCounts;
  anomalySummary: LegacyAnomalySummary[];
  archive: LegacyArchiveManifest | null;
  startedAt: string;
  completedAt: string;
}

export const legacyMigrationReportSchema = z
  .object({
    runId: nonEmptyString,
    status: legacyMigrationReportStatusSchema,
    planHash: sha256Schema,
    sourceFingerprint: sha256Schema,
    root: nonEmptyString,
    counts: legacyMigrationCountsSchema,
    anomalySummary: z.array(legacyAnomalySummarySchema),
    archive: legacyArchiveManifestSchema.nullable(),
    startedAt: utcTimestampSchema,
    completedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "report completedAt cannot precede startedAt",
      });
    }
  });

/** A privacy rule the importer honours. Matching is by literal path prefix. */
export interface LegacyPrivacyRule {
  ruleId: string;
  pathPrefix: string;
  reason: string;
}

export const legacyPrivacyRuleSchema = z
  .object({
    ruleId: nonEmptyString,
    pathPrefix: nonEmptyString,
    reason: nonEmptyString,
  })
  .strict();

export function parseLegacyMigrationPlan(value: unknown): LegacyMigrationPlan {
  return legacyMigrationPlanSchema.parse(value) as LegacyMigrationPlan;
}

/**
 * Deterministic run identity. Deriving it from `(fingerprint, planHash)` in one
 * shared helper means an identical re-import resolves to the same row instead
 * of creating a duplicate run, and the runtime and store cannot disagree about
 * which identifier a run has.
 */
export function legacyImportRunId(
  sourceFingerprint: string,
  planHash: string,
): string {
  return `legacy-run:${sourceFingerprint}:${planHash}`;
}

export function parseLegacyMigrationReport(
  value: unknown,
): LegacyMigrationReport {
  return legacyMigrationReportSchema.parse(value) as LegacyMigrationReport;
}

export function parseLegacySignalRecord(value: unknown): LegacySignalRecord {
  return legacySignalRecordSchema.parse(value) as LegacySignalRecord;
}

export function parseLegacyPatternRecord(value: unknown): LegacyPatternRecord {
  return legacyPatternRecordSchema.parse(value) as LegacyPatternRecord;
}
