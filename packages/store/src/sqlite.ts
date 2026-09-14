import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncConnection } from "node:sqlite";
import type * as Sqlite from "node:sqlite";

import {
  eventEnvelopeSchema,
  stableStringify,
  validatePhase3EventEnvelope,
} from "@praxis/contracts";
import type {
  ActorRef,
  EventAppendResult,
  EventBatchWriter,
  EventEnvelope,
  EventLinks,
  EventQuery,
  EventReader,
  EventRecord,
  EventWriter,
  EvidenceRef,
  OperationState,
  OperationStatus,
  ProjectionDataRecord,
  ProjectionPersistence,
  ProjectionStateRecord,
  SourceRef,
  SnapshotRecord,
  Provenance,
  JsonValue,
} from "@praxis/contracts";

import { StoreError } from "./errors.js";
import { MigrationRunner } from "./migrations.js";
import type { MigrationStatus } from "./migrations.js";

type DatabaseSyncConstructor = typeof Sqlite.DatabaseSync;
const requireModule = createRequire(import.meta.url);
const { DatabaseSync } = requireModule("node:sqlite") as {
  DatabaseSync: DatabaseSyncConstructor;
};

export interface SqliteEventStoreOptions {
  filename: string;
  migrationsDir: string;
  migrationNow?: () => number;
}

export interface SqlitePragmas {
  journalMode: string;
  foreignKeys: number;
  synchronous: number;
  busyTimeout: number;
}

interface EventRow {
  seq: number;
  id: string;
  schema_version: string;
  event_version: string;
  type: string;
  occurred_at: number;
  observed_at: number;
  recorded_at: number;
  actor_type: string;
  actor_id: string;
  session_id: string | null;
  trace_id: string | null;
  operation_id: string | null;
  source_json: string;
  payload_json: string;
  evidence_json: string | null;
  links_json: string | null;
  provenance_json: string | null;
  content_hash: string;
}

