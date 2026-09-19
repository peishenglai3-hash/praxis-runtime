import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  adapterErrorKinds,
  asAdapterError,
  AdapterError,
  serialiseAdapterError,
} from "../../packages/contracts/src/index.js";
import {
  createAdapterObservation,
  type AdapterObservation,
} from "../../packages/adapters/src/index.js";

/**
 * Provider neutrality has two boundaries, and the owner's Phase 6 finalization
 * brief requires an enforcement point at each. They fail in different places,
 * so one test cannot hold both:
 *
 *   - the **execution / error boundary**, where a provider's exception type,
 *     response shape and vocabulary must not become the runtime's own error
 *     semantics;
 *   - the **observability boundary**, where a provider's telemetry field names
 *     must not enter the core trace record.
 *
 * Phase 6B's rule was written once, as a single sentence covering both, and a
 * rule stated once tends to get enforced once. The conformance suite scans
 * `packages/adapters` for vendor names; neither package that defines the *core*
 * vocabulary was covered. This file is the missing enforcement, and it is
 * deliberately about this repository's own contracts rather than about
 * anything observed elsewhere: another project leaking vendor fields after a
 * year is a reason to test, not evidence that this design is right.
 */

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

const context = {
  adapterId: "validation-adapter",
  operationId: "op-0001",
  traceId: "trace-0001",
};

/** A provider SDK's own error: its own class, its own fields, its own words. */
class ProviderRateLimitError extends Error {
  readonly status = 429;
  readonly type = "rate_limit_exceeded";
  readonly vendorRequestId = "req_abc123";

  constructor() {
    super("Rate limit reached for gpt-4 in organization org-abc123");
    this.name = "ProviderRateLimitError";
  }
}

const providerVocabulary = [
  "gpt-4",
  "openai",
  "rate_limit_exceeded",
  "org-abc123",
  "req_abc123",
  "providerratelimiterror",
];

