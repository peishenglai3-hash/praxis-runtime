import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  permissionScopes,
  type EventEnvelope,
  type WriterContext,
} from "../../packages/contracts/src/index.js";
import {
  RuntimeCompositionRoot,
  WriterOwnershipLock,
  WriterLockError,
} from "../../packages/runtime/src/index.js";
import {
  restoreDatabaseFile,
  SqliteEventStore,
} from "../../packages/store/src/index.js";

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const writer: WriterContext = {
  writerId: "test:phase35-maintenance",
  kind: "human",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

let directory: string | undefined;
let root: RuntimeCompositionRoot | undefined;
let restoredStore: SqliteEventStore | undefined;

afterEach(() => {
  restoredStore?.close();
  restoredStore = undefined;
  root?.close();
  root = undefined;
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function openRoot(): RuntimeCompositionRoot {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase35-maintenance-"));
  const store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  root = new RuntimeCompositionRoot({
    store,
    mode: "embedded",
    actor: { type: "human", id: "phase35-owner" },
    writer,
  }).start();
  return root;
}

function event(
  id: string,
  sessionId: string | undefined,
  type = "interaction.observed",
): EventEnvelope {
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id,
    type,
    occurredAt: "2026-09-15T00:00:00.000Z",
    observedAt: "2026-09-15T00:00:00.000Z",
    recordedAt: "2026-09-15T00:00:00.000Z",
    actor: { type: "human", id: "phase35-owner" },
    ...(sessionId === undefined ? {} : { sessionId }),
    operationId: id,
    source: { kind: "phase35-maintenance-test", ref: id },
    payload: { id, sessionId: sessionId ?? null },
    provenance: { origin: "direct", confidence: 1 },
  };
}

describe("Phase 3.5 runtime assembly and maintenance", () => {
  it("keeps reads and asset controls behind explicit runtime boundaries", () => {
    const currentRoot = openRoot();
    const source = currentRoot.runtime.appendEvent(
      event("asset-source", undefined, "asset.candidate"),
    ).record;

    expect(currentRoot.inspectEvent(source.id)?.id).toBe(source.id);
    expect(
      currentRoot
        .exportEvents({ type: "asset.candidate" })
        .map((item) => item.id),
    ).toEqual([source.id]);

    const contested = currentRoot.runtime.contestAsset(
      "asset-source",
      "human review requested",
      "2026-09-15T00:00:01.000Z",
    ).record;
    const disabled = currentRoot.runtime.disableAsset(
      "asset-source",
      "source evidence is incomplete",
      "2026-09-15T00:00:02.000Z",
    ).record;
    const restored = currentRoot.runtime.restoreAsset(
      "asset-source",
      "evidence was rechecked",
      "2026-09-15T00:00:03.000Z",
    ).record;
    const forked = currentRoot.runtime.forkAsset(
      "asset-source",
      "asset-fork",
      "preserve a separately reviewable interpretation",
      "2026-09-15T00:00:04.000Z",
    ).record;

    expect(contested.type).toBe("asset.contest");
    expect(disabled.type).toBe("asset.disable");
    expect(restored.type).toBe("asset.restore");
    expect(forked.type).toBe("asset.fork");
    expect(forked.links?.respondsTo).toEqual([restored.id]);
    expect(forked.payload).toMatchObject({
      id: "asset-fork",
      sourceAssetId: "asset-source",
    });
  });

  it("owns one writer, creates an online backup, and restores its snapshot", () => {
    const currentRoot = openRoot();
    const databasePath = currentRoot.databasePath;
    currentRoot.runtime.appendEvent(event("event-1", "session-restore"));
    currentRoot.catchUpCoreProjections();

    const backup = currentRoot.backupTo(
      join(directory!, "unmanaged-backup.db"),
      {
        id: "backup:restore-test",
        createdAt: Date.parse("2026-09-15T00:00:01.000Z"),
      },
    );
    expect(backup.lastEventSeq).toBe(1);
    expect(existsSync(backup.path)).toBe(true);

    const restoredPath = join(directory!, "restored.db");
    expect(() =>
      restoreDatabaseFile({
        sourcePath: backup.path,
        destinationPath: restoredPath,
        expectedSha256: "0".repeat(64),
      }),
    ).toThrowError("checksum does not match");
    expect(existsSync(restoredPath)).toBe(false);
    restoreDatabaseFile({
      sourcePath: backup.path,
      destinationPath: restoredPath,
      expectedSha256: backup.backupSha256,
    });
    restoredStore = new SqliteEventStore({
      filename: restoredPath,
      migrationsDir,
    });
    expect(restoredStore.query().map((item) => item.id)).toEqual(["event-1"]);

    const competingStore = new SqliteEventStore({
      filename: databasePath,
      migrationsDir,
    });
    const competingRoot = new RuntimeCompositionRoot({
      store: competingStore,
      mode: "daemon",
      actor: { type: "system", id: "competing-daemon" },
      writer: {
        ...writer,
        writerId: "test:competing-daemon",
        kind: "runtime",
        authn: "daemon-token",
      },
    });
    expect(() => competingRoot.start()).toThrowError(WriterLockError);
    competingRoot.close();
  });

  it("clears a stale writer lock only with its matching token", () => {
    const currentRoot = openRoot();
    const stale = new WriterOwnershipLock(join(directory!, "stale.lock"));
    writeFileSync(
      stale.path,
      JSON.stringify({
        pid: Number.MAX_SAFE_INTEGER,
        mode: "embedded",
        startedAt: "2026-09-15T00:00:00.000Z",
        dbPath: currentRoot.databasePath,
        token: "stale-token",
      }),
      "utf8",
    );

    expect(stale.inspect()).toMatchObject({
      pid: Number.MAX_SAFE_INTEGER,
      token: "stale-token",
    });
    expect(() => stale.clearStale("wrong-token")).toThrowError(WriterLockError);
    expect(stale.clearStale("stale-token")).toBe(true);
    expect(stale.inspect()).toBeNull();
  });

  it("recovers a committed pending-backup cleanup after a process boundary", () => {
    const currentRoot = openRoot();
    const managed = currentRoot.createManagedBackup(
      join(directory!, "pending-backup.db"),
      { id: "backup:pending-recovery" },
    );
    const database = new DatabaseSync(currentRoot.databasePath);
    try {
      database
        .prepare(
          `UPDATE managed_backups
           SET status = 'purge-pending', pending_path = ?
           WHERE backup_id = ?`,
        )
        .run(managed.path, managed.id);
    } finally {
      database.close();
    }

    const cleanup = currentRoot.finalizePendingPurge();
    expect(cleanup).toEqual({
      finalizedBackupIds: [managed.id],
      pendingBackupIds: [],
    });
    expect(existsSync(managed.path)).toBe(false);
    expect(
      currentRoot.listManagedBackups().find((item) => item.id === managed.id)
        ?.status,
    ).toBe("deleted");
  });

  it("keeps purge dry-run read-only and rebuilds projections after confirmed purge", () => {
    const currentRoot = openRoot();
    currentRoot.runtime.appendEvent(event("session-event", "session-purge"));
    const unrelated = event("unrelated-string", undefined);
    unrelated.payload = { note: "session-purge" };
    currentRoot.runtime.appendEvent(unrelated);
    currentRoot.runtime.appendEvent(event("retained-event", undefined));
    currentRoot.catchUpCoreProjections();
    const managed = currentRoot.createManagedBackup(
      join(directory!, "managed-backup.db"),
      {
        id: "backup:managed-purge",
        createdAt: Date.parse("2026-09-15T00:00:02.000Z"),
      },
    );
    const beforeIds = currentRoot.exportEvents().map((item) => item.id);

    const dryRun = currentRoot.privacyPurge("session-purge");
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.plan.eventIds).toEqual(["session-event"]);
    expect(currentRoot.exportEvents().map((item) => item.id)).toEqual(
      beforeIds,
    );
    expect(existsSync(managed.path)).toBe(true);

    const preserved = currentRoot.privacyPurge("session-purge", {
      preserveManagedBackups: true,
    });
    expect(preserved.warnings).toEqual([
      "selected managed backups still contain data covered by this purge",
    ]);

    const result = currentRoot.privacyPurge("session-purge", {
      confirm: true,
      executedAt: Date.parse("2026-09-15T00:00:03.000Z"),
    });
    expect(result.receipt?.deletedEventCount).toBe(1);
    expect(currentRoot.exportEvents().map((item) => item.id)).toEqual([
      "unrelated-string",
      "retained-event",
    ]);
    expect(existsSync(managed.path)).toBe(false);
    expect(currentRoot.getHealth().purgedSeqRanges).toEqual([
      {
        startSeq: 1,
        endSeq: 1,
        receiptId: result.receipt?.receiptId,
      },
    ]);
    expect(
      result.projectionRebuild?.every((item) => item.status === "caught_up"),
    ).toBe(true);
    expect(currentRoot.doctor().status).toBe("pass");
  });
});
