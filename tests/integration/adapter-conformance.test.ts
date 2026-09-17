import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AdapterError,
  type AdapterCapabilities,
  type AdapterExecutionContext,
  type ModelAdapter,
  type ModelRequest,
  type ToolAdapter,
  type ToolRequest,
} from "../../packages/contracts/src/index.js";
import {
  adapterConformanceCases,
  DummyModelAdapter,
  DummyToolAdapter,
  FaultyModelAdapter,
  FaultyToolAdapter,
  MalformedResponseModelAdapter,
  PartialCapabilityModelAdapter,
  PartialCapabilityToolAdapter,
  SlowModelAdapter,
  SlowToolAdapter,
  type ConformanceAssertions,
  type ConformanceSubject,
  type SubjectTiming,
} from "../../packages/adapters/src/index.js";

/**
 * Phase 6B conformance suite, run over every reference adapter.
 *
 * The suite itself lives in `packages/adapters` so a future provider adapter
 * author can run it without depending on this repository's test tooling. This
 * file is the Vitest-backed driver, plus the structural proofs (CT-10, CT-11)
 * that cannot be expressed as a call.
 */

const assertions: ConformanceAssertions = {
  equal(actual, expected, message) {
    expect(actual, message).toEqual(expected);
  },
  ok(value, message) {
    expect(value, message).toBeTruthy();
  },
  includes(haystack, needle, message) {
    expect(haystack, message).toContain(needle);
  },
  async rejectsWithKind(fn, kind, message) {
    let caught: unknown;
    try {
      await fn();
    } catch (error) {
      caught = error;
    }
    expect(caught, `${message}: expected a rejection`).toBeInstanceOf(
      AdapterError,
    );
    expect((caught as AdapterError).kind, message).toBe(kind);
    return caught as AdapterError;
  },
  async rejectsWithMessage(fn, text, message) {
    let caught: unknown;
    try {
      await fn();
    } catch (error) {
      caught = error;
    }
    expect(caught, `${message}: expected a rejection`).toBeInstanceOf(Error);
    expect((caught as Error).message, message).toContain(text);
    return caught;
  },
};

const actor = { type: "system" as const, id: "conformance" };
const writer = {
  writerId: "conformance:writer",
  kind: "runtime" as const,
  role: "ADAPTER" as const,
};

function contextFor(
  overrides?: Partial<AdapterExecutionContext>,
): AdapterExecutionContext {
  return {
    operationId: overrides?.operationId ?? "conformance-operation",
    traceId: overrides?.traceId ?? "conformance-trace",
    timeoutMs: overrides?.timeoutMs ?? 5_000,
    actor: overrides?.actor ?? actor,
    writer: overrides?.writer ?? writer,
    ...(overrides?.signal === undefined ? {} : { signal: overrides.signal }),
  };
}

function modelRequest(overrides: Record<string, unknown> = {}): ModelRequest {
  return {
    messages: [{ role: "user", content: "conformance prompt" }],
    ...overrides,
  } as ModelRequest;
}

function toolRequest(overrides: Record<string, unknown> = {}): ToolRequest {
  return {
    tool: "conformance-tool",
    input: { argument: "value" },
    sideEffect: "none",
    idempotencyKey: "conformance-idempotency-key",
    ...overrides,
  } as ToolRequest;
}

interface SubjectSpec {
  name: string;
  kind: "model" | "tool";
  build(timing?: SubjectTiming): ModelAdapter | ToolAdapter;
  /**
   * An instance that fails on purpose. Kept separate from `build` so that the
   * ordinary cases exercise the same adapter class without the injection —
   * otherwise CT-01 would be testing the fault rather than the adapter.
   */
  faulted?(): ModelAdapter | ToolAdapter;
  capabilities: AdapterCapabilities;
  intentionallyNonConforming?: boolean;
}

const dummyCapabilities: AdapterCapabilities =
  new DummyModelAdapter().capabilities();
const partialCapabilities: AdapterCapabilities =
  new PartialCapabilityModelAdapter().capabilities();

