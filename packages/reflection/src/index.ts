import type { EvidenceRef, JsonObject } from "@praxis/contracts";
import { stableStringify } from "@praxis/contracts";
import type { Residual, ResidualKind } from "@praxis/residual";

export type ReflectionDecision = "STOP" | "CONTINUE" | "ESCALATE";

export interface ReflectionBudget {
  maxDepth: number;
  maxHypotheses: number;
  maxToolCalls: number;
  maxElapsedMs: number;
}

export interface ReflectionBudgetUsage {
  depth: number;
  hypotheses: number;
  toolCalls: number;
  elapsedMs: number;
}

export interface ReflectionEvidenceDelta {
  fromSeq: number;
  toSeq: number;
  evidence: EvidenceRef[];
}

export type ReflectionActionKind =
  "collect-evidence" | "verify-external" | "request-human-confirmation";

export type ReflectionPermission =
  "none" | "external-verifier" | "human-confirmation";

export interface ReflectionAction {
  id: string;
  kind: ReflectionActionKind;
  requiredPermission: ReflectionPermission;
  parameters: JsonObject;
}

export interface ReflectionHypothesis {
  id: string;
  statement: string;
  support: EvidenceRef[];
  counterevidence: EvidenceRef[];
  testability: string;
  estimatedCost: number;
}

export interface ReflectionInput {
  residual: Residual;
  budget: ReflectionBudget;
  evidenceDelta: ReflectionEvidenceDelta;
  usage?: Partial<ReflectionBudgetUsage>;
}

export interface ReflectionResult {
  residualId: string;
  decision: ReflectionDecision;
  reasons: string[];
  hypotheses: ReflectionHypothesis[];
  recommendedActions: ReflectionAction[];
  budget: ReflectionBudget;
  budgetUsed: ReflectionBudgetUsage;
  evidenceDelta: ReflectionEvidenceDelta;
}

/**
 * Produces bounded, explainable proposals. It never writes events, calls an
 * agent, invokes a tool, promotes an asset, or changes a residual.
 */
export class ReflectionController {
  reflect(input: ReflectionInput): ReflectionResult {
    validateResidual(input.residual);
    const budget = validateBudget(input.budget);
    const current = validateUsage(input.usage ?? {}, budget);
    const evidenceDelta = validateEvidenceDelta(input.evidenceDelta);
    const budgetUsed: ReflectionBudgetUsage = { ...current };
    const reasons: string[] = [];

    if (!hasNewEvidence(evidenceDelta)) {
      reasons.push(
        "no new evidence or event is available; the same residual cannot self-call",
      );
      return result(
        input.residual.id,
        "STOP",
        reasons,
        [],
        [],
        budget,
        budgetUsed,
        evidenceDelta,
      );
    }

    if (current.depth >= budget.maxDepth) {
      reasons.push("maximum reflection depth has been reached");
      return result(
        input.residual.id,
        "STOP",
        reasons,
        [],
        [],
        budget,
        budgetUsed,
        evidenceDelta,
      );
    }

    if (current.elapsedMs >= budget.maxElapsedMs) {
      reasons.push("maximum reflection elapsed-time budget has been reached");
      return result(
        input.residual.id,
        "STOP",
        reasons,
        [],
        [],
        budget,
        budgetUsed,
        evidenceDelta,
      );
    }

    const availableHypotheses = budget.maxHypotheses - current.hypotheses;
    if (availableHypotheses < 1) {
      reasons.push("maximum hypothesis budget has been reached");
      return result(
        input.residual.id,
        "STOP",
        reasons,
        [],
        [],
        budget,
        budgetUsed,
        evidenceDelta,
      );
    }

    const hypotheses = [createHypothesis(input.residual)];
    budgetUsed.depth += 1;
    budgetUsed.hypotheses += hypotheses.length;

    const escalationReasons = escalationReasonsFor(input.residual);
    if (escalationReasons.length > 0) {
      reasons.push(...escalationReasons);
      return result(
        input.residual.id,
        "ESCALATE",
        reasons,
        hypotheses,
        [createHumanAction(input.residual.id, escalationReasons[0]!)],
        budget,
        budgetUsed,
        evidenceDelta,
      );
    }

    reasons.push(
      "new evidence is available within the bounded reflection budget",
    );
    return result(
      input.residual.id,
      "CONTINUE",
      reasons,
      hypotheses,
      [createNextEvidenceAction(input.residual)],
      budget,
      budgetUsed,
      evidenceDelta,
    );
  }
}

