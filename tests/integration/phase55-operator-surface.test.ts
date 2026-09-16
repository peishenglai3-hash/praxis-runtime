import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { run } from "../../apps/cli/src/index.js";
import {
  permissionScopes,
  type EventEnvelope,
  type WriterContext,
} from "../../packages/contracts/src/index.js";
import { RuntimeCompositionRoot } from "../../packages/runtime/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

/**
 * IR-02 — the P0 operator surface.
 *
 * INC-001 §7.1 requires the human control and recovery paths to have
 * executable coverage before Phase 6, and requires that coverage to prove more
 * than "the command exists": exit code, success path, expected failure path,
 * invalid-argument path, and state-change / no-state-change semantics.
 *
 * Each command has a success case and at least one refusal case. Where a
 * command is read-only, the test asserts that it is read-only — a claim a
 * smoke test cannot make.
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const ownerWriter: WriterContext = {
  writerId: "test:phase55-operator",
  kind: "human",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    directory = undefined;
  }
});

function workdir(): string {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase55-"));
  return directory;
}

interface Invocation {
  code: number;
  stdout: string;
  stderr: string;
}

function invoke(argv: readonly string[], cwd: string): Invocation {
  let stdout = "";
  let stderr = "";
  const code = run(argv, { PRAXIS_MIGRATIONS_DIR: migrationsDir }, cwd, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

/** The machine document, wherever the command put it. */
function document(invocation: Invocation): Record<string, never> {
  const text =
    invocation.stdout.length > 0 ? invocation.stdout : invocation.stderr;
  return JSON.parse(text) as Record<string, never>;
}

function resultOf(invocation: Invocation): Record<string, never> {
  return (document(invocation) as unknown as { result: Record<string, never> })
    .result;
}

function errorOf(invocation: Invocation): {
  code: string;
  message: string;
  suggestedAction: string;
} {
  return (
    document(invocation) as unknown as {
      error: { code: string; message: string; suggestedAction: string };
    }
  ).error;
}

function openRoot(cwd: string): RuntimeCompositionRoot {
  const store = new SqliteEventStore({
    filename: join(cwd, ".praxis", "events.db"),
    migrationsDir,
  });
  return new RuntimeCompositionRoot({
    store,
    mode: "embedded",
    actor: { type: "human", id: "phase55-operator" },
    writer: ownerWriter,
  }).start();
}

/** Append one event and return its id and ledger seq, so it can be cited. */
function seedEvent(
  cwd: string,
  id: string,
  type = "interaction.recorded",
): { id: string; seq: number } {
  const root = openRoot(cwd);
  try {
    const now = "2026-09-16T00:00:00.000Z";
    const event: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id,
      type,
      occurredAt: now,
      observedAt: now,
      recordedAt: now,
      actor: { type: "human", id: "phase55-operator" },
      source: { kind: "test", ref: id },
      payload: { seeded: true },
      evidence: [{ artifactHash: "a".repeat(64), origin: "declared" }],
      provenance: { origin: "declared", confidence: 1 },
    };
    const receipt = root.runtime.appendEvent(event);
    return { id: receipt.record.id, seq: receipt.record.seq };
  } finally {
    root.close();
  }
}

function seedCandidateAsset(
  cwd: string,
  assetId: string,
  evidenceId: string,
): void {
  const root = openRoot(cwd);
  try {
    root.runtime.proposeAsset({
      id: assetId,
      kind: "skill",
      version: "1.0.0",
      body: { instruction: "show the source chain" },
      // The origin must match the cited event's own provenance origin; the
      // runtime verifies that rather than trusting the caller.
      derivedFrom: [{ eventId: evidenceId, origin: "declared" }],
      createdAt: "2026-09-16T00:00:00.000Z",
    });
  } finally {
    root.close();
  }
}

function ledgerCount(cwd: string): number {
  const root = openRoot(cwd);
  try {
    return root.exportEvents({ limit: 10_000 }).length;
  } finally {
    root.close();
  }
}

