import { DatabaseSync } from "node:sqlite";
import { appendFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  EventEnvelope,
  JsonObject,
} from "../../packages/contracts/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const makeEvent = (overrides: Partial<EventEnvelope> = {}): EventEnvelope => ({
  schemaVersion: "1",
  eventVersion: "1",
  id: "event-1",
  type: "interaction.recorded",
  occurredAt: "2026-09-13T00:00:00.000Z",
  observedAt: "2026-09-13T00:00:01.000Z",
  recordedAt: "2026-09-13T00:00:02.000Z",
  actor: { type: "human", id: "user-1" },
  source: { kind: "integration-test", provider: "vitest" },
  payload: { message: "durable" },
  provenance: { origin: "direct", confidence: 1 },
  ...overrides,
});

let temporaryDirectory: string | undefined;
let store: SqliteEventStore | undefined;

afterEach(() => {
  const cleanupErrors: unknown[] = [];
  try {
    store?.close();
  } catch (error) {
    cleanupErrors.push(error);
  } finally {
    store = undefined;
  }
  if (temporaryDirectory !== undefined) {
    try {
      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      temporaryDirectory = undefined;
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "SQLite test cleanup failed");
  }
});

function openStore(): SqliteEventStore {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "praxis-event-store-"));
  store = new SqliteEventStore({
    filename: join(temporaryDirectory, "events.db"),
    migrationsDir,
    migrationNow: () => Date.parse("2026-09-13T00:00:03.000Z"),
  });
  return store;
}

