import { readFileSync } from "node:fs";
import { log } from "node:console";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSchema(filename) {
  return JSON.parse(readFileSync(join(rootDir, "schemas", filename), "utf8"));
}

function requireFields(schema, fields, label) {
  const required = new Set(schema.required ?? []);
  for (const field of fields) {
    if (!required.has(field)) {
      throw new Error(`${label} is missing required field ${field}`);
    }
  }
}

function requirePropertyConst(schema, field, value, label) {
  if (schema.properties?.[field]?.const !== value) {
    throw new Error(`${label}.${field} must be const ${value}`);
  }
}

function requireReflectionConditionals(schema, label) {
  const rules = schema.allOf ?? [];
  const stopRule = rules.find(
    (rule) => rule.if?.properties?.decision?.const === "STOP",
  );
  const continuingRule = rules.find((rule) =>
    rule.if?.properties?.decision?.enum?.includes("CONTINUE"),
  );

  if (
    stopRule?.then?.properties?.hypotheses?.maxItems !== 0 ||
    stopRule?.then?.properties?.recommendedActions?.maxItems !== 0
  ) {
    throw new Error(
      `${label} must forbid hypotheses and actions when decision is STOP`,
    );
  }
  if (
    continuingRule?.then?.properties?.hypotheses?.minItems !== 1 ||
    continuingRule?.then?.properties?.budgetUsed?.properties?.depth?.minimum !==
      1
  ) {
    throw new Error(
      `${label} must require bounded continuation evidence and depth`,
    );
  }
}

function requireActionPermissionMapping(schema, label) {
  const action = schema.$defs?.action;
  const expected = new Map([
    ["collect-evidence", "none"],
    ["verify-external", "external-verifier"],
    ["request-human-confirmation", "human-confirmation"],
  ]);
  for (const [kind, permission] of expected) {
    const rule = (action?.allOf ?? []).find(
      (candidate) =>
        candidate.if?.properties?.kind?.const === kind &&
        candidate.then?.properties?.requiredPermission?.const === permission,
    );
    if (!rule) {
      throw new Error(
        `${label} must map ${kind} to requiredPermission ${permission}`,
      );
    }
  }
}

function requireTimingCursorRule(schema, label) {
  const rule = (schema.allOf ?? []).find(
    (candidate) => candidate.if?.properties?.kind?.const === "timing",
  );
  const value =
    rule?.then?.properties?.observed?.properties?.value ?? undefined;
  if (
    value?.type !== "object" ||
    !value.required?.includes("cursorSeq") ||
    !value.required?.includes("latestRelevantSeq") ||
    value.properties?.cursorSeq?.minimum !== 0 ||
    value.properties?.latestRelevantSeq?.minimum !== 0
  ) {
    throw new Error(`${label} must require non-negative timing cursor fields`);
  }
}

const residual = readSchema("residual.v1.schema.json");
const residualEvent = readSchema("residual-detected-event.v1.schema.json");
const reflection = readSchema("reflection-proposal.v1.schema.json");
const reflectionEvent = readSchema("reflection-proposed-event.v1.schema.json");
const expectationEvent = readSchema(
  "expectation-registered-event.v1.schema.json",
);
const writerContext = readSchema("writer-context.v1.schema.json");
const expectation = readSchema("expectation.v1.schema.json");
const verificationResult = readSchema("verification-result.v1.schema.json");
const reusableAsset = readSchema("reusable-asset.v1.schema.json");

requireFields(
  residual,
  [
    "id",
    "kind",
    "observed",
    "field",
    "confidence",
    "persistence",
    "effect",
    "evidence",
    "detectedAt",
  ],
  "residual.v1",
);
requireFields(
  residualEvent,
  [
    "materialClassification",
    "residualId",
    "kind",
    "observed",
    "field",
    "confidence",
    "persistence",
    "effect",
    "evidence",
    "detectedAt",
  ],
  "residual-detected-event.v1",
);
requireFields(
  reflection,
  [
    "residualId",
    "decision",
    "reasons",
    "hypotheses",
    "recommendedActions",
    "budget",
    "budgetUsed",
    "evidenceDelta",
  ],
  "reflection-proposal.v1",
);
requireFields(
  reflectionEvent,
  [
    "materialClassification",
    "residualId",
    "decision",
    "reasons",
    "hypotheses",
    "recommendedActions",
    "budget",
    "budgetUsed",
    "evidenceDelta",
  ],
  "reflection-proposed-event.v1",
);
requireFields(
  expectationEvent,
  [
    "materialClassification",
    "expectationId",
    "subject",
    "expected",
    "verification",
    "createdAt",
    "evidence",
  ],
  "expectation-registered-event.v1",
);
requireFields(
  writerContext,
  ["writerId", "kind", "role", "authn", "scopes", "policyVersion"],
  "writer-context.v1",
);
requireFields(
  expectation,
  [
    "id",
    "source",
    "subject",
    "expected",
    "verification",
    "createdAt",
    "validFrom",
    "status",
    "evidence",
    "updatedAt",
  ],
  "expectation.v1",
);
requireFields(
  verificationResult,
  ["id", "expectationId", "verifier", "observedAt", "outcome", "evidence"],
  "verification-result.v1",
);
requireFields(
  reusableAsset,
  [
    "id",
    "kind",
    "version",
    "revision",
    "status",
    "body",
    "derivedFrom",
    "createdAt",
    "updatedAt",
  ],
  "reusable-asset.v1",
);