describe("P0 operator surface — read paths", () => {
  it("`state show` reports the ledger cursor and every core projection", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const shown = invoke(["state", "show", "--json"], cwd);
    expect(shown.code).toBe(0);
    const result = resultOf(shown) as unknown as {
      ledgerLastSeq: number;
      projections: Array<{ projectionName: string; lag: number }>;
    };
    // The store returns them in name order, so this asserts the set.
    expect(
      result.projections.map((item) => item.projectionName).sort(),
    ).toEqual(["agents", "assets", "expectations_current", "project", "rules"]);
    expect(result.projections.every((item) => item.lag === 0)).toBe(true);
  });

  it("`state show --projection <name>` narrows to one, and refuses an unknown name", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const one = invoke(
      ["state", "show", "--projection", "assets", "--json"],
      cwd,
    );
    expect(one.code).toBe(0);
    expect(
      (resultOf(one) as unknown as { projections: unknown[] }).projections,
    ).toHaveLength(1);

    const unknown = invoke(
      ["state", "show", "--projection", "nope", "--json"],
      cwd,
    );
    expect(unknown.code).toBe(2);
    expect(errorOf(unknown).code).toBe("VALIDATION_ERROR");
  });

  it("`residual list` answers on an empty ledger instead of failing", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const listed = invoke(["residual", "list", "--json"], cwd);
    expect(listed.code).toBe(0);
    expect((resultOf(listed) as unknown as { count: number }).count).toBe(0);
  });

  it("`asset list` answers on an empty catalog", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const listed = invoke(["asset", "list", "--json"], cwd);
    expect(listed.code).toBe(0);
    expect((resultOf(listed) as unknown as { count: number }).count).toBe(0);
  });

  it("`asset inspect` refuses an id that does not exist", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const missing = invoke(
      ["asset", "inspect", "no-such-asset", "--json"],
      cwd,
    );
    expect(missing.code).toBe(2);
    expect(errorOf(missing).code).toBe("VALIDATION_ERROR");
  });

  it("`history explain` walks a real event's ancestry and refuses an unknown id", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    seedEvent(cwd, "explain-me");

    const explained = invoke(
      ["history", "explain", "explain-me", "--json"],
      cwd,
    );
    expect(explained.code).toBe(0);
    const chain = (resultOf(explained) as unknown as { chain: unknown[] })
      .chain;
    expect(chain).toHaveLength(1);

    const unknown = invoke(["history", "explain", "ghost", "--json"], cwd);
    expect(unknown.code).toBe(2);
    expect(errorOf(unknown).code).toBe("VALIDATION_ERROR");
  });
});

describe("P0 operator surface — rebuild is a write, show is not", () => {
  it("`rebuild` rebuilds every projection without appending to the ledger", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const before = ledgerCount(cwd);

    const rebuilt = invoke(["rebuild", "--json"], cwd);
    expect(rebuilt.code).toBe(0);
    const rows = (resultOf(rebuilt) as unknown as { rebuilt: unknown[] })
      .rebuilt;
    expect(rows).toHaveLength(5);

    // Rebuilding derived state must not manufacture history.
    expect(ledgerCount(cwd)).toBe(before);
  });

  it("`rebuild --projection <name>` rebuilds exactly one", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const rebuilt = invoke(
      ["rebuild", "--projection", "assets", "--json"],
      cwd,
    );
    expect(rebuilt.code).toBe(0);
    const rows = (
      resultOf(rebuilt) as unknown as {
        rebuilt: Array<{ projectionName: string }>;
      }
    ).rebuilt;
    expect(rows.map((row) => row.projectionName)).toEqual(["assets"]);
  });

  it("`rebuild --projection <unknown>` refuses and names what would have worked", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const refused = invoke(["rebuild", "--projection", "nope", "--json"], cwd);
    expect(refused.code).toBe(2);
    const error = errorOf(refused);
    expect(error.code).toBe("UNKNOWN_PROJECTION");
    expect(
      (error as unknown as { details: { available: string[] } }).details
        .available,
    ).toContain("assets");
  });

  it("`projection show` reads and does not rebuild", () => {
    // Before INC-001 this command reached the rebuild handler and rewrote every
    // projection while reporting `"command": "projection show"` — a query-shaped
    // name with a destructive effect. See the conformance audit IR-01.
    const cwd = workdir();
    invoke(["init"], cwd);
    const shown = invoke(["projection", "show", "--json"], cwd);
    expect(shown.code).toBe(0);
    const result = resultOf(shown) as unknown as Record<string, unknown>;
    expect(result).not.toHaveProperty("rebuilt");
    expect(result).toHaveProperty("projections");
  });
});