const specs: SubjectSpec[] = [
  {
    name: "dummy-model",
    kind: "model",
    build: (timing) =>
      new DummyModelAdapter("dummy-model", { delayMs: timing?.delayMs ?? 0 }),
    capabilities: dummyCapabilities,
  },
  {
    name: "dummy-tool",
    kind: "tool",
    build: (timing) =>
      new DummyToolAdapter("dummy-tool", { delayMs: timing?.delayMs ?? 0 }),
    capabilities: new DummyToolAdapter().capabilities(),
  },
  {
    name: "slow-model",
    kind: "model",
    build: (timing) =>
      new SlowModelAdapter("slow-model", {
        delayMs: timing?.delayMs ?? 5,
        sendsBeforeDelay: timing?.sendsBeforeDelay ?? false,
      }),
    capabilities: new SlowModelAdapter("slow-model", {
      delayMs: 5,
    }).capabilities(),
  },
  {
    name: "slow-tool",
    kind: "tool",
    build: (timing) =>
      new SlowToolAdapter("slow-tool", {
        delayMs: timing?.delayMs ?? 5,
        sendsBeforeDelay: timing?.sendsBeforeDelay ?? false,
      }),
    capabilities: new SlowToolAdapter("slow-tool", {
      delayMs: 5,
    }).capabilities(),
  },
  {
    name: "faulty-model",
    kind: "model",
    build: (timing) =>
      new FaultyModelAdapter("faulty-model", {
        delayMs: timing?.delayMs ?? 0,
      }),
    faulted: () =>
      new FaultyModelAdapter("faulty-model", {
        fault: { kind: "permanent_provider_failure", attempt: 1 },
      }),
    capabilities: new FaultyModelAdapter("faulty-model").capabilities(),
  },
  {
    name: "faulty-tool",
    kind: "tool",
    build: (timing) =>
      new FaultyToolAdapter("faulty-tool", {
        delayMs: timing?.delayMs ?? 0,
      }),
    faulted: () =>
      new FaultyToolAdapter("faulty-tool", {
        fault: { kind: "rate_limit", attempt: 1 },
      }),
    capabilities: new FaultyToolAdapter("faulty-tool").capabilities(),
  },
  {
    name: "malformed-model",
    kind: "model",
    build: (timing) =>
      new MalformedResponseModelAdapter("malformed-model", {
        delayMs: timing?.delayMs ?? 0,
      }),
    capabilities: new MalformedResponseModelAdapter().capabilities(),
    // It exists to prove the translation path, not to be substituted for
    // anything. Cases that require a conforming adapter say so.
    intentionallyNonConforming: true,
  },
  {
    name: "partial-model",
    kind: "model",
    build: (timing) =>
      new PartialCapabilityModelAdapter("partial-model", {
        delayMs: timing?.delayMs ?? 0,
      }),
    capabilities: partialCapabilities,
  },
  {
    name: "partial-tool",
    kind: "tool",
    build: (timing) =>
      new PartialCapabilityToolAdapter("partial-tool", {
        delayMs: timing?.delayMs ?? 0,
      }),
    capabilities: new PartialCapabilityToolAdapter().capabilities(),
  },
];

function subjectFor(spec: SubjectSpec): ConformanceSubject {
  const primary = spec.build();
  return {
    kind: spec.kind,
    id: () => spec.name,
    adapter: primary,
    make: (timing) => spec.build(timing),
    capabilities: spec.capabilities,
    makeRequest: (overrides) =>
      spec.kind === "model" ? modelRequest(overrides) : toolRequest(overrides),
    makeContext: (overrides) => contextFor(overrides),
    ...(spec.intentionallyNonConforming === true
      ? { intentionallyNonConforming: true }
      : {}),
    ...(spec.faulted === undefined ? {} : { faulted: spec.faulted }),
  };
}