export function validateReflectionResult(result: ReflectionResult): void {
  if (result.residualId.length < 1) {
    throw new Error("reflection result residualId is required");
  }
  if (!isDecision(result.decision)) {
    throw new Error("reflection result decision is invalid");
  }
  if (
    result.reasons.length < 1 ||
    result.reasons.some((reason) => reason.length < 1)
  ) {
    throw new Error("reflection result reasons are required");
  }
  const budget = validateBudget(result.budget);
  const budgetUsed = validateUsage(result.budgetUsed, budget);
  validateEvidenceDelta(result.evidenceDelta);
  if (budgetUsed.hypotheses < result.hypotheses.length) {
    throw new Error("reflection result hypothesis usage is inconsistent");
  }
  if (result.hypotheses.length > budget.maxHypotheses) {
    throw new Error("reflection result exceeds the hypothesis budget");
  }
  for (const hypothesis of result.hypotheses) validateHypothesis(hypothesis);
  for (const action of result.recommendedActions) validateAction(action);
  if (result.decision === "STOP") {
    if (result.hypotheses.length > 0 || result.recommendedActions.length > 0) {
      throw new Error("STOP reflection result cannot recommend further work");
    }
  } else if (result.budgetUsed.depth < 1) {
    throw new Error("non-STOP reflection must consume at least one depth unit");
  } else if (result.hypotheses.length === 0) {
    throw new Error("non-STOP reflection result requires a hypothesis");
  }
}

function result(
  residualId: string,
  decision: ReflectionDecision,
  reasons: string[],
  hypotheses: ReflectionHypothesis[],
  recommendedActions: ReflectionAction[],
  budget: ReflectionBudget,
  budgetUsed: ReflectionBudgetUsage,
  evidenceDelta: ReflectionEvidenceDelta,
): ReflectionResult {
  const output: ReflectionResult = {
    residualId,
    decision,
    reasons: [...reasons],
    hypotheses: hypotheses.map(copyHypothesis),
    recommendedActions: recommendedActions.map(copyAction),
    budget: { ...budget },
    budgetUsed: { ...budgetUsed },
    evidenceDelta: copyEvidenceDelta(evidenceDelta),
  };
  validateReflectionResult(output);
  return output;
}

function validateResidual(residual: Residual): void {
  if (residual.id.length < 1) throw new Error("residual id is required");
  if (residual.evidence.length < 1) {
    throw new Error("reflection requires residual evidence");
  }
  if (
    !Number.isFinite(residual.confidence) ||
    residual.confidence < 0 ||
    residual.confidence > 1
  ) {
    throw new Error("residual confidence must be between 0 and 1");
  }
  validateEvidence(residual.evidence, "residual");
}

