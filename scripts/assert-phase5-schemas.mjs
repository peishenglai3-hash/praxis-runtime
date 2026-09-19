#!/usr/bin/env node
/**
 * Phase 5 schema parity gate.
 *
 * Unlike the Phase 3 gate, which compares schema files against constants
 * repeated inside the script, this gate imports the compiled contract module
 * and compares the schemas against the code that actually validates payloads.
 * A drift between `packages/contracts` and `schemas/` therefore fails here
 * rather than surviving as two independently maintained copies of the same
 * rule.
 *
 * Run after `pnpm build`; the verify chain guarantees that order.
 */

import { readFileSync } from "node:fs";
import { log } from "node:console";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { praxisConfigFields } from "../apps/cli/dist/config.js";
import {
  legacyAnomalyClasses,
  legacyEventTypes,
  legacyMigrationReportStatuses,
  legacyOptionalSignalFields,
} from "../packages/contracts/dist/index.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSchema(filename) {
  return JSON.parse(readFileSync(join(rootDir, "schemas", filename), "utf8"));
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} drifted\n  schema:   ${JSON.stringify(actual)}\n  contract: ${JSON.stringify(expected)}`,
    );
  }
}

const signalEvent = readSchema("legacy-signal-imported-event.v1.schema.json");
const anomalyEvent = readSchema("legacy-anomaly-event.v1.schema.json");
const report = readSchema("legacy-migration-report.v1.schema.json");

// --- The event family ---------------------------------------------------------

const expectedEventTypes = [
  "legacy.signal.imported",
  "legacy.pattern.imported",
  "legacy.graph-edge.imported",
  "legacy.anomaly",
  "legacy.import.completed",
];
assertEqual([...legacyEventTypes], expectedEventTypes, "legacy event types");

// --- Anomaly classes ----------------------------------------------------------

const expectedAnomalyClasses = [
  "possible_overwrite",
  "ambiguous_pattern",
  "source_metadata_conflict",
  "unrecoverable_field",
  "cartesian_relation",
  "parse_error",
  "encoding_marker",
  "unmapped_path",
  "privacy_sensitive",
];
assertEqual(
  [...legacyAnomalyClasses],
  expectedAnomalyClasses,
  "legacy anomaly classes",
);
assertEqual(
  anomalyEvent.properties?.anomalyClass?.enum,
  [...legacyAnomalyClasses],
  "legacy-anomaly-event.v1 anomalyClass enum",
);
assertEqual(
  report.properties?.anomalySummary?.items?.properties?.class?.enum,
  [...legacyAnomalyClasses],
  "legacy-migration-report.v1 anomalySummary class enum",
);

// --- Report status ------------------------------------------------------------

assertEqual(
  report.properties?.status?.enum,
  [...legacyMigrationReportStatuses],
  "legacy-migration-report.v1 status enum",
);

// --- Imported material cannot claim to be more than declared ------------------

if (signalEvent.properties?.materialClassification?.const !== "declared") {
  throw new Error(
    "an imported signal is source-declared material and must say so",
  );
}
for (const field of ["absentFields", "declaredFields"]) {
  if (signalEvent.properties?.[field]?.type !== "array") {
    throw new Error(
      `an imported signal must carry its ${field} so a reader never infers an absent value`,
    );
  }
}
if (!(signalEvent.required ?? []).includes("absentFields")) {
  throw new Error("absentFields is required on an imported signal");
}

// --- Every anomaly is evidence-bearing and never a repair ---------------------

for (const field of ["reason", "affectedCount", "anomalyClass"]) {
  if (!(anomalyEvent.required ?? []).includes(field)) {
    throw new Error(`legacy-anomaly-event.v1 must require ${field}`);
  }
}
if (
  anomalyEvent.properties?.affectedCount?.minimum !== 1 ||
  anomalyEvent.properties?.affectedCount?.type !== "integer"
) {
  throw new Error(
    "an anomaly must affect at least one item; an empty anomaly is not a record",
  );
}
if (Object.hasOwn(anomalyEvent.properties ?? {}, "repairedValue")) {
  throw new Error(
    "the anomaly contract must not offer a field for a repaired value",
  );
}

// --- The report carries counts and digests, not record values -----------------

for (const field of [
  "startedAt",
  "completedAt",
  "planHash",
  "sourceFingerprint",
]) {
  if (!(report.required ?? []).includes(field)) {
    throw new Error(`legacy-migration-report.v1 must require ${field}`);
  }
}
const reportProperties = Object.keys(report.properties ?? {}).sort();
assertEqual(
  reportProperties,
  [
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
  ],
  "legacy-migration-report.v1 property set",
);
if (report.properties?.archive?.oneOf?.length !== 2) {
  throw new Error(
    "the report must model an absent archive explicitly rather than by omission",
  );
}

// --- The declared-optional field list is part of the contract -----------------

if (legacyOptionalSignalFields.length !== 6) {
  throw new Error(
    "the documented set of first-generation optional signal fields changed; update the field map",
  );
}
const fieldMap = readFileSync(
  join(rootDir, "docs", "migration", "LEGACY-FIELD-MAP.md"),
  "utf8",
);
for (const field of legacyOptionalSignalFields) {
  if (!fieldMap.includes(`\`${field}\``)) {
    throw new Error(
      `docs/migration/LEGACY-FIELD-MAP.md does not document the optional field ${field}`,
    );
  }
}

// --- Operator configuration ---------------------------------------------------

const configSchema = readSchema("praxis-config.v1.schema.json");
assertEqual(
  Object.keys(configSchema.properties ?? {}).sort(),
  [...praxisConfigFields].sort(),
  "praxis-config.v1 property set",
);
if (configSchema.additionalProperties !== false) {
  throw new Error(
    "praxis-config.v1 must reject unknown fields, because a misspelled key on a ledger-writing runtime is a mistake with consequences",
  );
}
if (
  configSchema.required?.length !== 1 ||
  configSchema.required[0] !== "schemaVersion"
) {
  throw new Error("praxis-config.v1 must require only schemaVersion");
}

log("Phase 5 schema parity PASS");
