import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  AdapterError,
  isAdapterError,
  serialiseAdapterError,
  type AdapterErrorKind,
  type AdapterExecutionContext,
} from "../../packages/contracts/src/index.js";
import { negotiateCapabilities } from "../../packages/adapters/src/index.js";
import { ValidationProviderAdapter } from "./validation-provider-adapter.js";

/**
 * 6V-0 — adapter reality.
 *
 * One question: when a real provider fails, does the failure land in the twelve
 * kinds of the Phase 6B taxonomy, or does something arrive that none of them
 * describes? A kind chosen because it was the closest fit is a finding, not a
 * pass.
 *
 * ## Why this is a gated test rather than a script
 *
 * It needs a live credential, so it must never run inside a gate. It is skipped
 * unless `PRAXIS_VALIDATION_PROVIDER_KEY` is set, and no suite script points at
 * `tests/validation`, so `pnpm verify` cannot reach it even by accident. It
 * lives here rather than in `scripts/` because the adapter it drives is
 * TypeScript and has to be typechecked against the real contracts.
 *
 * ## Expectations are frozen before the call
 *
 * Every scenario below states what it expects in a table written before the
 * request is made, and the runner asserts against that, not against whatever
 * came back. A record whose expectation was written after its outcome is not
 * prospective evidence. Runs whose failure is injected are labelled
 * `corpus-c` — synthetic adversarial — and never `corpus-p`, because an
 * injected 429 is evidence about this adapter and not about the provider.
 */

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const resultsDirectory = resolve(repositoryRoot, "test-results", "6v0");

const apiKey = process.env["PRAXIS_VALIDATION_PROVIDER_KEY"] ?? "";
const model =
  process.env["PRAXIS_VALIDATION_PROVIDER_MODEL"] ?? "deepseek-chat";
const providerLabel = process.env["PRAXIS_VALIDATION_PROVIDER"] ?? "deepseek";

const describeWithKey = apiKey.length === 0 ? describe.skip : describe;

if (apiKey.length === 0) {
  // Say so out loud. A silently skipped validation run is indistinguishable
  // from one that passed, which is the failure this whole phase is about.
  console.warn(
    "[6V-0] skipped: PRAXIS_VALIDATION_PROVIDER_KEY is not set. " +
      "6V-0 has NOT been observed. This is not a pass.",
  );
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  return (result.stdout ?? "").trim();
}

const runtimeCommit = git(["rev-parse", "HEAD"]);
const runtimeDirty = git(["status", "--porcelain"]) !== "";

const executionContext = (
  operationId: string,
  overrides: Partial<AdapterExecutionContext> = {},
): AdapterExecutionContext => ({
  operationId,
  traceId: `trace-${operationId}`,
  timeoutMs: 30_000,
  actor: { type: "human", id: "owner" },
  writer: { writerId: "6v0-validation", kind: "agent", role: "VERIFIER" },
  ...overrides,
});

interface Scenario {
  runId: string;
  scenarioId: string;
  corpusType: "corpus-p" | "corpus-c";
  /** Written before the call. The runner asserts this, not the outcome. */
  expectKind: AdapterErrorKind | "none";
  /** What the record should say the verifier was. */
  verifierKind: "external-api" | "filesystem";
  run: () => Promise<{ detail?: Record<string, unknown> }>;
}

const summaries: Record<string, unknown>[] = [];