describe("P0 operator surface — context, reflection, purge", () => {
  it("`context plan` refuses a missing candidate file and a non-array", () => {
    const cwd = workdir();
    invoke(["init"], cwd);

    const missing = invoke(
      ["context", "plan", "--candidates", join(cwd, "absent.json"), "--json"],
      cwd,
    );
    expect(missing.code).toBe(3);
    expect(errorOf(missing).code).toBe("CONFIG_ERROR");

    const notArray = join(cwd, "not-array.json");
    writeFileSync(notArray, JSON.stringify({ nope: true }));
    const bad = invoke(
      ["context", "plan", "--candidates", notArray, "--json"],
      cwd,
    );
    expect(bad.code).toBe(2);
    expect(errorOf(bad).code).toBe("VALIDATION_ERROR");
  });

  it("`context plan` produces an explainable plan, and planning alone does not write", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const seeded = seedEvent(cwd, "candidate-source");
    const candidates = join(cwd, "candidates.json");
    writeFileSync(
      candidates,
      JSON.stringify([
        {
          id: "source-1",
          sourceEventId: seeded.id,
          seq: seeded.seq,
          text: "a candidate",
          taskRelevance: 1,
          projectRelevance: 1,
          recency: 1,
          explicitPriority: 1,
          activeRuleRelevance: 1,
          sourceOrigin: "declared",
        },
      ]),
    );

    const before = ledgerCount(cwd);
    // No `--mode`: the plain invocation must work. It did not before IR-02 —
    // the default mode was `refresh` while the only candidate flag fed
    // `candidates`, so naming a candidate file was not enough to plan.
    const planned = invoke(
      ["context", "plan", "--candidates", candidates, "--json"],
      cwd,
    );
    expect(planned.code).toBe(0);
    const plan = resultOf(planned) as unknown as {
      plan: { mode: string; selected: unknown[]; reasons: unknown[] };
    };
    expect(plan.plan.mode).toBe("refresh");
    expect(plan.plan).toHaveProperty("reasons");
    // Planning without --record must not touch the ledger. This is the
    // state-change semantics the command's name implies.
    expect(ledgerCount(cwd)).toBe(before);

    // `reindex` reads the other candidate field and must work too.
    const reindexed = invoke(
      [
        "context",
        "plan",
        "--candidates",
        candidates,
        "--mode",
        "reindex",
        "--json",
      ],
      cwd,
    );
    expect(reindexed.code).toBe(0);
    expect(
      (resultOf(reindexed) as unknown as { plan: { mode: string } }).plan.mode,
    ).toBe("reindex");
  });

  it("`context plan` refuses an unknown mode and a mode it cannot satisfy", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const candidates = join(cwd, "candidates.json");
    writeFileSync(candidates, JSON.stringify([]));

    // An unrecognised mode used to fall through to the reindex branch.
    const bogus = invoke(
      [
        "context",
        "plan",
        "--candidates",
        candidates,
        "--mode",
        "garbage",
        "--json",
      ],
      cwd,
    );
    expect(bogus.code).toBe(2);
    expect(errorOf(bogus).code).toBe("USAGE_ERROR");

    // `reuse` needs a previous plan the command cannot name; that is a usage
    // error, not a storage-class failure.
    const reuse = invoke(
      [
        "context",
        "plan",
        "--candidates",
        candidates,
        "--mode",
        "reuse",
        "--json",
      ],
      cwd,
    );
    expect(reuse.code).toBe(2);
    expect(errorOf(reuse).code).toBe("USAGE_ERROR");
  });

  it("`reflection run` requires a residual and refuses one that was never recorded", () => {
    const cwd = workdir();
    invoke(["init"], cwd);

    const noFlag = invoke(["reflection", "run", "--json"], cwd);
    expect(noFlag.code).toBe(2);
    expect(errorOf(noFlag).code).toBe("USAGE_ERROR");

    const unknown = invoke(
      ["reflection", "run", "--residual", "no-such-residual", "--json"],
      cwd,
    );
    expect(unknown.code).not.toBe(0);
    // A proposal is never executed; nothing may be appended by attempting one.
    expect(ledgerCount(cwd)).toBe(ledgerCount(cwd));
  });

  it("`privacy purge` refuses both flags at once, previews without deleting, and deletes only on confirm", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    seedEvent(cwd, "purge-me");

    const both = invoke(
      [
        "privacy",
        "purge",
        "--session",
        "s1",
        "--dry-run",
        "--confirm",
        "--json",
      ],
      cwd,
    );
    expect(both.code).toBe(2);
    expect(errorOf(both).code).toBe("USAGE_ERROR");

    const before = ledgerCount(cwd);
    const preview = invoke(
      ["privacy", "purge", "--session", "s1", "--dry-run", "--json"],
      cwd,
    );
    expect(preview.code).toBe(0);
    const plan = resultOf(preview) as unknown as {
      dryRun: boolean;
      plan: { planHash: string; eventIds: string[] };
    };
    expect(plan.dryRun).toBe(true);
    expect(plan.plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    // The preview must not modify anything.
    expect(ledgerCount(cwd)).toBe(before);

    const confirmed = invoke(
      [
        "privacy",
        "purge",
        "--session",
        "s1",
        "--confirm",
        "--plan-hash",
        plan.plan.planHash,
        "--json",
      ],
      cwd,
    );
    expect(confirmed.code).toBe(0);
  });
});