requirePropertyConst(
  residualEvent,
  "materialClassification",
  "inferred",
  "residual event",
);
if (reflection.properties?.reasons?.minItems !== 1) {
  throw new Error("reflection proposal reasons must require at least one item");
}
requirePropertyConst(residualEvent, "effect", "unknown", "residual event");
requirePropertyConst(
  reflectionEvent,
  "materialClassification",
  "inferred",
  "reflection event",
);
requirePropertyConst(
  expectationEvent,
  "materialClassification",
  "declared",
  "expectation event",
);
const expectedWriterScopes = [
  "event.read",
  "event.append",
  "state.read",
  "residual.propose",
  "tool.execute",
  "asset.propose",
  "asset.activate",
  "asset.contest",
  "asset.disable",
  "asset.restore",
  "asset.fork",
  "history.export",
  "history.purge",
  "system.migrate",
];
const expectedWriterRoles = [
  "OWNER",
  "OBSERVER",
  "ANALYZER",
  "VERIFIER",
  "COORDINATOR",
  "ADAPTER",
  "IMPORTER",
  "MIGRATION",
];
if (
  JSON.stringify(writerContext.properties?.role?.enum) !==
  JSON.stringify(expectedWriterRoles)
) {
  throw new Error("writer-context.v1 roles do not match the frozen ACL");
}
if (writerContext.properties?.policyVersion?.const !== 1) {
  throw new Error(
    "writer-context.v1 policyVersion must be the frozen version 1",
  );
}
if (
  JSON.stringify(writerContext.properties?.scopes?.items?.enum) !==
  JSON.stringify(expectedWriterScopes)
) {
  throw new Error("writer-context.v1 scopes do not match the frozen ACL");
}
if (
  JSON.stringify(expectation.properties?.status?.enum) !==
  JSON.stringify(["pending", "satisfied", "violated", "expired", "unknown"])
) {
  throw new Error(
    "expectation.v1 status enum does not match the runtime contract",
  );
}
if (
  JSON.stringify(verificationResult.properties?.outcome?.enum) !==
  JSON.stringify(["satisfied", "violated", "unknown"])
) {
  throw new Error(
    "verification-result.v1 outcome enum does not match the runtime contract",
  );
}
if (
  JSON.stringify(reusableAsset.properties?.kind?.enum) !==
    JSON.stringify([
      "rule",
      "skill",
      "workflow",
      "agent-policy",
      "summary",
      "pattern",
    ]) ||
  JSON.stringify(reusableAsset.properties?.status?.enum) !==
    JSON.stringify([
      "draft",
      "candidate",
      "validated",
      "active",
      "challenged",
      "deprecated",
    ])
) {
  throw new Error("reusable-asset.v1 enums do not match the runtime contract");
}
requireReflectionConditionals(reflection, "reflection proposal");
requireReflectionConditionals(reflectionEvent, "reflection event");
requireActionPermissionMapping(reflection, "reflection proposal");
requireActionPermissionMapping(reflectionEvent, "reflection event");
requireTimingCursorRule(residual, "residual proposal");
requireTimingCursorRule(residualEvent, "residual event");

const residualOutcomeRule = residual.allOf?.[0];
const residualEventOutcomeRule = residualEvent.allOf?.[0];
if (
  !residualOutcomeRule?.then?.required?.includes("baselineId") ||
  !residualOutcomeRule?.then?.required?.includes("baseline") ||
  !residualEventOutcomeRule?.then?.required?.includes("baselineId") ||
  !residualEventOutcomeRule?.then?.required?.includes("baseline")
) {
  throw new Error(
    "outcome residual schemas must require the declared baseline",
  );
}

for (const [schema, label] of [
  [residual, "residual.v1"],
  [residualEvent, "residual-detected-event.v1"],
]) {
  if (schema.properties?.evidence?.minItems !== 1) {
    throw new Error(`${label}.evidence must require at least one item`);
  }
}

log("Phase 3/3.5 schema parity PASS");