function record(
  scenario: Scenario,
  outcome: {
    status: "success" | "failure";
    kind: AdapterErrorKind | "none";
    detail?: Record<string, unknown>;
    durationMs: number;
  },
): void {
  const manifest = {
    schemaVersion: "1",
    runId: scenario.runId,
    scenarioId: scenario.scenarioId,
    corpusType: scenario.corpusType,
    ladder: "6V-0",
    concurrency: "C0",
    runtimeCommit,
    runtimeDirty,
    subject: {
      kind: "model",
      provider: providerLabel,
      model,
      adapterId: `validation:${providerLabel}`,
      counterfactual: false,
    },
    field: {
      taskType: "adapter-boundary-validation",
      externalVerification: "strong",
      consequence: "low",
      reversibility: "easy",
      feedbackLatency: "short",
      actors: [{ type: "human", id: "owner" }],
      socialPlurality: "single-actor",
      placementRationale:
        "6V-0 exercises the adapter boundary only: no assets, no residuals, " +
        "no reflection. Consequence is low because nothing is written to a " +
        "ledger and no external effect is attempted.",
    },
    expectation: {
      // The frozen date is the date the expectation was written, which is
      // this file's authoring date and not the run's.
      frozenAt: "2026-09-17T00:00:00.000Z",
      registered: [],
      expectedOutcome: `classify as ${scenario.expectKind}`,
    },
    verifier: {
      kind: scenario.verifierKind,
      reference: "the provider's own HTTP response",
      // The provider did not author the adapter, and the adapter did not
      // author the provider. Neither is the other's judge.
      independent: true,
    },
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    finalOutcome: {
      status: outcome.status,
      verifiedBy: scenario.verifierKind,
      evidence: `observed kind: ${outcome.kind}`,
    },
    // The node runtime is recorded here rather than as a top-level field
    // because the schema is `additionalProperties: false` and does not declare
    // one. Writing it anyway made all nine records invalid on the first run,
    // which is how the gap was found; the schema's own omission is recorded in
    // the results document rather than patched around here.
    notes: JSON.stringify({
      node: process.versions.node,
      pinned: "22.13.0",
      ...(outcome.detail ?? {}),
    }),
    counts: { calls: 1 },
  };
  mkdirSync(resultsDirectory, { recursive: true });
  writeFileSync(
    resolve(resultsDirectory, `${scenario.runId}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  summaries.push({
    runId: scenario.runId,
    corpus: scenario.corpusType,
    expected: scenario.expectKind,
    observed: outcome.kind,
    match: scenario.expectKind === outcome.kind,
    ms: outcome.durationMs,
  });
}

/** Run a scenario, classify whatever happens, and record it. */
async function observe(
  scenario: Scenario,
): Promise<AdapterErrorKind | "none" | "unconverted"> {
  const startedAt = Date.now();
  try {
    const result = await scenario.run();
    record(scenario, {
      status: "success",
      kind: "none",
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      durationMs: Date.now() - startedAt,
    });
    return "none";
  } catch (error) {
    // Everything goes through the boundary's own conversion first, so what is
    // classified is what the boundary would classify — not what this runner
    // would have guessed. An error that reaches here without having been
    // converted is its own finding, and is named rather than coerced into a
    // taxonomy member it is not.
    const kind: AdapterErrorKind | "unconverted" = isAdapterError(error)
      ? error.kind
      : "unconverted";
    record(scenario, {
      status: "failure",
      kind: kind === "unconverted" ? "unknown_external_failure" : kind,
      detail: isAdapterError(error)
        ? {
            document: serialiseAdapterError(error),
            // Kept so the report can say whether the provider's own words
            // survived anywhere near the record. It is in-process only.
            providerWordsKeptInProcessOnly: String(error.originalCause()).slice(
              0,
              120,
            ),
          }
        : { unconvertedForeignError: String(error).slice(0, 200) },
      durationMs: Date.now() - startedAt,
    });
    return kind;
  }
}

afterAll(() => {
  if (summaries.length === 0) return;
  mkdirSync(resultsDirectory, { recursive: true });
  writeFileSync(
    resolve(resultsDirectory, "summary.json"),
    `${JSON.stringify(
      { runtimeCommit, runtimeDirty, node: process.versions.node, summaries },
      null,
      2,
    )}\n`,
    "utf8",
  );
});

describeWithKey("6V-0 — a real provider through the Phase 6B boundary", () => {
  const live = () =>
    new ValidationProviderAdapter({ apiKey, provider: providerLabel, model });

  it("6V0-01 normal success", async () => {
    const scenario: Scenario = {
      runId: "6V0-01",
      scenarioId: "adapter-success",
      corpusType: "corpus-p",
      expectKind: "none",
      verifierKind: "external-api",
      run: async () => {
        const adapter = live();
        const result = await adapter.generate(
          {
            messages: [
              { role: "user", content: "Reply with the single word: ok" },
            ],
            maxOutputTokens: 8,
          },
          executionContext("6V0-01"),
        );
        // A live call must not be recorded as a counterfactual.
        expect(result.run.counterfactual).toBe(false);
        return {
          detail: { finishReason: result.finishReason, usage: result.usage },
        };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-02 timeout budget is honoured as a timeout, not a network fault", async () => {
    const scenario: Scenario = {
      runId: "6V0-02",
      scenarioId: "adapter-timeout",
      corpusType: "corpus-p",
      expectKind: "timeout",
      verifierKind: "external-api",
      run: async () => {
        const adapter = live();
        await adapter.generate(
          {
            messages: [
              { role: "user", content: "Reply with the single word: ok" },
            ],
          },
          executionContext("6V0-02", { timeoutMs: 1 }),
        );
        return { detail: {} };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-03 caller cancellation is not reported as a timeout", async () => {
    const scenario: Scenario = {
      runId: "6V0-03",
      scenarioId: "adapter-cancellation",
      corpusType: "corpus-p",
      expectKind: "cancellation",
      verifierKind: "external-api",
      run: async () => {
        const adapter = live();
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 60);
        await adapter.generate(
          { messages: [{ role: "user", content: "Count slowly to fifty." }] },
          executionContext("6V0-03", {
            signal: controller.signal,
            // Deliberately far longer than the caller's abort, so a
            // `timeout` result here would mean the two were collapsed.
            timeoutMs: 30_000,
          }),
        );
        return { detail: {} };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-04 an unsupported capability is refused fail-closed", async () => {
    const scenario: Scenario = {
      runId: "6V0-04",
      scenarioId: "unsupported-capability",
      corpusType: "corpus-c",
      expectKind: "unsupported_capability",
      verifierKind: "filesystem",
      run: async () => {
        const adapter = live();
        // The adapter declares `streaming: false`. Negotiation must refuse
        // rather than silently degrade, because a caller that asked for
        // streaming and got a whole answer has been lied to.
        negotiateCapabilities({
          adapterId: adapter.id,
          available: adapter.capabilities(),
          requires: { streaming: true },
          context: { operationId: "6V0-04", traceId: "trace-6V0-04" },
        });
        return { detail: {} };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-05 a real provider error is classified, not binned as unknown", async () => {
    const scenario: Scenario = {
      runId: "6V0-05",
      scenarioId: "provider-rejects-request",
      corpusType: "corpus-p",
      expectKind: "invalid_request",
      verifierKind: "external-api",
      run: async () => {
        const adapter = new ValidationProviderAdapter({
          apiKey,
          provider: providerLabel,
          // A model the provider does not serve. The provider decides how to
          // say no; the taxonomy has to have somewhere to put it.
          model: "praxis-nonexistent-model-0000",
        });
        await adapter.generate(
          { messages: [{ role: "user", content: "ok" }] },
          executionContext("6V0-05"),
        );
        return { detail: {} };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-06 a rejected credential is an authentication failure", async () => {
    const scenario: Scenario = {
      runId: "6V0-06",
      scenarioId: "provider-rejects-credential",
      corpusType: "corpus-c",
      expectKind: "authentication_failure",
      verifierKind: "external-api",
      run: async () => {
        const adapter = new ValidationProviderAdapter({
          apiKey: "invalid-key-for-validation-only",
          provider: providerLabel,
          model,
        });
        await adapter.generate(
          { messages: [{ role: "user", content: "ok" }] },
          executionContext("6V0-06"),
        );
        return { detail: {} };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-07 an injected rate limit is classified as rate_limit", async () => {
    // Injected, and labelled `corpus-c` for that reason. The provider offers no
    // way to ask for a 429 on demand, and a run that cannot be reproduced is
    // not prospective evidence about the provider.
    const scenario: Scenario = {
      runId: "6V0-07",
      scenarioId: "rate-limit-injected",
      corpusType: "corpus-c",
      expectKind: "rate_limit",
      verifierKind: "filesystem",
      run: async () => {
        const adapter = new ValidationProviderAdapter({
          apiKey,
          provider: providerLabel,
          model,
          fetchImpl: async () =>
            new Response('{"error":{"message":"Rate limit reached"}}', {
              status: 429,
            }),
        });
        await adapter.generate(
          { messages: [{ role: "user", content: "ok" }] },
          executionContext("6V0-07"),
        );
        return { detail: {} };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-08 an injected malformed body is classified as malformed, not as unknown", async () => {
    const scenario: Scenario = {
      runId: "6V0-08",
      scenarioId: "malformed-response-injected",
      corpusType: "corpus-c",
      expectKind: "malformed_provider_response",
      verifierKind: "filesystem",
      run: async () => {
        const adapter = new ValidationProviderAdapter({
          apiKey,
          provider: providerLabel,
          model,
          fetchImpl: async () =>
            new Response('{"choices":[{"message":{"content":', { status: 200 }),
        });
        await adapter.generate(
          { messages: [{ role: "user", content: "ok" }] },
          executionContext("6V0-08"),
        );
        return { detail: {} };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-09 a 200 with a missing field is malformed, not a silent empty answer", async () => {
    const scenario: Scenario = {
      runId: "6V0-09",
      scenarioId: "partial-response-injected",
      corpusType: "corpus-c",
      expectKind: "malformed_provider_response",
      verifierKind: "filesystem",
      run: async () => {
        const adapter = new ValidationProviderAdapter({
          apiKey,
          provider: providerLabel,
          model,
          fetchImpl: async () =>
            new Response('{"choices":[]}', { status: 200 }),
        });
        await adapter.generate(
          { messages: [{ role: "user", content: "ok" }] },
          executionContext("6V0-09"),
        );
        return { detail: {} };
      },
    };
    expect(await observe(scenario)).toBe(scenario.expectKind);
  });

  it("6V0-10 every record this run wrote satisfies the manifest schema", () => {
    // The first 6V-0 run wrote a `runtime` key the schema does not declare, and
    // `additionalProperties: false` made all nine records invalid. Nothing said
    // so — the tests were green and the JSON looked right. Checking the records
    // against the schema is the difference between "the run passed" and "the
    // run produced evidence", so it is an assertion now rather than a habit.
    const schema = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, "schemas/eval/run-manifest.v1.schema.json"),
        "utf8",
      ),
    ) as {
      required: string[];
      properties: Record<string, { enum?: unknown[]; required?: string[] }>;
    };

    const files = readdirSync(resultsDirectory).filter(
      (file) => file.endsWith(".json") && file !== "summary.json",
    );
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const document = JSON.parse(
        readFileSync(resolve(resultsDirectory, file), "utf8"),
      ) as Record<string, unknown>;

      for (const key of schema.required) {
        expect(Object.keys(document), `${file} is missing ${key}`).toContain(
          key,
        );
      }
      for (const key of Object.keys(document)) {
        expect(
          Object.keys(schema.properties),
          `${file} declares ${key}, which the schema does not`,
        ).toContain(key);
      }
      for (const [key, definition] of Object.entries(schema.properties)) {
        if (definition.enum !== undefined && document[key] !== undefined) {
          expect(definition.enum, `${file}: ${key}`).toContain(document[key]);
        }
      }
      for (const group of ["field", "subject", "expectation", "verifier"]) {
        const nested = document[group] as Record<string, unknown>;
        for (const key of schema.properties[group]?.required ?? []) {
          expect(
            Object.keys(nested),
            `${file}: ${group} is missing ${key}`,
          ).toContain(key);
        }
      }
    }
  });
});

describe("the classifier itself, without a network", () => {
  it("never returns a kind outside the twelve", async () => {
    const { classifyHttpStatus, classifyNetworkCode } =
      await import("./validation-provider-adapter.js");
    const { adapterErrorKinds } =
      await import("../../packages/contracts/src/index.js");
    for (let status = 100; status < 600; status += 1) {
      expect(adapterErrorKinds).toContain(classifyHttpStatus(status));
    }
    for (const code of [
      "ETIMEDOUT",
      "ABORT_ERR",
      "ECONNRESET",
      "ENOTFOUND",
      undefined,
      "SOMETHING_NEW",
    ]) {
      expect(adapterErrorKinds).toContain(classifyNetworkCode(code));
    }
  });

  it("leaves a foreign thrown value to the boundary rather than classifying it", async () => {
    // The one place the adapter's own mapping must not take over: an error it
    // did not construct is not its to interpret.
    const { asAdapterError } =
      await import("../../packages/contracts/src/index.js");
    const foreign = Object.assign(new Error("provider sdk said no"), {
      vendorCode: "X1",
    });
    const converted = asAdapterError(foreign, {
      adapterId: "validation:x",
      operationId: "op",
      traceId: "tr",
    });
    expect(converted).toBeInstanceOf(AdapterError);
    expect(converted.kind).toBe("unknown_external_failure");
    expect(JSON.stringify(serialiseAdapterError(converted))).not.toContain(
      "provider sdk said no",
    );
  });
});
