import { describe, expect, it } from "vitest";

import type {
  LegacyAnomaly,
  LegacyMigrationPlan,
} from "../../packages/contracts/src/index.js";
import {
  buildLegacyMigrationReport,
  serialiseLegacyMigrationReport,
  summariseLegacyAnomalies,
} from "../../packages/runtime/src/index.js";

/**
 * The migration report is the document an operator attaches to a gate record,
 * so its two load-bearing properties are that it is stable (two runs over the
 * same corpus produce the same text) and that it describes the corpus rather
 * than carrying it. Both are asserted here on the pure builder, without a
 * database.
 */

const at = "2026-09-16T00:00:00.000Z";

function anomaly(
  anomalyClass: LegacyAnomaly["class"],
  affectedCount: number,
): LegacyAnomaly {
  return {
    id: `${anomalyClass}-${affectedCount}`,
    class: anomalyClass,
    reason: "fixture",
    affectedCount,
  };
}

function plan(anomalies: LegacyAnomaly[]): LegacyMigrationPlan {
  const counts = {
    scannedFiles: 0,
    signals: 0,
    patterns: 0,
    graphEdges: 0,
    anomalies: anomalies.length,
    exclusions: 0,
  };
  return {
    planHash: "a".repeat(64),
    sourceFingerprint: "b".repeat(64),
    root: "/corpus",
    createdAt: at,
    inventory: {
      root: "/corpus",
      fingerprint: "b".repeat(64),
      scannedAt: at,
      fileCount: 0,
      totalBytes: 0,
      entries: [],
      anomalies,
      countsByArtifactKind: {},
      countsByAnomalyClass: {},
    },
    signals: [],
    patterns: [],
    graphEdges: [],
    exclusions: [],
    counts,
  };
}

describe("legacy migration report", () => {
  it("sums anomalies by class and orders them so two reports agree byte for byte", () => {
    const summary = summariseLegacyAnomalies([
      anomaly("unmapped_path", 2),
      anomaly("parse_error", 1),
      anomaly("unmapped_path", 3),
    ]);
    expect(summary).toEqual([
      { class: "parse_error", count: 1 },
      { class: "unmapped_path", count: 5 },
    ]);
  });

  it("omits a class that did not occur rather than reporting it as zero", () => {
    // The absence of an anomaly is not a finding. A zero row would read as
    // "checked and clean", which is a claim this builder cannot make.
    const summary = summariseLegacyAnomalies([anomaly("parse_error", 1)]);
    expect(summary.map((entry) => entry.class)).toEqual(["parse_error"]);
    expect(summary).toHaveLength(1);
  });

  it("reports an empty anomaly set as empty", () => {
    expect(summariseLegacyAnomalies([])).toEqual([]);
  });

  it("derives the run id from the corpus and the plan, not from the clock", () => {
    const corpus = plan([]);
    const first = buildLegacyMigrationReport({
      plan: corpus,
      status: "dry-run",
      archive: null,
      startedAt: at,
      completedAt: at,
    });
    const second = buildLegacyMigrationReport({
      plan: corpus,
      status: "dry-run",
      archive: null,
      startedAt: "2026-09-16T09:09:09.000Z",
      completedAt: "2026-09-16T09:09:09.000Z",
    });
    expect(first.runId).toBe(second.runId);
    expect(first.runId).toMatch(/^legacy-run:[a-f0-9]{64}:[a-f0-9]{64}$/);
  });

  it("carries counts, digests and the archive manifest — and no record value", () => {
    const report = buildLegacyMigrationReport({
      plan: plan([anomaly("encoding_marker", 1)]),
      status: "dry-run",
      archive: null,
      startedAt: at,
      completedAt: at,
    });
    expect(Object.keys(report).sort()).toEqual([
      "anomalySummary",
      "archive",
      "completedAt",
      "counts",
      "planHash",
      "root",
      "runId",
      "sourceFingerprint",
      "startedAt",
      "status",
    ]);
  });

  it("serialises to JSON with a trailing newline so a diff is a line diff", () => {
    const report = buildLegacyMigrationReport({
      plan: plan([]),
      status: "dry-run",
      archive: null,
      startedAt: at,
      completedAt: at,
    });
    const text = serialiseLegacyMigrationReport(report);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(report);
    // Stable key order is what makes a textual diff meaningful.
    expect(Object.keys(JSON.parse(text) as object)).toEqual(
      Object.keys(report),
    );
  });
});