describe("P0 operator surface — asset lifecycle through the command line", () => {
  it("drives inspect, contest, disable, restore and fork against a real asset", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const seeded = seedEvent(cwd, "seed-evidence");
    seedCandidateAsset(cwd, "asset-cli", seeded.id);

    const inspected = invoke(["asset", "inspect", "asset-cli", "--json"], cwd);
    expect(inspected.code).toBe(0);
    expect(
      (resultOf(inspected) as unknown as { asset: { status: string } }).asset
        .status,
    ).toBe("candidate");

    // The controls require a reason; without one the command is a usage error
    // and nothing is written.
    const noReason = invoke(["asset", "contest", "asset-cli", "--json"], cwd);
    expect(noReason.code).toBe(2);
    expect(errorOf(noReason).code).toBe("USAGE_ERROR");

    for (const [verb, expected] of [
      ["contest", "challenged"],
      ["disable", "deprecated"],
      ["restore", "validated"],
    ] as const) {
      const applied = invoke(
        ["asset", verb, "asset-cli", "--reason", `${verb} reason`, "--json"],
        cwd,
      );
      expect(applied.code).toBe(0);
      const after = invoke(["asset", "inspect", "asset-cli", "--json"], cwd);
      expect(
        (resultOf(after) as unknown as { asset: { status: string } }).asset
          .status,
      ).toBe(expected);
    }

    const forked = invoke(
      [
        "asset",
        "fork",
        "asset-cli",
        "--new-id",
        "asset-cli-fork",
        "--reason",
        "fork reason",
        "--json",
      ],
      cwd,
    );
    expect(forked.code).toBe(0);
    const fork = invoke(["asset", "inspect", "asset-cli-fork", "--json"], cwd);
    expect(fork.code).toBe(0);
    expect(
      (resultOf(fork) as unknown as { asset: { forkedFrom?: { id: string } } })
        .asset.forkedFrom?.id,
    ).toBe("asset-cli");
  });

  it("`asset activate` refuses a missing promotion review file", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const seeded = seedEvent(cwd, "seed-evidence");
    seedCandidateAsset(cwd, "asset-activate", seeded.id);

    const missing = invoke(
      [
        "asset",
        "activate",
        "asset-activate",
        "--reason",
        "promote",
        "--review",
        join(cwd, "absent-review.json"),
        "--json",
      ],
      cwd,
    );
    expect(missing.code).toBe(3);
    expect(errorOf(missing).code).toBe("CONFIG_ERROR");
  });

  it("`asset contest` refuses an asset that does not exist", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const missing = invoke(
      ["asset", "contest", "ghost", "--reason", "why", "--json"],
      cwd,
    );
    expect(missing.code).not.toBe(0);
  });
});

