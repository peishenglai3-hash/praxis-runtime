import type { EvidenceRef, JsonObject } from "@praxis/contracts";
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
  newEvidenceAvailable: boolean;
  usage?: Partial<ReflectionBudgetUsage>;
}

export interface ReflectionResult {
  residualId: string;
  decision: ReflectionDecision;
  reasons: string[];
  hypotheses: ReflectionHypothesis[];
  recommendedActions: ReflectionAction[];
  budgetUsed: ReflectionBudgetUsage;
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
    const budgetUsed: ReflectionBudgetUsage = { ...current };
    const reasons: string[] = [];

    if (!input.newEvidenceAvailable) {
      reasons.push(
        "no new evidence or event is available; the same residual cannot self-call",
      );
      return result(input.residual.id, "STOP", reasons, [], [], budgetUsed);
    }

    if (current.depth >= budget.maxDepth) {
      reasons.push("maximum reflection depth has been reached");
      return result(input.residual.id, "STOP", reasons, [], [], budgetUsed);
    }

    if (current.elapsedMs >= budget.maxElapsedMs) {
      reasons.push("maximum reflection elapsed-time budget has been reached");
      return result(input.residual.id, "STOP", reasons, [], [], budgetUsed);
    }

    const availableHypotheses = budget.maxHypotheses - current.hypotheses;
    if (availableHypotheses < 1) {
      reasons.push("maximum hypothesis budget has been reached");
      return result(input.residual.id, "STOP", reasons, [], [], budgetUsed);
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
        budgetUsed,
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
      budgetUsed,
    );
  }
}

function result(
  residualId: string,
  decision: ReflectionDecision,
  reasons: string[],
  hypotheses: ReflectionHypothesis[],
  recommendedActions: ReflectionAction[],
  budgetUsed: ReflectionBudgetUsage,
): ReflectionResult {
  return {
    residualId,
    decision,
    reasons: [...reasons],
    hypotheses: hypotheses.map(copyHypothesis),
    recommendedActions: recommendedActions.map(copyAction),
    budgetUsed: { ...budgetUsed },
  };
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
}

function validateBudget(budget: ReflectionBudget): ReflectionBudget {
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
  return { ...budget };
}

function validateUsage(
  usage: Partial<ReflectionBudgetUsage>,
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

function createHypothesis(residual: Residual): ReflectionHypothesis {
  const language = hypothesisLanguage(residual.kind);
  return {
    id: `hypothesis:${encodeURIComponent(residual.id)}:1`,
    statement: language.statement,
    support: residual.evidence.map(copyEvidence),
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

function copyEvidence(evidence: EvidenceRef): EvidenceRef {
  return { ...evidence };
}

function copyHypothesis(
  hypothesis: ReflectionHypothesis,
): ReflectionHypothesis {
  return {
    ...hypothesis,
    support: hypothesis.support.map(copyEvidence),
    counterevidence: hypothesis.counterevidence.map(copyEvidence),
  };
}

function copyAction(action: ReflectionAction): ReflectionAction {
  return { ...action, parameters: { ...action.parameters } };
}
