import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  AuthorizationError,
  permissionScopes,
  type WriterContext,
} from "../../packages/contracts/src/index.js";
import {
  RuntimeCompositionRoot,
  WriterOwnershipLock,
} from "../../packages/runtime/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);
const fixtureRoot = resolve(
  fileURLToPath(new URL("../../fixtures/legacy", import.meta.url)),
);

const ownerWriter: WriterContext = {
  writerId: "test:phase5-owner",
  kind: "human",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

let directory: string | undefined;
let root: RuntimeCompositionRoot | undefined;

afterEach(() => {
  root?.close();
  root = undefined;
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function openRoot(writer: WriterContext = ownerWriter): RuntimeCompositionRoot {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase5-legacy-"));
  const store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  root = new RuntimeCompositionRoot({
    store,
    mode: "embedded",
    actor: { type: "human", id: "phase5-owner" },
    writer,
  }).start();
  return root;
}

function fixtureRoots(): string[] {
  return [join(fixtureRoot, "source"), join(fixtureRoot, "data")];
}

function plans(rootNode: RuntimeCompositionRoot) {
  return rootNode.planLegacyImport({ roots: fixtureRoots() });
}

describe("Phase 5 legacy import", () => {
  it("plans without writing to the ledger or the source", () => {
    const composition = openRoot();
    const before = composition.getHealth().lastSeq;
    const plan = plans(composition);

    expect(composition.getHealth().lastSeq).toBe(before);
    expect(composition.listLegacyImportRuns()).toEqual([]);
    expect(plan.counts.scannedFiles).toBe(18);
    expect(plan.signals).toHaveLength(5);
    expect(plan.patterns).toHaveLength(3);
    expect(plan.graphEdges).toHaveLength(6);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports every documented anomaly class on the fixture", () => {
    const composition = openRoot();
    const plan = plans(composition);
    const classes = new Set(
      plan.inventory.anomalies.map((anomaly) => anomaly.class),
    );

    for (const expected of [
      "possible_overwrite",
      "ambiguous_pattern",
      "source_metadata_conflict",
      "unrecoverable_field",
      "cartesian_relation",
      "parse_error",
      "encoding_marker",
      "unmapped_path",
    ]) {
      expect(classes.has(expected as never)).toBe(true);
    }
    // A `legacy` import never silently repairs the source: the CRLF anchor
    // failure is reported rather than normalised away.
    const anchor = plan.inventory.anomalies.find(
      (anomaly) =>
        anomaly.class === "parse_error" &&
        anomaly.declaredValue === "format_anchor_mismatch",
    );
    expect(anchor).toBeDefined();
  });

  it("requires the confirmed hash to match the reviewed plan", () => {
    const composition = openRoot();
    const plan = plans(composition);

    expect(() =>
      composition.applyLegacyImport({
        plan,
        planHash: "0".repeat(64),
        archiveRoot: join(directory ?? tmpdir(), "archive"),
      }),
    ).toThrowError(/does not match the reviewed plan/);

    expect(composition.listLegacyImportRuns()).toEqual([]);
  });

  it("records the run, its inventory, its anomalies and its events atomically", () => {
    const composition = openRoot();
    const plan = plans(composition);
    const archiveRoot = join(directory ?? tmpdir(), "archive");

    const applied = composition.applyLegacyImport({
      plan,
      planHash: plan.planHash,
      archiveRoot,
    });

    expect(applied.inserted).toBe(true);
    expect(applied.status).toBe("applied");
    // signals + patterns + graph edges + anomalies + completion
    expect(applied.appendedEvents).toBe(
      plan.signals.length +
        plan.patterns.length +
        plan.graphEdges.length +
        plan.inventory.anomalies.length +
        1,
    );

    const runs = composition.listLegacyImportRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.sourceFingerprint).toBe(plan.sourceFingerprint);
    expect(runs[0]?.hasArchive).toBe(true);

    const anomalies = composition.getLegacyImportAnomalies(runs[0]!.runId);
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies.map((item) => item.class)).toContain("ambiguous_pattern");

    // The archive is written outside the repository and mirrored by a manifest
    // that records the digest of every copied file.
    const manifest = JSON.parse(
      readFileSync(join(archiveRoot, "manifest.json"), "utf8"),
    ) as {
      sourceFingerprint: string;
      entries: Array<{ relativePath: string; sha256: string }>;
    };
    expect(manifest.sourceFingerprint).toBe(plan.sourceFingerprint);
    expect(manifest.entries).toHaveLength(plan.counts.scannedFiles);
    for (const entry of manifest.entries) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(readdirSync(archiveRoot)).toContain("files");
  });

  it("is idempotent: re-importing the same corpus appends nothing", () => {
    const composition = openRoot();
    const plan = plans(composition);
    const archiveRoot = join(directory ?? tmpdir(), "archive");

    const first = composition.applyLegacyImport({
      plan,
      planHash: plan.planHash,
      archiveRoot,
    });
    const seqAfterFirst = composition.getHealth().lastSeq;
    const second = composition.applyLegacyImport({
      plan,
      planHash: plan.planHash,
      archiveRoot,
    });

    expect(second.inserted).toBe(false);
    expect(second.status).toBe("already-imported");
    expect(second.appendedEvents).toBe(0);
    expect(composition.getHealth().lastSeq).toBe(seqAfterFirst);
    expect(composition.listLegacyImportRuns()).toHaveLength(1);
    expect(first.runId).toBe(second.runId);
  });

  it("invalidates the confirmation when the corpus changes", () => {
    const composition = openRoot();
    const corpusCopy = join(directory ?? tmpdir(), "corpus");
    cpSync(fixtureRoot, corpusCopy, { recursive: true });
    const roots = [join(corpusCopy, "source"), join(corpusCopy, "data")];

    const reviewed = composition.planLegacyImport({ roots });
    mkdirSync(join(corpusCopy, "data", "notes"), { recursive: true });
    writeFileSync(join(corpusCopy, "data", "notes", "later.txt"), "changed");
    const afterChange = composition.planLegacyImport({ roots });

    expect(afterChange.planHash).not.toBe(reviewed.planHash);
    expect(() =>
      composition.applyLegacyImport({
        plan: afterChange,
        planHash: reviewed.planHash,
        archiveRoot: join(directory ?? tmpdir(), "archive"),
      }),
    ).toThrowError(/does not match the reviewed plan/);
  });

  it("never promotes an imported pattern and gives the importer no asset scope", () => {
    const composition = openRoot();
    const plan = plans(composition);
    composition.applyLegacyImport({
      plan,
      planHash: plan.planHash,
      archiveRoot: join(directory ?? tmpdir(), "archive"),
    });

    // No imported record created an asset of any status.
    expect(composition.listAssets()).toEqual([]);

    // Every imported pattern event carries inferred provenance and low
    // confidence, so no imported record claims to be a validated observation.
    const patternEvents = composition.exportEvents({
      type: "legacy.pattern.imported",
    });
    expect(patternEvents).toHaveLength(plan.patterns.length);
    for (const record of patternEvents) {
      expect(record.provenance.origin).toBe("inferred");
      expect(record.provenance.confidence).toBeLessThanOrEqual(0.5);
    }
  });

  it("rejects a legacy event that reaches the store without the import path", () => {
    const composition = openRoot();
    const fingerprint = "f".repeat(64);
    // The identifier is correct, so the failure is specifically the writer
    // boundary rather than a malformed payload.
    const forgedId = `legacy-anomaly:${fingerprint}:forged`;

    expect(() =>
      composition.runtime.appendEvent({
        schemaVersion: "1",
        eventVersion: "1",
        id: forgedId,
        type: "legacy.anomaly",
        occurredAt: "2026-09-15T00:00:00.000Z",
        observedAt: "2026-09-15T00:00:00.000Z",
        recordedAt: "2026-09-15T00:00:00.000Z",
        actor: { type: "system", id: "forged" },
        operationId: forgedId,
        source: { kind: "legacy-import", ref: fingerprint },
        payload: {
          materialClassification: "declared",
          sourceFingerprint: fingerprint,
          anomalyId: "forged",
          anomalyClass: "parse_error",
          reason: "forged",
          affectedCount: 1,
        },
        evidence: [{ artifactHash: "a".repeat(64), origin: "direct" }],
        provenance: { origin: "direct", confidence: 1 },
      }),
    ).toThrowError(/legacy/);
  });

  it("keeps the low-level ledger boundary closed against a raw insert", () => {
    const composition = openRoot();
    const database = new DatabaseSync(composition.databasePath);
    try {
      // No writer provenance at all is refused before the payload is even
      // examined, so a direct SQL writer cannot mint an import record.
      expect(() =>
        database
          .prepare(
            `INSERT INTO events (
               id, schema_version, event_version, type,
               occurred_at, observed_at, recorded_at,
               actor_type, actor_id, operation_id,
               source_json, payload_json, evidence_json, provenance_json,
               content_hash
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "legacy-anomaly:forged-raw",
            "1",
            "1",
            "legacy.anomaly",
            Date.parse("2026-09-15T00:00:00.000Z"),
            Date.parse("2026-09-15T00:00:00.000Z"),
            Date.parse("2026-09-15T00:00:00.000Z"),
            "system",
            "forged",
            "legacy-anomaly:forged-raw",
            JSON.stringify({ kind: "legacy-import", ref: "f".repeat(64) }),
            JSON.stringify({
              materialClassification: "declared",
              sourceFingerprint: "f".repeat(64),
              anomalyId: "forged",
              anomalyClass: "parse_error",
              reason: "forged",
              affectedCount: 1,
            }),
            JSON.stringify([
              { artifactHash: "a".repeat(64), origin: "direct" },
            ]),
            JSON.stringify({ origin: "direct", confidence: 1 }),
            "0".repeat(64),
          ),
      ).toThrowError(/importer or owner writer/);
    } finally {
      database.close();
    }
  });

  it("reports legacy integrity as part of doctor", () => {
    const composition = openRoot();
    const plan = plans(composition);
    composition.applyLegacyImport({
      plan,
      planHash: plan.planHash,
      archiveRoot: join(directory ?? tmpdir(), "archive"),
    });

    const report = composition.doctor();
    const check = report.checks.find(
      (item) => item.name === "legacy-import-integrity",
    );
    expect(check?.status).toBe("pass");
  });

  it("requires the migration scope to run a dry run", () => {
    const composition = openRoot({
      writerId: "test:observer",
      kind: "runtime",
      role: "OBSERVER",
      authn: "embedded-local",
      scopes: ["event.read"],
      policyVersion: 1,
    });
    expect(() => plans(composition)).toThrowError(AuthorizationError);
  });

  it("exposes one purge scope per imported corpus", () => {
    const composition = openRoot();
    const plan = plans(composition);
    const sessionId = composition.legacyImportSessionId(plan.sourceFingerprint);
    expect(sessionId.startsWith("legacy:")).toBe(true);
    // The scope is empty until the corpus is actually imported, and then it
    // selects exactly the events of that corpus.
    expect(composition.planPrivacyPurge(sessionId).eventIds).toEqual([]);

    composition.applyLegacyImport({
      plan,
      planHash: plan.planHash,
      archiveRoot: join(directory ?? tmpdir(), "archive"),
    });
    const purgePlan = composition.planPrivacyPurge(sessionId);
    expect(purgePlan.eventIds.length).toBeGreaterThan(0);
    expect(purgePlan.scope).toEqual({ type: "session", value: sessionId });
  });
});

describe("Phase 5 writer lock", () => {
  it("keeps the legacy import behind the single-writer lock", () => {
    const composition = openRoot();
    const lockPath = composition.writerLockPath;
    expect(() =>
      new WriterOwnershipLock(lockPath).acquire({
        pid: process.pid,
        mode: "embedded",
        startedAt: new Date().toISOString(),
        dbPath: composition.databasePath,
      }),
    ).toThrow();
  });
});