function validateBudget(budget: ReflectionBudget): ReflectionBudget {
  for (const name of [
    "maxDepth",
    "maxHypotheses",
    "maxToolCalls",
    "maxElapsedMs",
  ] as const) {
    const value = budget[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
  return { ...budget };
}

function validateUsage(
  usage: Partial<ReflectionBudgetUsage> | ReflectionBudgetUsage,
  budget: ReflectionBudget,
): ReflectionBudgetUsage {
  const normalized: ReflectionBudgetUsage = {
    depth: usage.depth ?? 0,
    hypotheses: usage.hypotheses ?? 0,
    toolCalls: usage.toolCalls ?? 0,
    elapsedMs: usage.elapsedMs ?? 0,
  };
  const limits: Record<keyof ReflectionBudgetUsage, number> = {
    depth: budget.maxDepth,
    hypotheses: budget.maxHypotheses,
    toolCalls: budget.maxToolCalls,
    elapsedMs: budget.maxElapsedMs,
  };
  for (const [name, value] of Object.entries(normalized) as [
    keyof ReflectionBudgetUsage,
    number,
  ][]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} usage must be a non-negative safe integer`);
    }
    if (value > limits[name]) {
      throw new Error(`${name} usage exceeds its reflection budget`);
    }
  }
  return normalized;
}

function validateEvidenceDelta(
  delta: ReflectionEvidenceDelta,
): ReflectionEvidenceDelta {
  assertNonNegativeSafeInteger(delta.fromSeq, "reflection evidence fromSeq");
  assertNonNegativeSafeInteger(delta.toSeq, "reflection evidence toSeq");
  if (delta.toSeq < delta.fromSeq) {
    throw new Error("reflection evidence toSeq cannot precede fromSeq");
  }
  validateEvidence(
    delta.evidence,
    "reflection evidence delta",
    delta.toSeq === delta.fromSeq,
  );
  if (delta.toSeq === delta.fromSeq && delta.evidence.length > 0) {
    throw new Error("reflection evidence without a sequence delta is invalid");
  }
  if (delta.toSeq > delta.fromSeq && delta.evidence.length === 0) {
    throw new Error("reflection evidence delta requires evidence");
  }
  return copyEvidenceDelta(delta);
}

function hasNewEvidence(delta: ReflectionEvidenceDelta): boolean {
  return delta.toSeq > delta.fromSeq && delta.evidence.length > 0;
}

function validateHypothesis(hypothesis: ReflectionHypothesis): void {
  if (hypothesis.id.length < 1 || hypothesis.statement.length < 1) {
    throw new Error("reflection hypothesis id and statement are required");
  }
  if (hypothesis.testability.length < 1) {
    throw new Error("reflection hypothesis testability is required");
  }
  if (
    !Number.isFinite(hypothesis.estimatedCost) ||
    hypothesis.estimatedCost < 0
  ) {
    throw new Error("reflection hypothesis estimatedCost is invalid");
  }
  validateEvidence(hypothesis.support, "reflection hypothesis support");
  validateEvidence(
    hypothesis.counterevidence,
    "reflection hypothesis counterevidence",
    true,
  );
}

function validateAction(action: ReflectionAction): void {
  if (action.id.length < 1) throw new Error("reflection action id is required");
  const permissionByKind: Record<ReflectionActionKind, ReflectionPermission> = {
    "collect-evidence": "none",
    "verify-external": "external-verifier",
    "request-human-confirmation": "human-confirmation",
  };
  if (
    !isActionKind(action.kind) ||
    permissionByKind[action.kind] !== action.requiredPermission
  ) {
    throw new Error("reflection action permission does not match its kind");
  }
  stableStringify(action.parameters);
}

function validateEvidence(
  evidence: EvidenceRef[],
  label: string,
  allowEmpty = false,
): void {
  if (!allowEmpty && evidence.length < 1) {
    throw new Error(`${label} requires evidence`);
  }
  for (const item of evidence) {
    if (
      item.eventId === undefined &&
      item.assetId === undefined &&
      item.artifactHash === undefined
    ) {
      throw new Error(
        `${label} evidence must identify an event, asset, or artifact`,
      );
    }
    if (!isEvidenceOrigin(item.origin)) {
      throw new Error(`${label} evidence origin is invalid`);
    }
  }
}

function escalationReasonsFor(residual: Residual): string[] {
  const reasons: string[] = [];
  if (residual.effect === "harmful") {
    reasons.push(
      "harmful effect requires an explicit human or verifier judgment",
    );
  }
  if (
    residual.field.consequence === "high" &&
    residual.field.reversibility === "hard"
  ) {
    reasons.push(
      "high-consequence and hard-to-reverse work requires human control",
    );
  }
  if (residual.field.externalVerification === "weak") {
    reasons.push("external verification is weak for this field");
  }
  if (
    residual.kind === "representation" ||
    residual.kind === "relation" ||
    residual.kind === "retrospective"
  ) {
    reasons.push(
      `${residual.kind} residuals are not automatically adjudicated`,
    );
  }
  return reasons;
}

function createHypothesis(residual: Residual): ReflectionHypothesis {
  const language = hypothesisLanguage(residual.kind);
  return {
    id: `hypothesis:${encodeURIComponent(residual.id)}:1`,
    statement: language.statement,
    support: residual.evidence.map(copyEvidenceRef),
    counterevidence: [],
    testability: language.testability,
    estimatedCost: 1,
  };
}

function hypothesisLanguage(kind: ResidualKind): {
  statement: string;
  testability: string;
} {
  switch (kind) {
    case "outcome":
      return {
        statement:
          "The observed outcome diverges from the declared expectation; the expectation and outcome evidence require comparison.",
        testability:
          "Compare the linked expectation, observation, and any explicit verification result.",
      };
    case "timing":
      return {
        statement:
          "The agent cursor is behind the relevant ledger state beyond the declared sequence and staleness thresholds.",
        testability:
          "Replay the relevant sequence and confirm subscription scope, cursor position, and timestamps.",
      };
    case "rule":
      return {
        statement:
          "A declared event requirement or checkpoint is missing from the requested trace.",
        testability:
          "Inspect the trace for the declared event types and checkpoint payloads.",
      };
    case "representation":
      return {
        statement:
          "A representation discrepancy was supplied for review but is not automatically adjudicated.",
        testability:
          "Ask a human or an explicitly configured verifier to compare the source and representation.",
      };
    case "relation":
      return {
        statement:
          "A relation discrepancy was supplied for review but is not automatically adjudicated.",
        testability:
          "Inspect the linked events and obtain an explicit human or verifier judgment.",
      };
    case "retrospective":
      return {
        statement:
          "A retrospective annotation was supplied for review and must remain distinct from direct history.",
        testability:
          "Compare the annotation with the original events and record the source of any judgment.",
      };
  }
}

function createHumanAction(
  residualId: string,
  reason: string,
): ReflectionAction {
  return {
    id: `reflection-action:human:${encodeURIComponent(residualId)}`,
    kind: "request-human-confirmation",
    requiredPermission: "human-confirmation",
    parameters: { residualId, reason },
  };
}

function createNextEvidenceAction(residual: Residual): ReflectionAction {
  const requiresExternalVerification =
    residual.kind === "outcome" &&
    residual.field.externalVerification !== "weak";
  return {
    id: `reflection-action:evidence:${encodeURIComponent(residual.id)}`,
    kind: requiresExternalVerification ? "verify-external" : "collect-evidence",
    requiredPermission: requiresExternalVerification
      ? "external-verifier"
      : "none",
    parameters: {
      residualId: residual.id,
      residualKind: residual.kind,
      subjectId: residual.observed.id,
    },
  };
}

function copyEvidenceRef(evidence: EvidenceRef): EvidenceRef {
  return { ...evidence };
}

function copyEvidenceDelta(
  delta: ReflectionEvidenceDelta,
): ReflectionEvidenceDelta {
  return {
    fromSeq: delta.fromSeq,
    toSeq: delta.toSeq,
    evidence: delta.evidence.map(copyEvidenceRef),
  };
}

function copyHypothesis(
  hypothesis: ReflectionHypothesis,
): ReflectionHypothesis {
  return {
    ...hypothesis,
    support: hypothesis.support.map(copyEvidenceRef),
    counterevidence: hypothesis.counterevidence.map(copyEvidenceRef),
  };
}

function copyAction(action: ReflectionAction): ReflectionAction {
  return { ...action, parameters: { ...action.parameters } };
}

function isDecision(value: string): value is ReflectionDecision {
  return value === "STOP" || value === "CONTINUE" || value === "ESCALATE";
}

function isActionKind(value: string): value is ReflectionActionKind {
  return (
    value === "collect-evidence" ||
    value === "verify-external" ||
    value === "request-human-confirmation"
  );
}

function isEvidenceOrigin(value: string): boolean {
  return (
    value === "direct" ||
    value === "declared" ||
    value === "inferred" ||
    value === "institutional"
  );
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}