interface LastSeqRow {
  last_seq: number;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new StoreError("STORAGE_ERROR", `Stored ${field} is not a string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StoreError(
      "STORAGE_ERROR",
      `Stored ${field} is not a safe integer`,
    );
  }
  return value;
}

function readJson(value: string, field: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StoreError("STORAGE_ERROR", `Stored ${field} is not valid JSON`, {
      cause: message,
    });
  }
}

function readNullableJson(
  value: string | null,
  field: string,
): JsonValue | undefined {
  return value === null ? undefined : readJson(value, field);
}

function hashEvent(event: EventEnvelope): string {
  return createHash("sha256")
    .update(stableStringify(event as unknown as JsonValue))
    .digest("hex");
}

function epochMilliseconds(timestamp: string): number {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new StoreError(
      "INVALID_EVENT",
      `Invalid event timestamp: ${timestamp}`,
    );
  }
  return milliseconds;
}

function asEventRow(row: Record<string, unknown>): EventRow {
  return {
    seq: requireNumber(row.seq, "seq"),
    id: requireString(row.id, "id"),
    schema_version: requireString(row.schema_version, "schema_version"),
    event_version: requireString(row.event_version, "event_version"),
    type: requireString(row.type, "type"),
    occurred_at: requireNumber(row.occurred_at, "occurred_at"),
    observed_at: requireNumber(row.observed_at, "observed_at"),
    recorded_at: requireNumber(row.recorded_at, "recorded_at"),
    actor_type: requireString(row.actor_type, "actor_type"),
    actor_id: requireString(row.actor_id, "actor_id"),
    session_id:
      row.session_id === null
        ? null
        : requireString(row.session_id, "session_id"),
    trace_id:
      row.trace_id === null ? null : requireString(row.trace_id, "trace_id"),
    operation_id:
      row.operation_id === null
        ? null
        : requireString(row.operation_id, "operation_id"),
    source_json: requireString(row.source_json, "source_json"),
    payload_json: requireString(row.payload_json, "payload_json"),
    evidence_json:
      row.evidence_json === null
        ? null
        : requireString(row.evidence_json, "evidence_json"),
    links_json:
      row.links_json === null
        ? null
        : requireString(row.links_json, "links_json"),
    provenance_json:
      row.provenance_json === null
        ? null
        : requireString(row.provenance_json, "provenance_json"),
    content_hash: requireString(row.content_hash, "content_hash"),
  };
}

function rowToRecord(row: EventRow): EventRecord {
  if (row.provenance_json === null) {
    throw new StoreError(
      "STORAGE_ERROR",
      "Stored event is missing required provenance",
      { seq: row.seq },
    );
  }
  const provenance = readJson(
    row.provenance_json,
    "provenance_json",
  ) as unknown as Provenance;
  const envelope: EventEnvelope = {
    schemaVersion: row.schema_version as "1",
    eventVersion: row.event_version,
    id: row.id,
    type: row.type,
    occurredAt: new Date(row.occurred_at).toISOString(),
    observedAt: new Date(row.observed_at).toISOString(),
    recordedAt: new Date(row.recorded_at).toISOString(),
    actor: {
      type: row.actor_type as EventEnvelope["actor"]["type"],
      id: row.actor_id,
    },
    source: readJson(row.source_json, "source_json") as unknown as SourceRef,
    payload: readJson(row.payload_json, "payload_json"),
    provenance,
  };

  if (row.session_id !== null) envelope.sessionId = row.session_id;
  if (row.trace_id !== null) envelope.traceId = row.trace_id;
  if (row.operation_id !== null) envelope.operationId = row.operation_id;
  const evidence = readNullableJson(row.evidence_json, "evidence_json");
  const links = readNullableJson(row.links_json, "links_json");
  if (evidence !== undefined) {
    envelope.evidence = evidence as unknown as EvidenceRef[];
  }
  if (links !== undefined) {
    envelope.links = links as unknown as EventLinks;
  }

  const parsed = eventEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new StoreError(
      "STORAGE_ERROR",
      "Stored event failed contract validation",
      {
        issues: parsed.error.issues,
        seq: row.seq,
      },
    );
  }

  const normalized = parsed.data as EventEnvelope;
  const computedHash = hashEvent(normalized);
  if (row.content_hash !== computedHash) {
    throw new StoreError(
      "STORAGE_ERROR",
      "Stored event content hash mismatch",
      {
        expected: computedHash,
        actual: row.content_hash,
        seq: row.seq,
      },
    );
  }

  return {
    ...normalized,
    seq: row.seq,
    contentHash: row.content_hash,
  };
}

export class SqliteEventStore
  implements EventReader, EventWriter, EventBatchWriter, ProjectionPersistence
{
  readonly migrationVersion: number;
  readonly migrationStatus: MigrationStatus;
  readonly #database: DatabaseSyncConnection;
  #closed = false;

  private readonly selectByIdStatement;
  private readonly selectByOperationIdStatement;
  private readonly selectByOperationAndTypeStatement;
  private readonly selectBySeqStatement;
  private readonly selectLastSeqStatement;
  private readonly insertStatement;

  constructor(options: SqliteEventStoreOptions) {
    this.#database = new DatabaseSync(options.filename);
    try {
      this.configureConnection();
      const migrationOptions =
        options.migrationNow === undefined ? {} : { now: options.migrationNow };
      const migrationResult = new MigrationRunner(
        this.#database,
        options.migrationsDir,
        migrationOptions,
      ).run();
      this.migrationVersion = migrationResult.currentVersion;
      this.migrationStatus = {
        currentVersion: migrationResult.currentVersion,
        latestVersion: migrationResult.latestVersion,
        pendingVersions: migrationResult.pendingVersions,
      };

      this.selectByIdStatement = this.#database.prepare(
        "SELECT * FROM events WHERE id = ?",
      );
      this.selectByOperationIdStatement = this.#database.prepare(
        "SELECT * FROM events WHERE operation_id = ? ORDER BY seq ASC",
      );
      this.selectByOperationAndTypeStatement = this.#database.prepare(
        "SELECT * FROM events WHERE operation_id = ? AND type = ?",
      );
      this.selectBySeqStatement = this.#database.prepare(
        "SELECT * FROM events WHERE seq = ?",
      );
      this.selectLastSeqStatement = this.#database.prepare(
        "SELECT COALESCE(MAX(seq), 0) AS last_seq FROM events",
      );
      this.insertStatement = this.#database.prepare(`
        INSERT INTO events (
          id, schema_version, event_version, type,
          occurred_at, observed_at, recorded_at,
          actor_type, actor_id, session_id, trace_id, operation_id,
          source_json, payload_json, evidence_json, links_json,
          provenance_json, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  get pragmas(): SqlitePragmas {
    return {
      journalMode: this.readPragmaString("journal_mode"),
      foreignKeys: this.readPragmaInteger("foreign_keys"),
      synchronous: this.readPragmaInteger("synchronous"),
      busyTimeout: this.readPragmaInteger("busy_timeout"),
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      this.#database.close();
    }
  }

  append(event: EventEnvelope): EventAppendResult {
    return this.appendBatch([event])[0]!;
  }

  appendBatch(events: EventEnvelope[]): EventAppendResult[] {
    if (events.length === 0) return [];
    const normalizedEvents = events.map((event) => {
      const parsed = eventEnvelopeSchema.safeParse(event);
      if (!parsed.success) {
        throw new StoreError(
          "INVALID_EVENT",
          "Event does not satisfy the v1 envelope",
          {
            issues: parsed.error.issues,
          },
        );
      }
      const normalized = parsed.data as EventEnvelope;
      try {
        validatePhase3EventEnvelope(normalized);
      } catch (error) {
        throw new StoreError(
          "INVALID_EVENT",
          error instanceof Error ? error.message : String(error),
        );
      }
      return { normalized, contentHash: hashEvent(normalized) };
    });
    const results: EventAppendResult[] = [];
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      for (const { normalized, contentHash } of normalizedEvents) {
        const existingById = this.findById(normalized.id);
        if (existingById !== null) {
          this.assertSameEvent(existingById, contentHash, "EVENT_ID_CONFLICT");
          results.push({ record: existingById, inserted: false });
          continue;
        }

        if (normalized.operationId !== undefined) {
          const existingByOperationAndType = this.findByOperationAndType(
            normalized.operationId,
            normalized.type,
          );
          if (existingByOperationAndType !== null) {
            this.assertSameEvent(
              existingByOperationAndType,
              contentHash,
              "OPERATION_ID_CONFLICT",
            );
            results.push({
              record: existingByOperationAndType,
              inserted: false,
            });
            continue;
          }
        }

        const insertResult = this.insertStatement.run(
          normalized.id,
          normalized.schemaVersion,
          normalized.eventVersion,
          normalized.type,
          epochMilliseconds(normalized.occurredAt),
          epochMilliseconds(normalized.observedAt),
          epochMilliseconds(normalized.recordedAt),
          normalized.actor.type,
          normalized.actor.id,
          normalized.sessionId ?? null,
          normalized.traceId ?? null,
          normalized.operationId ?? null,
          stableStringify(normalized.source as unknown as JsonValue),
          stableStringify(normalized.payload),
          normalized.evidence === undefined
            ? null
            : stableStringify(normalized.evidence as unknown as JsonValue),
          normalized.links === undefined
            ? null
            : stableStringify(normalized.links as unknown as JsonValue),
          normalized.provenance === undefined
            ? null
            : stableStringify(normalized.provenance as unknown as JsonValue),
          contentHash,
        );
        const seq = Number(insertResult.lastInsertRowid);
        const row = this.selectBySeqStatement.get(seq);
        if (row === undefined) {
          throw new StoreError(
            "STORAGE_ERROR",
            "Inserted event could not be read back",
            {
              id: normalized.id,
              seq,
            },
          );
        }
        results.push({ record: rowToRecord(asEventRow(row)), inserted: true });
      }
      this.#database.exec("COMMIT");
      return results;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original error; the caller may close the connection.
      }
      if (error instanceof StoreError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoreError("STORAGE_ERROR", message);
    }
  }

  getById(id: string): EventRecord | null {
    return this.findById(id);
  }

  getByOperationId(operationId: string): EventRecord[] {
    return this.findByOperationId(operationId);
  }

  lookupOperationState(operationId: string): OperationState | null {
    const events = this.findByOperationId(operationId);
    if (events.length === 0) return null;

    let status: OperationStatus = "unknown";
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event === undefined) continue;
      if (
        event.type === "tool.requested" ||
        event.type === "tool.succeeded" ||
        event.type === "tool.failed"
      ) {
        status = event.type.slice("tool.".length) as Exclude<
          OperationStatus,
          "unknown"
        >;
        break;
      }
    }