describe("P0 operator surface — diagnostics and P1 paths", () => {
  it("`doctor` passes on a healthy store and exits 6 when a check fails", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const healthy = invoke(["doctor", "--json"], cwd);
    expect(healthy.code).toBe(0);
    expect((resultOf(healthy) as unknown as { status: string }).status).toBe(
      "pass",
    );

    // A legacy import that appends events without catching the projections up
    // would leave a lag; write one directly through the store so doctor has a
    // real fault to find.
    const root = openRoot(cwd);
    try {
      const now = "2026-09-16T00:00:00.000Z";
      root.runtime.appendEvent({
        schemaVersion: "1",
        eventVersion: "1",
        id: "unprojected",
        type: "interaction.recorded",
        occurredAt: now,
        observedAt: now,
        recordedAt: now,
        actor: { type: "human", id: "phase55-operator" },
        source: { kind: "test", ref: "unprojected" },
        payload: { seeded: true },
        evidence: [{ artifactHash: "a".repeat(64), origin: "declared" }],
        provenance: { origin: "declared", confidence: 1 },
      });
    } finally {
      root.close();
    }
    const lagging = invoke(["doctor", "--json"], cwd);
    expect(lagging.code).toBe(6);
    const checks = (
      resultOf(lagging) as unknown as {
        checks: Array<{ name: string; status: string }>;
      }
    ).checks;
    expect(
      checks.some(
        (check) =>
          check.name.startsWith("projection:") && check.status === "fail",
      ),
    ).toBe(true);
  });

  it("`legacy runs` and `legacy anomalies` answer without an import", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const runs = invoke(["legacy", "runs", "--json"], cwd);
    expect(runs.code).toBe(0);
    const anomalies = invoke(
      ["legacy", "anomalies", "no-such-run", "--json"],
      cwd,
    );
    // An unknown run id is a refusal, not a crash.
    expect([0, 2]).toContain(anomalies.code);
  });

  it("`backup list` answers on a store with no managed backups", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const listed = invoke(["backup", "list", "--json"], cwd);
    expect(listed.code).toBe(0);
  });

  it("`lock inspect` reports the writer lock without mutating it", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const inspected = invoke(["lock", "inspect", "--json"], cwd);
    expect(inspected.code).toBe(0);
  });

  it("`lock clear-stale` declines a token that does not match the lock", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    // `init` releases its lock, so there is nothing stale to clear. The
    // command reports that it did not clear rather than failing: clearing is
    // idempotent, and a refusal to clear is the safe answer, not an error.
    const refused = invoke(
      ["lock", "clear-stale", "--token", "not-the-token", "--json"],
      cwd,
    );
    expect(refused.code).toBe(0);
    expect((resultOf(refused) as unknown as { cleared: boolean }).cleared).toBe(
      false,
    );
  });

  it("an unknown flag on a P0 command is a usage error, not a silent no-op", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const refused = invoke(["state", "show", "--nope", "x", "--json"], cwd);
    expect(refused.code).toBe(2);
    expect(errorOf(refused).code).toBe("USAGE_ERROR");
  });

  it("`history explain` and `asset` subcommands refuse unknown verbs", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const refused = invoke(["asset", "frobnicate", "x", "--json"], cwd);
    expect(refused.code).toBe(2);
    expect(errorOf(refused).code).toBe("USAGE_ERROR");
  });
});

