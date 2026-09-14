import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncConnection } from "node:sqlite";
import type * as Sqlite from "node:sqlite";

import { eventEnvelopeSchema, stableStringify } from "@praxis/contracts";
import type {
  ActorRef,
  EventAppendResult,
  EventEnvelope,
  EventLinks,
  EventQuery,
  EventReader,
  EventRecord,
  EventWriter,
  EvidenceRef,
  OperationState,
  OperationStatus,
  SourceRef,
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

export class SqliteEventStore implements EventReader, EventWriter {
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
    const contentHash = hashEvent(normalized);
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const existingById = this.findById(normalized.id);
      if (existingById !== null) {
        this.assertSameEvent(existingById, contentHash, "EVENT_ID_CONFLICT");
        this.#database.exec("COMMIT");
        return { record: existingById, inserted: false };
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
          this.#database.exec("COMMIT");
          return { record: existingByOperationAndType, inserted: false };
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
      const record = rowToRecord(asEventRow(row));
      this.#database.exec("COMMIT");
      return { record, inserted: true };
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

  private assertLimit(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
      throw new StoreError(
        "INVALID_EVENT",
        "limit must be an integer between 1 and 10000",
      );
    }
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