describe("execution / error boundary", () => {
  it("demotes a provider's own exception into the taxonomy", () => {
    // The runtime does not learn a new error kind from a provider. A foreign
    // exception is not trusted to have been classified, so it becomes the one
    // kind that permits nothing — and the taxonomy stays the vocabulary.
    const error = asAdapterError(new ProviderRateLimitError(), context);

    expect(error.kind).toBe("unknown_external_failure");
    expect(adapterErrorKinds).toContain(error.kind);
    expect(adapterErrorKinds).toHaveLength(12);
  });

  it("serialises none of the provider's own vocabulary", () => {
    const document = serialiseAdapterError(
      asAdapterError(new ProviderRateLimitError(), context),
    );
    const text = JSON.stringify(document).toLowerCase();

    for (const fragment of providerVocabulary) {
      expect(text, `${fragment} must not survive serialisation`).not.toContain(
        fragment,
      );
    }
  });

  it("cannot be made to carry provider wording even by its own adapter", () => {
    // The stronger form of the test above, and the one that explains it: the
    // document's `summary` is taken from the taxonomy, not from the error's
    // message, and the message is never serialised at all. So an adapter that
    // passes a provider's sentence straight through as its own message still
    // cannot get it into the record. This assertion was written expecting to
    // fail; it is the reason the one above is not merely a property of the
    // happy path.
    const leaky = new AdapterError({
      kind: "unknown_external_failure",
      ...context,
      message: "Rate limit reached for gpt-4 in organization org-abc123",
    });

    const text = JSON.stringify(serialiseAdapterError(leaky)).toLowerCase();
    for (const fragment of providerVocabulary) {
      expect(text, `${fragment} must not survive serialisation`).not.toContain(
        fragment,
      );
    }
    // The message still exists in-process, which is where diagnosis happens.
    expect(leaky.message).toContain("gpt-4");
  });

  it("keeps `diagnostic` an open bag, scoped and sanitised rather than typed", () => {
    // Stated because the boundary is narrower here than it looks: a provider's
    // key *is* allowed inside `diagnostic`, because the adapter declares it
    // rather than the runtime adopting it. What is withheld is a credential,
    // and what is fixed is the *core* field set — not the contents of the bag.
    const document = serialiseAdapterError(
      new AdapterError({
        kind: "unknown_external_failure",
        ...context,
        diagnostic: {
          vendorRequestId: "req_abc123",
          headers: {
            authorization: [
              "Bearer",
              ["sk", "abcdefghijklmnopqrstuvwxyz01"].join("-"),
            ].join(" "),
          },
        },
      }),
    );

    expect(JSON.stringify(document)).toContain("req_abc123");
    expect(JSON.stringify(document)).not.toContain("sk-abcdefghij");
    expect(document.redactedPaths?.length).toBeGreaterThan(0);
  });

  it("keeps the original exception, and keeps it out of the document", () => {
    // `cause` is the one place a raw provider object is allowed to live, and
    // it lives in-process only. The document is what gets written down.
    const cause = new ProviderRateLimitError();
    const error = asAdapterError(cause, context);

    expect(error.originalCause()).toBe(cause);
    expect(JSON.stringify(serialiseAdapterError(error))).not.toContain("gpt-4");
  });

  it("has a fixed document key set, so a provider field cannot be added quietly", () => {
    // A allow-list rather than a deny-list: a new provider-shaped field in the
    // document fails this test whether or not anyone thought to name it here.
    const document = serialiseAdapterError(
      asAdapterError(new ProviderRateLimitError(), context),
    );

    expect(Object.keys(document).sort()).toEqual([
      "adapterId",
      "diagnostic",
      "errorKind",
      "operationId",
      "retryable",
      "schemaVersion",
      "summary",
      "traceId",
    ]);
  });

  it("cannot have its retryability widened by an adapter", () => {
    // Narrowing is an adapter's judgement; widening is how a blind retry loop
    // over an irreversible side effect starts.
    const widened = new AdapterError({
      kind: "permanent_provider_failure",
      ...context,
      retryable: true,
    });
    expect(widened.retryable).toBe(false);
  });

  it("names no provider in the core error vocabulary", () => {
    // The conformance suite already scans `packages/adapters`. The rule is
    // about *core* semantics, and the packages that define them were not
    // covered — which is exactly where a vendor name would do the most damage.
    const forbidden = ["openai", "anthropic", "gemini", "deepseek", "claude"];
    const roots = ["packages/contracts/src", "packages/runtime/src"];
    for (const root of roots) {
      const directory = resolve(repositoryRoot, root);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
        const text = readFileSync(
          resolve(directory, entry.name),
          "utf8",
        ).toLowerCase();
        for (const name of forbidden) {
          expect(
            text.includes(name),
            `${root}/${entry.name} must not name ${name}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("observability boundary", () => {
  function observe(
    extra: Partial<Parameters<typeof createAdapterObservation>[0]> = {},
  ): AdapterObservation {
    return createAdapterObservation({
      operation: "model.generate",
      adapterId: "validation-adapter",
      provider: "declared-label",
      target: "declared-model",
      operationId: "op-0001",
      traceId: "trace-0001",
      startedAt: "2026-09-17T00:00:00.000Z",
      finishedAt: "2026-09-17T00:00:00.120Z",
      status: "ok",
      capabilityMode: {},
      counterfactual: false,
      ...extra,
    });
  }

  it("has a fixed core field set, none of it vendor-shaped", () => {
    expect(Object.keys(observe()).sort()).toEqual([
      "adapterId",
      "capabilityMode",
      "counterfactual",
      "durationMs",
      "operation",
      "operationId",
      "provider",
      "startedAt",
      "status",
      "target",
      "traceId",
    ]);
  });

  it("scopes provider-specific fields to the metadata bag", () => {
    // The bag is the only door. A vendor-named field at the top level is the
    // failure this boundary exists to prevent, so the assertion is on the top
    // level specifically — the value is allowed to exist, just not there.
    const observation = observe({
      providerMetadata: { openaiLatencyMs: 120, claudeLatencyMs: 80 },
    });

    expect(Object.keys(observation)).not.toContain("openaiLatencyMs");
    expect(Object.keys(observation)).not.toContain("claudeLatencyMs");
    expect(observation.providerMetadata).toEqual({
      openaiLatencyMs: 120,
      claudeLatencyMs: 80,
    });
  });

  it("does not adopt a provider's field as a core field", () => {
    // `provider` and `target` are the adapter's own opaque declarations. The
    // record must not grow a `gpt4Latency` just because a provider reports one.
    const text = JSON.stringify(
      observe({
        providerMetadata: { gpt4Latency: 5, gpt4Tokens: 10 },
      }),
    );

    const topLevel = JSON.stringify(observe());
    expect(topLevel).not.toContain("gpt4");
    expect(topLevel).not.toContain("openai");
    // ...while the scoped copy still carries them, so nothing is lost.
    expect(text).toContain("gpt4Latency");
  });

  it("withholds a credential in scoped metadata and records where", () => {
    const secret = [
      "Bearer",
      ["sk", "abcdefghijklmnopqrstuvwxyz012345"].join("-"),
    ].join(" ");
    const observation = observe({
      providerMetadata: { headers: { authorization: secret } },
    });

    expect(JSON.stringify(observation)).not.toContain(secret);
    expect(observation.redactedPaths).toBeDefined();
    expect(observation.redactedPaths?.length).toBeGreaterThan(0);
  });

  it("makes a foreign exception unrepresentable as an error kind", () => {
    // `errorKind` is the taxonomy or nothing. There is no field in which a
    // provider's own error name can be recorded, which is what keeps a vendor
    // vocabulary from arriving through the observability door instead of the
    // error one.
    const observation = observe();
    expect(Object.keys(observation)).not.toContain("errorName");
    expect(Object.keys(observation)).not.toContain("providerErrorType");
  });
});