describe.each(specs)("adapter conformance — $name", (spec) => {
  const subject = subjectFor(spec);
  for (const testCase of adapterConformanceCases) {
    if (testCase.appliesTo !== spec.kind) continue;
    const applicable = testCase.applies?.(subject) ?? true;
    const title = `${testCase.id} ${testCase.title}${applicable ? "" : " (not applicable)"}`;
    if (!applicable) {
      it.skip(title, () => undefined);
      continue;
    }
    it(title, async () => {
      await testCase.run(subject, assertions);
    });
  }
});

describe("the conformance suite is complete and provider-neutral", () => {
  it("covers CT-01 through CT-15", () => {
    const ids = adapterConformanceCases.map((testCase) => testCase.id).sort();
    expect(ids).toEqual([
      "CT-01",
      "CT-02",
      "CT-03",
      "CT-04",
      "CT-05",
      "CT-06",
      "CT-07",
      "CT-08",
      "CT-09",
      "CT-10",
      "CT-11",
      "CT-12",
      "CT-13",
      "CT-14",
      "CT-15",
    ]);
  });

  /**
   * Comments are stripped before scanning. The rule being checked is that the
   * shipped *code* never branches on a provider, and this repository's
   * comments legitimately quote Bible section 10.2 naming three of them. A
   * scanner that cannot tell a citation from a dependency would force the
   * citation out, which is the wrong trade.
   */
  // Built from strings rather than written as regex literals: a literal here
  // would need escaped slashes and a newline escape, and getting one of those
  // wrong silently changes what is stripped.
  const blockComment = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const lineComment = new RegExp("//[^\\n]*", "g");

  function stripComments(source: string): string {
    return source.replace(blockComment, "").replace(lineComment, "");
  }

  it("names no provider anywhere in the shipped adapter boundary", () => {
    // The rule is that a capability question is answered by the capability
    // declaration, never by a provider name. This is the mechanical half of
    // that rule; CT-03 is the observational half.
    const root = resolve(
      fileURLToPath(new URL("../../packages/adapters/src", import.meta.url)),
    );
    const forbidden = [
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
      "claude",
      "gpt-4",
      "llama",
    ];
    for (const file of [
      "index.ts",
      "dummy.ts",
      "faulty.ts",
      "negotiation.ts",
      "observability.ts",
      "timing.ts",
      "conformance.ts",
    ]) {
      const text = stripComments(
        readFileSync(resolve(root, file), "utf8"),
      ).toLowerCase();
      for (const name of forbidden) {
        // "claude" appears only in the repository's own attribution, never
        // here; a hit means a provider decision leaked into the boundary.
        expect(text.includes(name), `${file} must not name ${name}`).toBe(
          false,
        );
      }
    }
  });

  it("CT-10/CT-11 structural proof: the package cannot reach the store or the runtime", () => {
    // An adapter that cannot import the store cannot write to it, and one that
    // cannot import the runtime cannot promote through it. That is a stronger
    // statement than any runtime check, and it is the one the EPIC-010 gate
    // asks for.
    const manifest = JSON.parse(
      readFileSync(
        resolve(
          fileURLToPath(
            new URL("../../packages/adapters/package.json", import.meta.url),
          ),
        ),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(manifest.dependencies ?? {});
    expect(dependencies).toEqual(["@praxis/contracts"]);
    for (const forbidden of [
      "@praxis/store",
      "@praxis/runtime",
      "@praxis/state",
      "@praxis/assets",
      "@praxis/reflection",
      "@praxis/residual",
      "node:sqlite",
    ]) {
      expect(dependencies).not.toContain(forbidden);
    }
  });

  it("CT-13 retry policy refuses an unverified irreversible retry", async () => {
    // Stated here as well as in the suite because it is the one rule the
    // owner called out by name, and it should not be discoverable only by
    // reading a table of case ids.
    const adapter = new SlowToolAdapter("slow-tool", {
      delayMs: 60,
      sendsBeforeDelay: true,
    });
    let caught: unknown;
    try {
      await adapter.execute(
        toolRequest({ sideEffect: "irreversible" }),
        contextFor({ timeoutMs: 5 }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdapterError);
    expect((caught as AdapterError).kind).toBe("side_effect_uncertainty");
    expect((caught as AdapterError).retryable).toBe(false);
  });
});
