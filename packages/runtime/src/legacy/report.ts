import type {
  LegacyAnomaly,
  LegacyArchiveManifest,
  LegacyMigrationPlan,
  LegacyMigrationReport,
  LegacyMigrationReportStatus,
} from "@praxis/contracts";
import { legacyImportRunId } from "@praxis/contracts";

/**
 * One construction site for a migration report, so the document a dry run
 * writes and the document a committed run stores cannot drift apart.
 *
 * Bible issue 075 defines the migration report as import statistics,
 * anomalies, unrecoverable material and candidate counts. It deliberately
 * carries counts, classes and digests rather than record values, which is what
 * lets an operator attach it to a gate document without carrying the corpus
 * with it.
 */
export interface LegacyMigrationReportInput {
  plan: LegacyMigrationPlan;
  status: LegacyMigrationReportStatus;
  /** `null` for a dry run: no archive is written until the import commits. */
  archive: LegacyArchiveManifest | null;
  startedAt: string;
  completedAt: string;
}

export function buildLegacyMigrationReport(
  input: LegacyMigrationReportInput,
): LegacyMigrationReport {
  const { plan } = input;
  return {
    runId: legacyImportRunId(plan.sourceFingerprint, plan.planHash),
    status: input.status,
    planHash: plan.planHash,
    sourceFingerprint: plan.sourceFingerprint,
    root: plan.root,
    counts: plan.counts,
    anomalySummary: summariseLegacyAnomalies(plan.inventory.anomalies),
    archive: input.archive,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
}

/**
 * Anomalies are summed by class and ordered by class name so two reports over
 * the same corpus are byte-identical. A class that did not occur is absent
 * rather than reported as zero: the absence of an anomaly is not a finding.
 */
export function summariseLegacyAnomalies(
  anomalies: readonly LegacyAnomaly[],
): LegacyMigrationReport["anomalySummary"] {
  const counts = new Map<LegacyAnomaly["class"], number>();
  for (const anomaly of anomalies) {
    counts.set(
      anomaly.class,
      (counts.get(anomaly.class) ?? 0) + anomaly.affectedCount,
    );
  }
  return [...counts.entries()]
    .map(([anomalyClass, count]) => ({ class: anomalyClass, count }))
    .sort((left, right) => (left.class < right.class ? -1 : 1));
}

/**
 * The document is JSON with a stable key order and a trailing newline, so an
 * operator can diff two runs and a test can assert on bytes rather than on a
 * parsed subset.
 */
export function serialiseLegacyMigrationReport(
  report: LegacyMigrationReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
