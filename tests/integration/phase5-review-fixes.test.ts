import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  permissionScopes,
  type WriterContext,
} from "../../packages/contracts/src/index.js";
import { run } from "../../apps/cli/src/index.js";
import { RuntimeCompositionRoot } from "../../packages/runtime/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

/**
 * Regressions for the defects the Phase 5 review found.
 *
 * Each test names the behaviour that was wrong, so a future change that
 * reintroduces it fails here rather than in a report nobody reads.
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);
const fixtureRoot = resolve(
  fileURLToPath(new URL("../../fixtures/legacy", import.meta.url)),
);

const ownerWriter: WriterContext = {
  writerId: "test:phase5-review",
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
  directory = mkdtempSync(join(tmpdir(), "praxis-phase5-review-"));
  return directory;
}

function openRoot(cwd: string): RuntimeCompositionRoot {
  mkdirSync(join(cwd, ".praxis"), { recursive: true });
  const store = new SqliteEventStore({
    filename: join(cwd, ".praxis", "events.db"),
    migrationsDir,
  });
  return new RuntimeCompositionRoot({
    store,
    mode: "embedded",
    actor: { type: "human", id: "phase5-review" },
    writer: ownerWriter,
  }).start();
}

function corpusCopy(cwd: string, name = "corpus"): string {
  const target = join(cwd, name);
  cpSync(fixtureRoot, target, { recursive: true });
  return target;
}

function invoke(argv: readonly string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = run(argv, { PRAXIS_MIGRATIONS_DIR: migrationsDir }, cwd, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

describe("privacy rules exclude the material they match", () => {
  it("withholds pattern events when the rule matches the pattern directory", () => {
    const cwd = workdir();
    const corpus = corpusCopy(cwd);
    const root = openRoot(cwd);
    try {
      const plan = root.planLegacyImport({
        roots: [join(corpus, "data")],
        privacyRules: [
          {
            ruleId: "patterns",
            pathPrefix: "patterns",
            reason: "pattern bodies carry free text",
          },
        ],
      });
      // The rule matches paths as the field map names them, not only as
      // absolute paths, so the natural spelling works.
      expect(plan.exclusions.length).toBeGreaterThan(0);
      expect(plan.patterns).toHaveLength(0);
      expect(
        plan.inventory.anomalies.some(
          (anomaly) =>
            anomaly.class === "privacy_sensitive" &&
            anomaly.declaredValue === "patterns",
        ),
      ).toBe(true);
    } finally {
      root.close();
    }
  });

  it("does not copy excluded material into the archive", () => {
    const cwd = workdir();
    const corpus = corpusCopy(cwd);
    const archiveRoot = join(cwd, "archive");
    const root = openRoot(cwd);
    try {
      const plan = root.planLegacyImport({
        roots: [join(corpus, "data")],
        privacyRules: [
          {
            ruleId: "patterns",
            pathPrefix: "patterns",
            reason: "pattern bodies carry free text",
          },
        ],
      });
      expect(plan.exclusions.length).toBeGreaterThan(0);

      const applied = root.applyLegacyImport({
        plan,
        planHash: plan.planHash,
        archiveRoot,
      });

      // The archive holds bytes, not a summary of bytes. A rule that keeps a
      // path out of the ledger while the archive copies the very material it
      // matched is a nominal control: the exclusion is reported, the bytes are
      // elsewhere. See BP-050.
      const archived = applied.report.archive?.entries ?? [];
      expect(
        archived.some((entry) => entry.relativePath.includes("patterns/")),
      ).toBe(false);

      // ...and the archive is still a copy, so the assertion above is not
      // passing merely because nothing was archived.
      expect(archived.length).toBeGreaterThan(0);
      expect(
        archived.some((entry) => entry.relativePath.includes("signals/")),
      ).toBe(true);
    } finally {
      root.close();
    }
  });

  it("reports a declared rule that matched nothing", () => {
    const cwd = workdir();
    const corpus = corpusCopy(cwd);
    const root = openRoot(cwd);
    try {
      const plan = root.planLegacyImport({
        roots: [join(corpus, "data")],
        privacyRules: [
          { ruleId: "typo", pathPrefix: "pattenrs", reason: "mispelled" },
        ],
      });
      const unmatched = plan.inventory.anomalies.find(
        (anomaly) =>
          anomaly.class === "privacy_sensitive" &&
          anomaly.declaredValue === "typo",
      );
      expect(unmatched).toBeDefined();
      expect(plan.exclusions).toHaveLength(0);
    } finally {
      root.close();
    }
  });
});

describe("a corpus already imported under another plan", () => {
  it("is recognised instead of colliding with the records it wrote", () => {
    const cwd = workdir();
    const corpus = corpusCopy(cwd);
    const root = openRoot(cwd);
    try {
      const first = root.planLegacyImport({ roots: [join(corpus, "data")] });
      const applied = root.applyLegacyImport({
        plan: first,
        planHash: first.planHash,
        archiveRoot: join(cwd, "archive"),
      });
      expect(applied.inserted).toBe(true);

      // The same corpus, reviewed under a different rule set.
      const second = root.planLegacyImport({
        roots: [join(corpus, "data")],
        privacyRules: [
          { ruleId: "profiles", pathPrefix: "profile", reason: "free text" },
        ],
      });
      expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
      expect(second.planHash).not.toBe(first.planHash);

      const replay = root.applyLegacyImport({
        plan: second,
        planHash: second.planHash,
        archiveRoot: join(cwd, "archive"),
      });
      expect(replay.inserted).toBe(false);
      expect(replay.status).toBe("already-imported");
      expect(replay.appendedEvents).toBe(0);
      expect(replay.planDiffersFromRecorded).toBe(true);
    } finally {
      root.close();
    }
  });
});

describe("purging an imported corpus", () => {
  it("does not leave doctor reporting a permanent failure", () => {
    const cwd = workdir();
    const corpus = corpusCopy(cwd);
    const root = openRoot(cwd);
    try {
      const plan = root.planLegacyImport({ roots: [join(corpus, "data")] });
      root.applyLegacyImport({
        plan,
        planHash: plan.planHash,
        archiveRoot: join(cwd, "archive"),
      });
      expect(
        root
          .doctor()
          .checks.find((check) => check.name === "legacy-import-integrity")
          ?.status,
      ).toBe("pass");

      const session = root.legacyImportSessionId(plan.sourceFingerprint);
      const purgePlan = root.planPrivacyPurge(session);
      expect(purgePlan.eventIds.length).toBeGreaterThan(0);
      root.privacyPurge(session, {
        confirm: true,
        planHash: purgePlan.planHash,
      });

      // The operator exercised their deletion right. The integrity check must
      // not blame the import for it.
      const integrity = root
        .doctor()
        .checks.find((check) => check.name === "legacy-import-integrity");
      expect(integrity?.status).toBe("pass");
    } finally {
      root.close();
    }
  });
});

describe("duplicate association pairs", () => {
  it("are reported before anything is written", () => {
    const cwd = workdir();
    const corpus = corpusCopy(cwd);
    writeFileSync(
      join(corpus, "data", ".graph_state.json"),
      `${JSON.stringify({
        associations: [
          { from: "alpha:x", to: "beta:p", strength: 0.4, frequency: 2 },
          { from: "alpha:x", to: "beta:p", strength: 0.8, frequency: 5 },
        ],
        lastBuilt: "2026-06-02T00:00:00.000Z",
      })}\n`,
    );
    const root = openRoot(cwd);
    try {
      const plan = root.planLegacyImport({ roots: [join(corpus, "data")] });
      expect(plan.counts.graphEdges).toBe(2);
      const duplicate = plan.inventory.anomalies.find((anomaly) =>
        anomaly.reason.includes("same from/to pair"),
      );
      expect(duplicate).toBeDefined();
      // The plan is still importable; the repeated pair does not become two
      // records with one identity.
      expect(plan.graphEdges[0]?.declaredBuiltAt).toBe(
        "2026-06-02T00:00:00.000Z",
      );
    } finally {
      root.close();
    }
  });
});

describe("command-line argument handling", () => {
  it("rejects an unknown flag instead of ignoring it", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const result = invoke(
      [
        "privacy",
        "purge",
        "--session",
        "s",
        "--confirm",
        "--plan-hash",
        "0".repeat(64),
        "--preserve-managed-backup",
        "--json",
      ],
      cwd,
    );
    // The misspelling must not be silently accepted: on this command the
    // ignored flag's absence changes what gets deleted.
    expect(result.code).toBe(2);
    const document = JSON.parse(result.stderr) as { error: { code: string } };
    expect(document.error.code).toBe("USAGE_ERROR");
  });

  it("treats an empty flag value as absent rather than as the working directory", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const result = invoke(
      [
        "legacy",
        "import",
        join(fixtureRoot, "data"),
        "--dry-run",
        "--archive=",
        "--json",
      ],
      cwd,
    );
    // `--archive=` resolves to "" and `resolve("")` is the process working
    // directory, which is not a path the operator named.
    expect(result.code).toBe(0);
  });

  it("refuses an archive inside a Git working tree, at the write and not at the resolve", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    mkdirSync(join(cwd, ".git"), { recursive: true });
    const archive = join(cwd, "archive");

    // A dry run writes nothing, so the rule has nothing to protect yet.
    // Enforcing it here is what made every command — `doctor` included —
    // unrunnable inside any Git working tree, which is where this repository
    // itself lives. See BP-050.
    const dryRun = invoke(
      [
        "legacy",
        "import",
        join(fixtureRoot, "data"),
        "--dry-run",
        "--archive",
        archive,
        "--json",
      ],
      cwd,
    );
    expect(dryRun.code).toBe(0);
    const planHash = (
      JSON.parse(dryRun.stdout) as { result: { plan: { planHash: string } } }
    ).result.plan.planHash;

    // The confirmed import is the step that writes the archive.
    const result = invoke(
      [
        "legacy",
        "import",
        join(fixtureRoot, "data"),
        "--confirm",
        "--plan-hash",
        planHash,
        "--archive",
        archive,
        "--json",
      ],
      cwd,
    );
    expect(result.code).toBe(3);
    const document = JSON.parse(result.stderr) as { error: { code: string } };
    expect(document.error.code).toBe("CONFIG_ERROR");
  });

  it("refuses --dry-run together with --confirm", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const result = invoke(
      [
        "legacy",
        "import",
        join(fixtureRoot, "data"),
        "--dry-run",
        "--confirm",
        "--plan-hash",
        "0".repeat(64),
        "--json",
      ],
      cwd,
    );
    expect(result.code).toBe(2);
  });
});

describe("backup restore", () => {
  it("is not refused a second time by a leftover safety copy", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const first = invoke(
      ["backup", "create", join(cwd, ".praxis", "backups", "a.db"), "--json"],
      cwd,
    );
    expect(first.code).toBe(0);
    const second = invoke(
      ["backup", "create", join(cwd, ".praxis", "backups", "b.db"), "--json"],
      cwd,
    );
    expect(second.code).toBe(0);

    const restoreOne = invoke(
      ["backup", "restore", join(cwd, ".praxis", "backups", "a.db"), "--json"],
      cwd,
    );
    const restoreTwo = invoke(
      ["backup", "restore", join(cwd, ".praxis", "backups", "b.db"), "--json"],
      cwd,
    );

    // A fixed safety-file name made the second restore fail with "restore
    // safety backup path is invalid" and no hint about which file to remove.
    // The safety copy is unique per restore, so that refusal is gone.
    //
    // A second, pre-existing condition had to be fixed for a restore to
    // complete at all (BP-047): a managed backup's snapshot carries the
    // reservation row it was taken under, whose digest is not recorded until
    // after the snapshot exists. That row is an unfinalized reservation, not a
    // checksum mismatch, and doctor now says so instead of failing.
    for (const result of [restoreOne, restoreTwo]) {
      expect(result.stderr).not.toContain(
        "restore safety backup path is invalid",
      );
    }
    expect(restoreOne.code).toBe(0);
    expect(restoreTwo.code).toBe(0);
  });

  it("still reports a backup file whose bytes changed", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const created = invoke(
      ["backup", "create", join(cwd, ".praxis", "backups", "a.db"), "--json"],
      cwd,
    );
    expect(created.code).toBe(0);

    // Doctor must keep its teeth: the fix above separates "no digest yet" from
    // "digest does not match", and only the second one is corruption.
    appendFileSync(join(cwd, ".praxis", "backups", "a.db"), "\n");

    const doctor = invoke(["doctor", "--json"], cwd);
    expect(doctor.code).toBe(6);
    const document = JSON.parse(doctor.stdout) as {
      result: {
        status: string;
        checks: Array<{ name: string; status: string }>;
      };
    };
    expect(document.result.status).toBe("fail");
    const check = document.result.checks.find(
      (item) => item.name === "managed-backup-integrity",
    );
    expect(check?.status).toBe("fail");
  });

  it("discloses an unfinalized reservation without calling it corruption", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const created = invoke(
      ["backup", "create", join(cwd, ".praxis", "backups", "a.db"), "--json"],
      cwd,
    );
    expect(created.code).toBe(0);
    const restored = invoke(
      ["backup", "restore", join(cwd, ".praxis", "backups", "a.db"), "--json"],
      cwd,
    );
    expect(restored.code).toBe(0);

    // The restored copy carries its own reservation. It passes, and the state
    // is still visible rather than smoothed away.
    const doctor = invoke(["doctor", "--json"], cwd);
    expect(doctor.code).toBe(0);
    const document = JSON.parse(doctor.stdout) as {
      result: {
        checks: Array<{
          name: string;
          details: { unfinalizedReservations?: string[] };
        }>;
      };
    };
    const check = document.result.checks.find(
      (item) => item.name === "managed-backup-integrity",
    );
    expect(check?.details.unfinalizedReservations?.length).toBe(1);
  });
});

describe("defaulted signal fields", () => {
  it("are named in absentFields on every imported record", () => {
    const cwd = workdir();
    const corpus = corpusCopy(cwd);
    writeFileSync(
      join(corpus, "data", ".signals_index.json"),
      `${JSON.stringify({
        signals: [
          {
            id: "sig_20260601_001",
            timestamp: "2026-06-01T09:00:00.000Z",
            value: "a value",
          },
        ],
        patterns: [],
      })}\n`,
    );
    const root = openRoot(cwd);
    try {
      const plan = root.planLegacyImport({ roots: [join(corpus, "data")] });
      const signal = plan.signals[0];
      expect(signal).toBeDefined();
      // The importer applies a default so the record stays readable, and says
      // which fields fell back to one.
      expect(signal?.absentFields).toContain("type");
      expect(signal?.absentFields).toContain("category");
      expect(signal?.absentFields).toContain("confidence");
      expect(signal?.absentFields).toContain("source");
      expect(signal?.source).toBe("undeclared");
      expect(
        readFileSync(join(corpus, "data", ".signals_index.json"), "utf8"),
      ).toContain("a value");
    } finally {
      root.close();
    }
  });
});