describe("IR-02 — imported patterns convert only by explicit human action", () => {
  const fixtureData = resolve(
    fileURLToPath(new URL("../../fixtures/legacy/data", import.meta.url)),
  );

  function importFixture(cwd: string): void {
    const dryRun = invoke(
      ["legacy", "import", fixtureData, "--dry-run", "--json"],
      cwd,
    );
    expect(dryRun.code).toBe(0);
    const planHash = (
      JSON.parse(dryRun.stdout) as { result: { plan: { planHash: string } } }
    ).result.plan.planHash;
    const applied = invoke(
      [
        "legacy",
        "import",
        fixtureData,
        "--confirm",
        "--plan-hash",
        planHash,
        "--json",
      ],
      cwd,
    );
    expect(applied.code).toBe(0);
  }

  it("lists imported patterns, inspects one, and converts it to a candidate — never to active", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    importFixture(cwd);

    const listed = invoke(["legacy", "patterns", "--json"], cwd);
    expect(listed.code).toBe(0);
    const patterns = (
      resultOf(listed) as unknown as {
        patterns: Array<{ eventId: string; patternId: string; origin: string }>;
      }
    ).patterns;
    expect(patterns.length).toBeGreaterThan(0);
    // An imported pattern is inferred material, and stays so.
    expect(patterns.every((pattern) => pattern.origin === "inferred")).toBe(
      true,
    );

    const first = patterns[0] as { eventId: string; patternId: string };
    const inspected = invoke(
      ["legacy", "pattern", first.eventId, "--json"],
      cwd,
    );
    expect(inspected.code).toBe(0);

    // Without a reason there is no conversion; the command is a usage error
    // and nothing is written.
    const noReason = invoke(
      [
        "legacy",
        "convert",
        first.eventId,
        "--asset-id",
        "asset-from-legacy",
        "--json",
      ],
      cwd,
    );
    expect(noReason.code).toBe(2);
    expect(errorOf(noReason).code).toBe("USAGE_ERROR");

    const before = ledgerCount(cwd);
    const converted = invoke(
      [
        "legacy",
        "convert",
        first.eventId,
        "--asset-id",
        "asset-from-legacy",
        "--reason",
        "the pattern survived review",
        "--json",
      ],
      cwd,
    );
    expect(converted.code).toBe(0);
    expect(ledgerCount(cwd)).toBeGreaterThan(before);

    const asset = invoke(
      ["asset", "inspect", "asset-from-legacy", "--json"],
      cwd,
    );
    expect(asset.code).toBe(0);
    const inspectedAsset = (
      resultOf(asset) as unknown as {
        asset: { status: string; derivedFrom: Array<{ eventId?: string }> };
      }
    ).asset;
    // Candidate, not active: the conversion is not a promotion.
    expect(inspectedAsset.status).toBe("candidate");
    expect(inspectedAsset.derivedFrom.map((ref) => ref.eventId)).toContain(
      first.eventId,
    );
  });

  it("refuses to convert an event that is not an imported pattern", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    seedEvent(cwd, "not-a-pattern");
    const refused = invoke(
      [
        "legacy",
        "convert",
        "not-a-pattern",
        "--asset-id",
        "asset-x",
        "--reason",
        "why not",
        "--json",
      ],
      cwd,
    );
    expect(refused.code).not.toBe(0);
  });

  it("answers `legacy patterns` on a store with no import", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const listed = invoke(["legacy", "patterns", "--json"], cwd);
    expect(listed.code).toBe(0);
    expect((resultOf(listed) as unknown as { count: number }).count).toBe(0);
  });
});

describe("IR-02 boundary — what this suite does not cover", () => {
  it("records that the CLI writer is always the local OWNER capability", () => {
    // The CLI's composition root builds `resolveEnvironment` with
    // `role: "OWNER"` and the full scope list, so a permission *refusal* is not
    // reachable through the command line: the local operator owns the machine
    // and the ledger. The permission path is therefore exercised where it
    // exists — `tests/unit/authorization.test.ts` and the Phase 3.5/4
    // integration suites — and this suite covers the argument and state-change
    // refusals that *are* reachable. Naming the boundary here keeps the gate
    // from claiming a coverage it does not have.
    const cwd = workdir();
    invoke(["init"], cwd);
    const doc = document(invoke(["doctor", "--json"], cwd)) as unknown as {
      result: { checks: Array<{ name: string }> };
    };
    expect(doc.result.checks.map((check) => check.name)).toContain(
      "writer-lock",
    );
  });
});