describe("SqliteEventStore", () => {
  it("applies the migration and configures the required SQLite pragmas", () => {
    const currentStore = openStore();

    expect(currentStore.pragmas).toEqual({
      journalMode: "wal",
      foreignKeys: 1,
      synchronous: 2,
      busyTimeout: 5000,
    });
    expect(currentStore.migrationVersion).toBe(3);
    expect(currentStore.migrationStatus).toEqual({
      currentVersion: 3,
      latestVersion: 3,
      pendingVersions: [],
    });
    expect(currentStore.getLastSeq()).toBe(0);
    expect("database" in currentStore).toBe(false);
  });

  it("appends in seq order and reads with an exclusive cursor", () => {
    const currentStore = openStore();
    const first = currentStore.append(
      makeEvent({ id: "event-1", operationId: "op-1" }),
    );
    const second = currentStore.append(
      makeEvent({
        id: "event-2",
        operationId: "op-2",
        payload: { message: "second" },
      }),
    );

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(true);
    expect(first.record.seq).toBe(1);
    expect(second.record.seq).toBe(2);
    expect(currentStore.getLastSeq()).toBe(2);
    expect(currentStore.getSince(0).map((event) => event.id)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(currentStore.getSince(1).map((event) => event.id)).toEqual([
      "event-2",
    ]);
    expect(currentStore.getSince(2)).toEqual([]);
  });

  it("makes retries idempotent and rejects key reuse with different content", () => {
    const currentStore = openStore();
    const event = makeEvent({ id: "event-1", operationId: "op-1" });
    const first = currentStore.append(event);
    const retry = currentStore.append(event);

    expect(retry).toEqual({ record: first.record, inserted: false });
    expect(currentStore.getLastSeq()).toBe(1);
    expect(first.record.contentHash).toMatch(/^[a-f0-9]{64}$/);

    expect(() =>
      currentStore.append(
        makeEvent({
          id: "event-1",
          operationId: "op-2",
          payload: { changed: true },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "EVENT_ID_CONFLICT" }));
    expect(() =>
      currentStore.append(
        makeEvent({
          id: "event-2",
          operationId: "op-1",
          payload: { changed: true },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_ID_CONFLICT" }));
  });

  it("supports one operation across tool lifecycle events", () => {
    const currentStore = openStore();
    const operationId = "tool-operation-1";
    const requested = currentStore.append(
      makeEvent({
        id: "tool-requested-1",
        type: "tool.requested",
        operationId,
        payload: { status: "requested" },
      }),
    );
    const succeeded = currentStore.append(
      makeEvent({
        id: "tool-succeeded-1",
        type: "tool.succeeded",
        operationId,
        payload: { status: "succeeded" },
      }),
    );
    const failed = currentStore.append(
      makeEvent({
        id: "tool-failed-1",
        type: "tool.failed",
        operationId,
        payload: { status: "failed" },
      }),
    );

    expect(
      currentStore.getByOperationId(operationId).map((event) => event.type),
    ).toEqual(["tool.requested", "tool.succeeded", "tool.failed"]);
    expect(currentStore.lookupOperationState(operationId)).toEqual({
      operationId,
      events: [requested.record, succeeded.record, failed.record],
      status: "failed",
    });
    expect(
      currentStore.append(
        makeEvent({
          id: "tool-succeeded-1",
          type: "tool.succeeded",
          operationId,
          payload: { status: "succeeded" },
        }),
      ),
    ).toEqual({ record: succeeded.record, inserted: false });
    expect(() =>
      currentStore.append(
        makeEvent({
          id: "tool-succeeded-2",
          type: "tool.succeeded",
          operationId,
          payload: { status: "changed" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "OPERATION_ID_CONFLICT" }));
  });

  it("queries by seq cursor and indexed event dimensions", () => {
    const currentStore = openStore();
    currentStore.append(
      makeEvent({
        id: "query-1",
        type: "context.selected",
        sessionId: "session-1",
        traceId: "trace-1",
        actor: { type: "agent", id: "agent-1" },
      }),
    );
    currentStore.append(
      makeEvent({
        id: "query-2",
        type: "tool.requested",
        sessionId: "session-1",
        traceId: "trace-2",
        actor: { type: "agent", id: "agent-2" },
        operationId: "query-operation-2",
      }),
    );
    currentStore.append(
      makeEvent({
        id: "query-3",
        type: "context.selected",
        sessionId: "session-2",
        traceId: "trace-1",
        actor: { type: "agent", id: "agent-1" },
      }),
    );

    expect(
      currentStore.query({ type: "context.selected" }).map((event) => event.id),
    ).toEqual(["query-1", "query-3"]);
    expect(
      currentStore
        .query({
          afterSeq: 1,
          beforeSeq: 3,
          sessionId: "session-1",
          traceId: "trace-2",
          actor: { type: "agent", id: "agent-2" },
        })
        .map((event) => event.id),
    ).toEqual(["query-2"]);
    expect(currentStore.query({ limit: 2 }).map((event) => event.id)).toEqual([
      "query-1",
      "query-2",
    ]);
    expect(currentStore.lookupOperationState("missing-operation")).toBeNull();
  });

  it("recovers idempotency after reopening the same file", () => {
    const currentStore = openStore();
    const event = makeEvent({ id: "event-1", operationId: "op-1" });
    const first = currentStore.append(event);
    const filename = join(temporaryDirectory as string, "events.db");
    currentStore.close();
    store = new SqliteEventStore({ filename, migrationsDir });

    expect(store.append(event)).toEqual({
      record: first.record,
      inserted: false,
    });
    expect(store.getLastSeq()).toBe(1);
  });

  it("round-trips provenance fields and rejects a tampered payload", () => {
    const currentStore = openStore();
    const protoObject = JSON.parse(
      '{"__proto__":{"retained":true},"safe":1}',
    ) as JsonObject;
    const event = makeEvent({
      id: "event-provenance",
      source: {
        kind: "integration-test",
        provider: "vitest",
        ref: "roundtrip",
      },
      payload: protoObject,
      evidence: [
        {
          eventId: "source-event",
          artifactHash: "abc123",
          origin: "direct",
          exposureInfluenced: true,
        },
      ],
      links: { respondsTo: ["source-event"] },
      provenance: { origin: "declared", confidence: 0.9 },
    });
    const stored = currentStore.append(event).record;

    expect(stored.evidence).toEqual(event.evidence);
    expect(stored.links).toEqual(event.links);
    expect(stored.provenance).toEqual(event.provenance);
    expect(
      stored.payload !== null &&
        typeof stored.payload === "object" &&
        Object.hasOwn(stored.payload, "__proto__"),
    ).toBe(true);

    const filename = join(temporaryDirectory as string, "events.db");
    currentStore.close();
    store = undefined;
    const tamperDatabase = new DatabaseSync(filename);
    try {
      tamperDatabase
        .prepare("UPDATE events SET payload_json = ? WHERE id = ?")
        .run('{"tampered":true}', event.id);
    } finally {
      tamperDatabase.close();
    }

    const reopenedStore = new SqliteEventStore({ filename, migrationsDir });
    store = reopenedStore;
    expect(() => reopenedStore.getById(event.id)).toThrowError(
      expect.objectContaining({ code: "STORAGE_ERROR" }),
    );
  });

  it("rejects a changed migration after it has been applied", () => {
    const migrationDirectory = mkdtempSync(
      join(tmpdir(), "praxis-migration-checksum-"),
    );
    try {
      const migrationFile = join(migrationDirectory, "0001_init.sql");
      copyFileSync(join(migrationsDir, "0001_init.sql"), migrationFile);
      const filename = join(migrationDirectory, "events.db");
      const currentStore = new SqliteEventStore({
        filename,
        migrationsDir: migrationDirectory,
      });
      currentStore.close();
      appendFileSync(migrationFile, "\n-- deliberate test mutation\n");

      expect(
        () =>
          new SqliteEventStore({
            filename,
            migrationsDir: migrationDirectory,
          }),
      ).toThrowError(expect.objectContaining({ code: "MIGRATION_ERROR" }));
    } finally {
      rmSync(migrationDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  it("rejects a hole in applied migration metadata", () => {
    const currentStore = openStore();
    const filename = join(temporaryDirectory as string, "events.db");
    currentStore.close();
    store = undefined;
    const tamperDatabase = new DatabaseSync(filename);
    try {
      tamperDatabase
        .prepare("DELETE FROM schema_migrations WHERE version = ?")
        .run(2);
    } finally {
      tamperDatabase.close();
    }

    expect(
      () => new SqliteEventStore({ filename, migrationsDir }),
    ).toThrowError(expect.objectContaining({ code: "MIGRATION_ERROR" }));
  });

  it("preflights valid legacy rows before the contract migration", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "praxis-legacy-valid-"));
    const migrationDirectory = mkdtempSync(
      join(tmpdir(), "praxis-legacy-migrations-"),
    );
    const filename = join(temporaryDirectory, "events.db");
    try {
      for (const migration of [
        "0001_init.sql",
        "0002_operation_lifecycle.sql",
      ]) {
        copyFileSync(
          join(migrationsDir, migration),
          join(migrationDirectory, migration),
        );
      }
      const legacyStore = new SqliteEventStore({
        filename,
        migrationsDir: migrationDirectory,
      });
      const legacyRecord = legacyStore.append(
        makeEvent({ id: "legacy-valid-event", operationId: "legacy-valid-op" }),
      ).record;
      legacyStore.close();

      store = new SqliteEventStore({ filename, migrationsDir });
      expect(store.migrationVersion).toBe(3);
      expect(store.getById(legacyRecord.id)).toEqual(legacyRecord);
    } finally {
      rmSync(migrationDirectory, { recursive: true, force: true });
    }
  });

  it("aborts and rolls back contract migration on invalid legacy material", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "praxis-legacy-invalid-"));
    const migrationDirectory = mkdtempSync(
      join(tmpdir(), "praxis-legacy-invalid-migrations-"),
    );
    const filename = join(temporaryDirectory, "events.db");
    try {
      for (const migration of [
        "0001_init.sql",
        "0002_operation_lifecycle.sql",
      ]) {
        copyFileSync(
          join(migrationsDir, migration),
          join(migrationDirectory, migration),
        );
      }
      const legacyStore = new SqliteEventStore({
        filename,
        migrationsDir: migrationDirectory,
      });
      legacyStore.append(
        makeEvent({
          id: "legacy-invalid-event",
          operationId: "legacy-invalid-op",
        }),
      );
      legacyStore.close();

      const tamperDatabase = new DatabaseSync(filename);
      try {
        tamperDatabase
          .prepare("UPDATE events SET source_json = ? WHERE id = ?")
          .run('{"component":"legacy"}', "legacy-invalid-event");
      } finally {
        tamperDatabase.close();
      }

      expect(
        () => new SqliteEventStore({ filename, migrationsDir }),
      ).toThrowError(expect.objectContaining({ code: "MIGRATION_ERROR" }));

      const hashTamperDatabase = new DatabaseSync(filename);
      try {
        hashTamperDatabase
          .prepare(
            "UPDATE events SET source_json = ?, content_hash = ? WHERE id = ?",
          )
          .run(
            '{"kind":"integration-test","provider":"vitest"}',
            "0".repeat(64),
            "legacy-invalid-event",
          );
      } finally {
        hashTamperDatabase.close();
      }
      expect(
        () => new SqliteEventStore({ filename, migrationsDir }),
      ).toThrowError(expect.objectContaining({ code: "MIGRATION_ERROR" }));

      const inspectionDatabase = new DatabaseSync(filename);
      try {
        expect(
          inspectionDatabase
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .all(),
        ).toEqual([{ version: 1 }, { version: 2 }]);
        expect(
          inspectionDatabase
            .prepare("SELECT source_json FROM events WHERE id = ?")
            .get("legacy-invalid-event"),
        ).toEqual({
          source_json: '{"kind":"integration-test","provider":"vitest"}',
        });
        expect(
          inspectionDatabase
            .prepare("SELECT content_hash FROM events WHERE id = ?")
            .get("legacy-invalid-event"),
        ).toEqual({ content_hash: "0".repeat(64) });
      } finally {
        inspectionDatabase.close();
      }
    } finally {
      rmSync(migrationDirectory, { recursive: true, force: true });
    }
  });

  it("keeps envelope validation at the storage boundary", () => {
    const currentStore = openStore();

    expect(() =>
      currentStore.append(makeEvent({ type: "not-an-event-type" })),
    ).toThrowError(expect.objectContaining({ code: "INVALID_EVENT" }));
    expect(() =>
      currentStore.append(
        makeEvent({ occurredAt: "2026-02-30T00:00:00.000Z" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_EVENT" }));
    expect(currentStore.getLastSeq()).toBe(0);
  });
});