    return { operationId, events, status };
  }

  query(query: EventQuery = {}): EventRecord[] {
    const clauses = ["1 = 1"];
    const parameters: Array<string | number> = [];

    if (query.afterSeq !== undefined) {
      this.assertCursor(query.afterSeq, "afterSeq");
      clauses.push("seq > ?");
      parameters.push(query.afterSeq);
    }
    if (query.beforeSeq !== undefined) {
      this.assertCursor(query.beforeSeq, "beforeSeq");
      clauses.push("seq < ?");
      parameters.push(query.beforeSeq);
    }
    if (query.type !== undefined) {
      this.assertNonEmpty(query.type, "type");
      clauses.push("type = ?");
      parameters.push(query.type);
    }
    if (query.sessionId !== undefined) {
      this.assertNonEmpty(query.sessionId, "sessionId");
      clauses.push("session_id = ?");
      parameters.push(query.sessionId);
    }
    if (query.traceId !== undefined) {
      this.assertNonEmpty(query.traceId, "traceId");
      clauses.push("trace_id = ?");
      parameters.push(query.traceId);
    }
    if (query.actor !== undefined) {
      this.assertActor(query.actor);
      clauses.push("actor_type = ? AND actor_id = ?");
      parameters.push(query.actor.type, query.actor.id);
    }

    const limit = query.limit ?? 1000;
    this.assertLimit(limit);
    parameters.push(limit);
    const rows = this.#database
      .prepare(
        `SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY seq ASC LIMIT ?`,
      )
      .all(...parameters) as Array<Record<string, unknown>>;
    return rows.map((row) => rowToRecord(asEventRow(row)));
  }

  getSince(seq: number, limit = 1000): EventRecord[] {
    return this.query({ afterSeq: seq, limit });
  }

  getLastSeq(): number {
    const row = this.selectLastSeqStatement.get() as LastSeqRow | undefined;
    if (row === undefined) {
      throw new StoreError(
        "STORAGE_ERROR",
        "Could not read last event sequence",
      );
    }
    return requireNumber(row.last_seq, "last_seq");
  }

  getProjectionState(projectionName: string): ProjectionStateRecord | null {
    this.assertNonEmpty(projectionName, "projectionName");
    const row = this.#database
      .prepare("SELECT * FROM projection_state WHERE projection_name = ?")
      .get(projectionName) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    const lastSeq = requireNumber(row.last_seq, "last_seq");
    this.assertLedgerCursor(lastSeq);
    return {
      projectionName: requireString(row.projection_name, "projection_name"),
      projectionVersion: requireNumber(
        row.projection_version,
        "projection_version",
      ),
      lastSeq,
      state: readJson(
        requireString(row.state_json, "state_json"),
        "state_json",
      ),
      updatedAt: requireNumber(row.updated_at, "updated_at"),
    };
  }

  saveProjectionState(
    record: ProjectionStateRecord,
    expectedLastSeq?: number,
  ): void {
    this.assertProjectionStateRecord(record);
    if (
      expectedLastSeq !== undefined &&
      (!Number.isSafeInteger(expectedLastSeq) || expectedLastSeq < 0)
    ) {
      throw new StoreError(
        "INVALID_EVENT",
        "expectedLastSeq must be a non-negative safe integer",
      );
    }
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.assertLedgerCursor(record.lastSeq);
      const existing = this.#database
        .prepare(
          "SELECT projection_version, last_seq, state_json, updated_at FROM projection_state WHERE projection_name = ?",
        )
        .get(record.projectionName) as Record<string, unknown> | undefined;
      if (existing === undefined) {
        if (expectedLastSeq !== undefined && expectedLastSeq !== 0) {
          throw new StoreError(
            "STORAGE_ERROR",
            "projection cursor compare-and-set failed: state is absent",
            { expectedLastSeq, actualLastSeq: null },
          );
        }
      } else {
        const actualVersion = requireNumber(
          existing.projection_version,
          "projection_version",
        );
        const actualLastSeq = requireNumber(existing.last_seq, "last_seq");
        const nextStateJson = stableStringify(record.state);
        const actualStateJson = requireString(
          existing.state_json,
          "state_json",
        );
        const actualUpdatedAt = requireNumber(
          existing.updated_at,
          "updated_at",
        );
        if (
          expectedLastSeq !== undefined &&
          actualLastSeq !== expectedLastSeq
        ) {
          throw new StoreError(
            "STORAGE_ERROR",
            "projection cursor compare-and-set failed",
            { expectedLastSeq, actualLastSeq },
          );
        }
        if (actualVersion !== record.projectionVersion) {
          throw new StoreError(
            "STORAGE_ERROR",
            "projection version changed during catch-up",
            {
              expectedVersion: record.projectionVersion,
              actualVersion,
            },
          );
        }
        if (actualLastSeq > record.lastSeq) {
          throw new StoreError(
            "STORAGE_ERROR",
            "stale projection state cannot overwrite a newer cursor",
            { actualLastSeq, incomingLastSeq: record.lastSeq },
          );
        }
        if (actualLastSeq === record.lastSeq) {
          if (
            actualStateJson !== nextStateJson ||
            actualUpdatedAt !== record.updatedAt
          ) {
            throw new StoreError(
              "STORAGE_ERROR",
              "projection state conflicts at the same cursor",
              { lastSeq: record.lastSeq },
            );
          }
          this.#database.exec("COMMIT");
          return;
        }
      }
      this.#database
        .prepare(
          `
          INSERT INTO projection_state (
            projection_name, projection_version, last_seq, state_json, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(projection_name) DO UPDATE SET
            projection_version = excluded.projection_version,
            last_seq = excluded.last_seq,
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          record.projectionName,
          record.projectionVersion,
          record.lastSeq,
          stableStringify(record.state),
          record.updatedAt,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original persistence error.
      }
      if (error instanceof StoreError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoreError("STORAGE_ERROR", message);
    }
  }

  replaceProjection(
    record: ProjectionStateRecord,
    data: ProjectionDataRecord[],
  ): void {
    this.assertProjectionStateRecord(record);
    for (const entity of data) this.assertProjectionDataRecord(entity, record);

    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.assertLedgerCursor(record.lastSeq);
      const existing = this.#database
        .prepare(
          "SELECT projection_version, last_seq, state_json, updated_at FROM projection_state WHERE projection_name = ?",
        )
        .get(record.projectionName) as Record<string, unknown> | undefined;
      if (existing !== undefined) {
        const actualVersion = requireNumber(
          existing.projection_version,
          "projection_version",
        );
        const actualLastSeq = requireNumber(existing.last_seq, "last_seq");
        if (record.projectionVersion < actualVersion) {
          throw new StoreError(
            "STORAGE_ERROR",
            "older projection version cannot replace a newer version",
            { actualVersion, incomingVersion: record.projectionVersion },
          );
        }
        if (record.lastSeq < actualLastSeq) {
          throw new StoreError(
            "STORAGE_ERROR",
            "stale projection rebuild cannot overwrite a newer cursor",
            { actualLastSeq, incomingLastSeq: record.lastSeq },
          );
        }
        if (
          record.projectionVersion === actualVersion &&
          record.lastSeq === actualLastSeq &&
          (requireString(existing.state_json, "state_json") !==
            stableStringify(record.state) ||
            requireNumber(existing.updated_at, "updated_at") !==
              record.updatedAt)
        ) {
          throw new StoreError(
            "STORAGE_ERROR",
            "projection rebuild conflicts at the same cursor",
            { lastSeq: record.lastSeq },
          );
        }
      }
      this.#database.exec(`
        CREATE TEMP TABLE IF NOT EXISTS projection_data_staging (
          projection_name TEXT NOT NULL,
          entity_key TEXT NOT NULL,
          projection_version INTEGER NOT NULL,
          last_seq INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (projection_name, entity_key)
        )
      `);
      this.#database.exec("DELETE FROM temp.projection_data_staging");
      const stagingInsert = this.#database.prepare(`
        INSERT INTO temp.projection_data_staging (
          projection_name, entity_key, projection_version,
          last_seq, state_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const entity of data) {
        stagingInsert.run(
          entity.projectionName,
          entity.entityKey,
          entity.projectionVersion,
          entity.lastSeq,
          stableStringify(entity.state),
          entity.updatedAt,
        );
      }
      this.#database
        .prepare(
          `
          INSERT INTO projection_state (
            projection_name, projection_version, last_seq, state_json, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(projection_name) DO UPDATE SET
            projection_version = excluded.projection_version,
            last_seq = excluded.last_seq,
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          record.projectionName,
          record.projectionVersion,
          record.lastSeq,
          stableStringify(record.state),
          record.updatedAt,
        );
      this.#database
        .prepare("DELETE FROM projection_data WHERE projection_name = ?")
        .run(record.projectionName);
      this.#database.exec(`
        INSERT INTO projection_data (
          projection_name, entity_key, projection_version,
          last_seq, state_json, updated_at
        )
        SELECT projection_name, entity_key, projection_version,
               last_seq, state_json, updated_at
        FROM temp.projection_data_staging
      `);
      this.#database.exec("DROP TABLE temp.projection_data_staging");
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original persistence error.
      }
      if (error instanceof StoreError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoreError("STORAGE_ERROR", message);
    }
  }

  clearProjectionData(projectionName: string): void {
    this.assertNonEmpty(projectionName, "projectionName");
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.#database
        .prepare("DELETE FROM projection_data WHERE projection_name = ?")
        .run(projectionName);
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original persistence error.
      }
      if (error instanceof StoreError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoreError("STORAGE_ERROR", message);
    }
  }

  getSnapshot(
    projectionName: string,
    projectionVersion: number,
  ): SnapshotRecord | null {
    this.assertNonEmpty(projectionName, "projectionName");
    this.assertVersion(projectionVersion, "projectionVersion");
    const row = this.#database
      .prepare(
        `
        SELECT * FROM snapshots
        WHERE projection_name = ? AND projection_version = ?
        ORDER BY cursor_seq DESC
        LIMIT 1
      `,
      )
      .get(projectionName, projectionVersion) as
      Record<string, unknown> | undefined;
    if (row === undefined) return null;
    const cursorSeq = requireNumber(row.cursor_seq, "cursor_seq");
    this.assertLedgerCursor(cursorSeq);
    return {
      id: requireString(row.id, "id"),
      projectionName: requireString(row.projection_name, "projection_name"),
      projectionVersion: requireNumber(
        row.projection_version,
        "projection_version",
      ),
      cursorSeq,
      state: readJson(
        requireString(row.state_json, "state_json"),
        "state_json",
      ),
      createdAt: requireNumber(row.created_at, "created_at"),
    };
  }

  saveSnapshot(record: SnapshotRecord): void {
    this.assertSnapshotRecord(record);
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.assertLedgerCursor(record.cursorSeq);
      const existing = this.#database
        .prepare(
          "SELECT projection_name, projection_version, cursor_seq, state_json, created_at FROM snapshots WHERE id = ?",
        )
        .get(record.id) as Record<string, unknown> | undefined;
      if (existing !== undefined) {
        const same =
          requireString(existing.projection_name, "projection_name") ===
            record.projectionName &&
          requireNumber(existing.projection_version, "projection_version") ===
            record.projectionVersion &&
          requireNumber(existing.cursor_seq, "cursor_seq") ===
            record.cursorSeq &&
          requireString(existing.state_json, "state_json") ===
            stableStringify(record.state) &&
          requireNumber(existing.created_at, "created_at") === record.createdAt;
        if (!same) {
          throw new StoreError(
            "STORAGE_ERROR",
            "snapshot id conflicts with existing snapshot content",
            { id: record.id },
          );
        }
        this.#database.exec("COMMIT");
        return;
      }
      this.#database
        .prepare(
          `
          INSERT INTO snapshots (
            id, projection_name, projection_version, cursor_seq, state_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            projection_name = excluded.projection_name,
            projection_version = excluded.projection_version,
            cursor_seq = excluded.cursor_seq,
            state_json = excluded.state_json,
            created_at = excluded.created_at
        `,
        )
        .run(
          record.id,
          record.projectionName,
          record.projectionVersion,
          record.cursorSeq,
          stableStringify(record.state),
          record.createdAt,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original persistence error.
      }
      if (error instanceof StoreError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoreError("STORAGE_ERROR", message);
    }
  }

  private configureConnection(): void {
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA synchronous = FULL");
  }

  private readPragmaString(name: string): string {
    const row = this.#database.prepare(`PRAGMA ${name}`).get() as Record<
      string,
      unknown
    >;
    const value = Object.values(row)[0];
    return requireString(value, `PRAGMA ${name}`);
  }

  private readPragmaInteger(name: string): number {
    const row = this.#database.prepare(`PRAGMA ${name}`).get() as Record<
      string,
      unknown
    >;
    const value = Object.values(row)[0];
    return requireNumber(value, `PRAGMA ${name}`);
  }

  private findById(id: string): EventRecord | null {
    const row = this.selectByIdStatement.get(id);
    return row === undefined ? null : rowToRecord(asEventRow(row));
  }

  private findByOperationId(operationId: string): EventRecord[] {
    return (
      this.selectByOperationIdStatement.all(operationId) as Array<
        Record<string, unknown>
      >
    ).map((row) => rowToRecord(asEventRow(row)));
  }

  private findByOperationAndType(
    operationId: string,
    type: string,
  ): EventRecord | null {
    const row = this.selectByOperationAndTypeStatement.get(operationId, type);
    return row === undefined ? null : rowToRecord(asEventRow(row));
  }

  private assertCursor(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StoreError(
        "INVALID_EVENT",
        `${field} cursor must be a non-negative safe integer`,
      );
    }
  }

  private assertLedgerCursor(cursorSeq: number): void {
    this.assertCursor(cursorSeq, "ledger");
    const ledgerLastSeq = this.getLastSeq();
    if (cursorSeq > ledgerLastSeq) {
      throw new StoreError(
        "STORAGE_ERROR",
        "derived cursor cannot be ahead of the event ledger",
        { cursorSeq, ledgerLastSeq },
      );
    }
  }

  private assertLimit(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
      throw new StoreError(
        "INVALID_EVENT",
        "limit must be an integer between 1 and 10000",
      );
    }
  }

  private assertVersion(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new StoreError(
        "INVALID_EVENT",
        `${field} must be a positive safe integer`,
      );
    }
  }

  private assertProjectionStateRecord(record: ProjectionStateRecord): void {
    this.assertNonEmpty(record.projectionName, "projectionName");
    this.assertVersion(record.projectionVersion, "projectionVersion");
    this.assertCursor(record.lastSeq, "lastSeq");
    this.assertCursor(record.updatedAt, "updatedAt");
  }

  private assertProjectionDataRecord(
    record: ProjectionDataRecord,
    state: ProjectionStateRecord,
  ): void {
    this.assertNonEmpty(record.projectionName, "projectionName");
    this.assertNonEmpty(record.entityKey, "entityKey");
    if (record.projectionName !== state.projectionName) {
      throw new StoreError(
        "INVALID_EVENT",
        "Projection data belongs to a different projection",
      );
    }
    if (record.projectionVersion !== state.projectionVersion) {
      throw new StoreError(
        "INVALID_EVENT",
        "Projection data version does not match projection state",
      );
    }
    if (record.lastSeq > state.lastSeq) {
      throw new StoreError(
        "INVALID_EVENT",
        "Projection data cursor cannot be ahead of projection state",
      );
    }
    this.assertCursor(record.lastSeq, "lastSeq");
    this.assertCursor(record.updatedAt, "updatedAt");
  }

  private assertSnapshotRecord(record: SnapshotRecord): void {
    this.assertNonEmpty(record.id, "id");
    this.assertNonEmpty(record.projectionName, "projectionName");
    this.assertVersion(record.projectionVersion, "projectionVersion");
    this.assertCursor(record.cursorSeq, "cursorSeq");
    this.assertCursor(record.createdAt, "createdAt");
  }

  private assertNonEmpty(value: string, field: string): void {
    if (value.length < 1) {
      throw new StoreError("INVALID_EVENT", `${field} must not be empty`);
    }
  }

  private assertActor(actor: ActorRef): void {
    if (
      !["human", "agent", "system", "tool", "model"].includes(actor.type) ||
      actor.id.length < 1
    ) {
      throw new StoreError("INVALID_EVENT", "actor filter is invalid");
    }
  }

  private assertSameEvent(
    record: EventRecord,
    contentHash: string,
    conflictCode: "EVENT_ID_CONFLICT" | "OPERATION_ID_CONFLICT",
  ): void {
    if (record.contentHash !== contentHash) {
      throw new StoreError(
        conflictCode,
        "Idempotency key refers to a different event",
        {
          existingEventId: record.id,
          existingSeq: record.seq,
        },
      );
    }
  }
}
