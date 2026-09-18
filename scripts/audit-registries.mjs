#!/usr/bin/env node
/**
 * Machine-check the two control-plane registries used by the Phase 6V audit.
 *
 * The prose remains the historical record. This checker does not infer a
 * status from Chinese narrative text; it compares the current breakpoint
 * headings with the explicit status table in DEBT-RECONCILIATION.md, and it
 * compares RFC-0001's registered labels with the reconciliation summary. That
 * makes stale totals, duplicate ids, missing rows and silently dropped RFC
 * labels fail loudly instead of becoming another false-green report.
 */
import { readFileSync } from "node:fs";
import { error, log } from "node:console";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const STATUS_NAMES = [
  "CLOSED",
  "ACTIVE",
  "EVIDENCE-REQUIRED",
  "DEFERRED",
  "WONTFIX",
];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(root, relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function unique(values) {
  return [...new Set(values)];
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function sortedDifference(left, right) {
  const rightSet = new Set(right);
  return unique(left.filter((value) => !rightSet.has(value))).sort();
}

export function extractBreakpointHeadings(markdown) {
  return [
    ...markdown.matchAll(/^##\s+(?:Breakpoint\s+)?(BP-\d{3}|P35-\d+)\b/gm),
  ].map((match) => match[1]);
}

export function extractDebtRows(markdown) {
  const rows = [];
  const pattern =
    /^\|\s*(BP-\d{3}|P35-\d+)\s*\|[^\r\n]*?\|\s*`(CLOSED|ACTIVE|EVIDENCE-REQUIRED|DEFERRED|WONTFIX)(?:\s+\(record\))?`(?:\s+\(record\))?\s*\|/gm;
  for (const match of markdown.matchAll(pattern)) {
    rows.push({ id: match[1], status: match[2] });
  }
  return rows;
}

export function extractDebtSummary(markdown) {
  const summaryEnd = markdown.indexOf("## The full table");
  const summary = summaryEnd < 0 ? markdown : markdown.slice(0, summaryEnd);
  const result = {};
  const pattern =
    /^\|\s*`(CLOSED|ACTIVE|EVIDENCE-REQUIRED|DEFERRED|WONTFIX)`\s*\|\s*(\d+)\s*\|/gm;
  for (const match of summary.matchAll(pattern)) {
    result[match[1]] = Number(match[2]);
  }
  return result;
}

export function extractRfcLabels(rfcMarkdown) {
  return unique(
    [
      ...rfcMarkdown.matchAll(
        /(?:RFC MISMATCH: [A-Z0-9_]+|OPEN GAP: CONFIGURATION_SURFACE)/g,
      ),
    ].map((match) => match[0]),
  ).sort();
}

export function extractRfcRows(reconciliationMarkdown) {
  const summaryStart = reconciliationMarkdown.indexOf("## Summary");
  const countsStart = reconciliationMarkdown.indexOf("Counts:", summaryStart);
  const summary = reconciliationMarkdown.slice(
    summaryStart < 0 ? 0 : summaryStart,
    countsStart < 0 ? reconciliationMarkdown.length : countsStart,
  );
  const rows = [];
  const pattern =
    /^\|\s*`((?:RFC MISMATCH: [A-Z0-9_]+|OPEN GAP: CONFIGURATION_SURFACE))`\s*\|\s*([A-Z]+(?:-[A-Z]+)*)\s*\|/gm;
  for (const match of summary.matchAll(pattern)) {
    rows.push({ label: match[1], status: match[2] });
  }
  return rows;
}

export function extractRfcSummaryCounts(reconciliationMarkdown) {
  const fullLine = reconciliationMarkdown.match(/^Counts:\s*(.*)$/m)?.[1] ?? "";
  const line = fullLine.split(";")[0] ?? "";
  const result = {};
  for (const match of line.matchAll(/(\d+)\s+([A-Z]+(?:-[A-Z]+)*)/g)) {
    result[match[2]] = Number(match[1]);
  }
  return result;
}

function compareCountMaps(actual, declared, label, issues) {
  for (const status of unique([
    ...Object.keys(actual),
    ...Object.keys(declared),
  ])) {
    if ((actual[status] ?? 0) !== (declared[status] ?? 0)) {
      issues.push(
        `${label} count mismatch for ${status}: actual=${actual[status] ?? 0}, declared=${declared[status] ?? 0}`,
      );
    }
  }
}

export function auditRegistries(root = repositoryRoot) {
  const breakpoints = extractBreakpointHeadings(read(root, "docs/断点记录.md"));
  const debtMarkdown = read(root, "docs/engineering/DEBT-RECONCILIATION.md");
  const debtRows = extractDebtRows(debtMarkdown);
  const debtSummary = extractDebtSummary(debtMarkdown);
  const rfcMarkdown = read(root, "docs/RFC/RFC-0001.md");
  const rfcReconciliation = read(
    root,
    "docs/engineering/RFC-MISMATCH-RECONCILIATION.md",
  );
  const rfcLabels = extractRfcLabels(rfcMarkdown);
  const rfcRows = extractRfcRows(rfcReconciliation);
  const rfcSummary = extractRfcSummaryCounts(rfcReconciliation);
  const issues = [];

  const duplicateBreakpoints = duplicates(breakpoints);
  if (duplicateBreakpoints.length > 0) {
    issues.push(
      `duplicate breakpoint headings: ${duplicateBreakpoints.join(", ")}`,
    );
  }
  const duplicateDebtRows = duplicates(debtRows.map((row) => row.id));
  if (duplicateDebtRows.length > 0) {
    issues.push(`duplicate debt rows: ${duplicateDebtRows.join(", ")}`);
  }
  const missingDebtRows = sortedDifference(
    breakpoints,
    debtRows.map((row) => row.id),
  );
  const extraDebtRows = sortedDifference(
    debtRows.map((row) => row.id),
    breakpoints,
  );
  if (missingDebtRows.length > 0) {
    issues.push(
      `breakpoints missing from debt table: ${missingDebtRows.join(", ")}`,
    );
  }
  if (extraDebtRows.length > 0) {
    issues.push(
      `debt rows missing from breakpoint record: ${extraDebtRows.join(", ")}`,
    );
  }
  const debtCounts = debtRows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
  compareCountMaps(debtCounts, debtSummary, "debt registry", issues);
  if (debtRows.length !== breakpoints.length) {
    issues.push(
      `debt registry row total mismatch: headings=${breakpoints.length}, rows=${debtRows.length}`,
    );
  }

  const duplicateRfcLabels = duplicates(rfcLabels);
  if (duplicateRfcLabels.length > 0) {
    issues.push(`duplicate RFC labels: ${duplicateRfcLabels.join(", ")}`);
  }
  const duplicateRfcRows = duplicates(rfcRows.map((row) => row.label));
  if (duplicateRfcRows.length > 0) {
    issues.push(
      `duplicate RFC reconciliation rows: ${duplicateRfcRows.join(", ")}`,
    );
  }
  const missingRfcRows = sortedDifference(
    rfcLabels,
    rfcRows.map((row) => row.label),
  );
  const extraRfcRows = sortedDifference(
    rfcRows.map((row) => row.label),
    rfcLabels,
  );
  if (missingRfcRows.length > 0) {
    issues.push(
      `RFC labels missing from reconciliation: ${missingRfcRows.join(", ")}`,
    );
  }
  if (extraRfcRows.length > 0) {
    issues.push(
      `RFC reconciliation rows missing from RFC registry: ${extraRfcRows.join(", ")}`,
    );
  }
  const rfcCounts = rfcRows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
  compareCountMaps(rfcCounts, rfcSummary, "RFC registry", issues);
  if (rfcRows.length !== rfcLabels.length) {
    issues.push(
      `RFC registry row total mismatch: RFC labels=${rfcLabels.length}, rows=${rfcRows.length}`,
    );
  }

  return {
    issues,
    breakpoints: {
      headings: breakpoints.length,
      rows: debtRows.length,
      counts: debtCounts,
    },
    rfc: { labels: rfcLabels.length, rows: rfcRows.length, counts: rfcCounts },
  };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const result = auditRegistries();
  if (result.issues.length > 0) {
    error("registry audit FAIL");
    for (const issue of result.issues) error(`  - ${issue}`);
    process.exit(1);
  }
  log(
    `registry audit PASS (breakpoints=${result.breakpoints.headings}, RFC labels=${result.rfc.labels})`,
  );
}
