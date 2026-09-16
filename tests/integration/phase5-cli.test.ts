import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { run } from "../../apps/cli/src/index.js";

/**
 * The command line's contract is its exit code and, under `--json`, the
 * document it writes to stdout. These tests call the dispatcher in-process so
 * the contract is checked directly rather than through a shell.
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);
const fixtureData = resolve(
  fileURLToPath(new URL("../../fixtures/legacy/data", import.meta.url)),
);

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function workdir(): string {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase5-cli-"));
  return directory;
}

interface Invocation {
  code: number;
  stdout: string;
  stderr: string;
  json: () => Record<string, unknown>;
}

function invoke(argv: readonly string[], cwd: string): Invocation {
  let stdout = "";
  let stderr = "";
  const code = run(argv, { PRAXIS_MIGRATIONS_DIR: migrationsDir }, cwd, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return {
    code,
    stdout,
    stderr,
    json: () =>
      JSON.parse(
        stderr.length > 0 && stdout.length === 0 ? stderr : stdout,
      ) as Record<string, unknown>,
  };
}

describe("praxis command line", () => {
  it("reports its own usage without failing", () => {
    const cwd = workdir();
    const result = invoke(["--help"], cwd);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: praxis");
  });

  it("labels every machine document with a schema version", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const doctor = invoke(["doctor", "--json"], cwd);
    const document = JSON.parse(doctor.stdout) as Record<string, unknown>;
    expect(document["schemaVersion"]).toBe("1");
    expect(document["ok"]).toBe(true);
    expect(document["command"]).toBe("doctor");
  });

  it("keeps stdout free of anything but the machine document under --json", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const result = invoke(["doctor", "--json"], cwd);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);
  });

  it("exits 2 for a usage error and names the missing argument", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const result = invoke(["asset", "inspect", "--json"], cwd);
    expect(result.code).toBe(2);
    const document = JSON.parse(result.stderr) as {
      ok: boolean;
      error: { code: string; suggestedAction: string; traceId: string };
    };
    expect(document.ok).toBe(false);
    expect(document.error.code).toBe("USAGE_ERROR");
    expect(document.error.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(document.error.suggestedAction.length).toBeGreaterThan(0);
  });

  it("exits 3 for a configuration file with an unknown field", () => {
    const cwd = workdir();
    writeFileSync(
      join(cwd, "praxis.config.json"),
      `${JSON.stringify({ schemaVersion: "1", dataDir: ".praxis", typo: true })}\n`,
    );
    const result = invoke(["doctor", "--json"], cwd);
    expect(result.code).toBe(3);
    const document = JSON.parse(result.stderr) as {
      error: { code: string; details?: { knownFields?: string[] } };
    };
    expect(document.error.code).toBe("CONFIG_ERROR");
    expect(document.error.details?.knownFields).toContain("dataDir");
  });

  it("initializes once and reports an unchanged configuration afterwards", () => {
    const cwd = workdir();
    const first = invoke(["init", "--json"], cwd);
    expect(first.code).toBe(0);
    const firstDocument = JSON.parse(first.stdout) as {
      result: { configChanged: boolean; migrationVersion: number };
    };
    expect(firstDocument.result.configChanged).toBe(true);
    expect(firstDocument.result.migrationVersion).toBe(11);

    const second = invoke(["init", "--json"], cwd);
    const secondDocument = JSON.parse(second.stdout) as {
      result: { configChanged: boolean };
    };
    expect(secondDocument.result.configChanged).toBe(false);
  });

  it("passes doctor after init and catches up the projections", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const result = invoke(["doctor"], cwd);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("doctor: pass");
  });

  it("exits 6 when a reserved event family is sent through the generic append", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const result = invoke(
      [
        "event",
        "append",
        "--type",
        "residual.detected",
        "--payload",
        "{}",
        "--json",
      ],
      cwd,
    );
    expect(result.code).toBe(6);
    const document = JSON.parse(result.stderr) as { error: { code: string } };
    expect(document.error.code).toBe("INVARIANT_VIOLATION");
  });

  it("round-trips an interaction event through append and list", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    const appended = invoke(
      [
        "event",
        "append",
        "--type",
        "interaction.recorded",
        "--payload",
        JSON.stringify({ note: "cli round trip" }),
        "--session",
        "cli-session",
        "--artifact-hash",
        "a".repeat(64),
        "--json",
      ],
      cwd,
    );
    expect(appended.code).toBe(0);

    const listed = invoke(
      ["event", "list", "--type", "interaction.recorded", "--json"],
      cwd,
    );
    const document = JSON.parse(listed.stdout) as {
      result: { count: number };
    };
    expect(document.result.count).toBe(1);
  });

  it("refuses an append that has no artifact to cite rather than inventing a digest", () => {
    // A fabricated digest is indistinguishable from a real one once it is in
    // the ledger, so the command has no honest fallback here. Before the fix
    // it wrote sixty-four zeroes with `origin: "declared"`; see BP-050.
    const cwd = workdir();
    invoke(["init"], cwd);

    const refused = invoke(
      [
        "event",
        "append",
        "--type",
        "interaction.recorded",
        "--payload",
        JSON.stringify({ note: "no artifact" }),
        "--json",
      ],
      cwd,
    );
    expect(refused.code).toBe(2);
    const document = JSON.parse(refused.stderr) as {
      error: { code: string; message: string };
    };
    expect(document.error.code).toBe("USAGE_ERROR");
    expect(document.error.message).toContain("--artifact-hash");

    // Nothing may have been written by the refused call.
    const listed = invoke(
      ["event", "list", "--type", "interaction.recorded", "--json"],
      cwd,
    );
    const after = JSON.parse(listed.stdout) as { result: { count: number } };
    expect(after.result.count).toBe(0);
  });

  it("exports a manifest whose digest is a digest, not a length", () => {
    // The manifest's `digest` field used to hold `stableStringify(...).length`
    // — a character count. Anyone verifying an export against it would have
    // been comparing against a number. See BP-050.
    const cwd = workdir();
    invoke(["init"], cwd);
    const append = (note: string) =>
      invoke(
        [
          "event",
          "append",
          "--type",
          "interaction.recorded",
          "--payload",
          JSON.stringify({ note }),
          "--artifact-hash",
          "b".repeat(64),
          "--json",
        ],
        cwd,
      );

    const manifestOf = () => {
      const exported = invoke(["export", "--json"], cwd);
      expect(exported.code).toBe(0);
      return (
        JSON.parse(exported.stdout) as {
          result: { manifest: { digest: string; eventCount: number } };
        }
      ).result.manifest;
    };

    const before = manifestOf();
    expect(before.digest).toMatch(/^[a-f0-9]{64}$/);

    append("first");
    const after = manifestOf();
    expect(after.eventCount).toBe(before.eventCount + 1);

    // A digest of the exported content changes when the content does; a length
    // of it need not. This is the assertion that tells the two apart, and it
    // is why the counts above are relative: `init` writes events of its own.
    expect(after.digest).not.toBe(before.digest);
  });

  it("runs inside a Git working tree, and still refuses to archive into one", () => {
    // The repository this command line ships in is itself a Git working tree,
    // so a rule enforced while merely *resolving* paths made `doctor`
    // unrunnable in the most ordinary situation there is — and `doctor` is the
    // command you reach for when something is already wrong. The rule belongs
    // at the archive write, which is the point it protects. See BP-050.
    const cwd = workdir();
    mkdirSync(join(cwd, ".git"), { recursive: true });
    expect(invoke(["init"], cwd).code).toBe(0);
    expect(invoke(["doctor", "--json"], cwd).code).toBe(0);

    // A confirmed import is where the rule has something to protect: the
    // default archive root lives under the same tree.
    const dryRun = invoke(
      ["legacy", "import", fixtureData, "--dry-run", "--json"],
      cwd,
    );
    expect(dryRun.code).toBe(0);
    const planHash = (
      JSON.parse(dryRun.stdout) as { result: { plan: { planHash: string } } }
    ).result.plan.planHash;

    const refused = invoke(
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
    expect(refused.code).toBe(3);
    const document = JSON.parse(refused.stderr) as {
      error: { code: string; message: string };
    };
    expect(document.error.code).toBe("CONFIG_ERROR");
    expect(document.error.message).toContain("Git working tree");
  });

  it("requires a reviewed plan hash before a legacy import writes anything", () => {
    const cwd = workdir();
    invoke(["init"], cwd);

    const dryRun = invoke(
      ["legacy", "import", fixtureData, "--dry-run", "--json"],
      cwd,
    );
    expect(dryRun.code).toBe(0);
    const planResult = (
      JSON.parse(dryRun.stdout) as {
        result: { plan: { planHash: string }; dryRun: boolean };
      }
    ).result;
    expect(planResult.dryRun).toBe(true);
    const planHash = planResult.plan.planHash;
    expect(planHash).toMatch(/^[a-f0-9]{64}$/);

    const before = invoke(["event", "list", "--limit", "1", "--json"], cwd);
    const seqBefore = (
      JSON.parse(before.stdout) as {
        result: { events: Array<{ seq: number }> };
      }
    ).result.events[0]?.seq;
    expect(seqBefore).toBe(1);

    const wrong = invoke(
      [
        "legacy",
        "import",
        fixtureData,
        "--confirm",
        "--plan-hash",
        "0".repeat(64),
        "--json",
      ],
      cwd,
    );
    expect(wrong.code).toBe(6);

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

    const replayed = invoke(
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
    expect(replayed.code).toBe(0);
    const replayDocument = JSON.parse(replayed.stdout) as {
      result: { application: { status: string; appendedEvents: number } };
    };
    expect(replayDocument.result.application.status).toBe("already-imported");
    expect(replayDocument.result.application.appendedEvents).toBe(0);
  });

  it("locates a deliberately corrupted database instead of reporting success", () => {
    const cwd = workdir();
    invoke(["init"], cwd);
    expect(invoke(["doctor"], cwd).code).toBe(0);

    // Remove a projection's stored state behind the runtime's back. Nothing in
    // the ledger changes, so only doctor can notice.
    const database = new DatabaseSync(join(cwd, ".praxis", "events.db"));
    try {
      database.exec(
        "DELETE FROM projection_state WHERE projection_name = 'project'",
      );
    } finally {
      database.close();
    }

    const result = invoke(["doctor", "--json"], cwd);
    expect(result.code).toBe(6);
    const document = JSON.parse(result.stdout) as {
      result: {
        status: string;
        checks: Array<{ name: string; status: string }>;
      };
    };
    expect(document.result.status).toBe("fail");
    const failing = document.result.checks.filter(
      (check) => check.status === "fail",
    );
    expect(failing.map((check) => check.name)).toContain("projection:project");
  });
});
