import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncConnection } from "node:sqlite";
import type * as Sqlite from "node:sqlite";

import {
  AuthorizationError,
  authorizeHumanControl,
  authorizeEventAppend,
  authorizeWriterScope,
  eventEnvelopeSchema,
  parseWriterContext,
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
  LedgerSeqGap,
  OperationState,
  OperationStatus,
  ProjectionDataRecord,
  ProjectionPersistence,
  ProjectionStateRecord,
  SourceRef,
  SnapshotRecord,
  Provenance,
  JsonValue,
  WriterContext,
} from "@praxis/contracts";

import { StoreError } from "./errors.js";
import { MigrationRunner } from "./migrations.js";
import type { MigrationStatus } from "./migrations.js";

type DatabaseSyncConstructor = typeof Sqlite.DatabaseSync;
const requireModule = createRequire(import.meta.url);
const { DatabaseSync } = requireModule("node:sqlite") as {
  DatabaseSync: DatabaseSyncConstructor;
};

function sha256File(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertTimestampMilliseconds(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StoreError(
      "STORAGE_ERROR",
      `${field} must be a non-negative safe integer`,
    );
  }
}

function validateSqliteFile(filename: string): number {
  if (!existsSync(filename)) {
    throw new StoreError(
      "STORAGE_ERROR",
      `SQLite file does not exist: ${filename}`,
    );
  }
  const database = new DatabaseSync(filename);
  try {
    const integrityRow = database.prepare("PRAGMA integrity_check").get() as
      Record<string, unknown> | undefined;
    const integrity =
      integrityRow === undefined ? undefined : Object.values(integrityRow)[0];
    if (integrity !== "ok") {
      throw new StoreError("STORAGE_ERROR", "SQLite integrity check failed", {
        filename,
        integrity,
      });
    }
    const row = database
      .prepare("SELECT COALESCE(MAX(seq), 0) AS last_seq FROM events")
      .get() as Record<string, unknown> | undefined;
    const lastSeq = row === undefined ? 0 : Object.values(row)[0];
    if (
      typeof lastSeq !== "number" ||
      !Number.isSafeInteger(lastSeq) ||
      lastSeq < 0
    ) {
      throw new StoreError(
        "STORAGE_ERROR",
        "SQLite backup has an invalid last sequence",
        {
          filename,
          lastSeq,
        },
      );
    }
    return lastSeq;
  } finally {
    database.close();
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function eventReferences(
  event: EventRecord,
  identifiers: Set<string>,
): boolean {
  const linkValues = Object.values(event.links ?? {}).flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
  const evidenceEventIds = (event.evidence ?? []).flatMap((evidence) =>
    evidence.eventId === undefined ? [] : [evidence.eventId],
  );
  const explicitReferences = [
    event.id,
    event.operationId,
    event.traceId,
    event.source.ref,
    ...linkValues,
    ...evidenceEventIds,
  ].filter((value): value is string => typeof value === "string");
  return explicitReferences.some((value) => identifiers.has(value));
}

function sequenceRanges(
  seqs: number[],
): Array<{ startSeq: number; endSeq: number }> {
  const ordered = [...seqs].sort((left, right) => left - right);
  const ranges: Array<{ startSeq: number; endSeq: number }> = [];
  for (const seq of ordered) {
    const previous = ranges.at(-1);
    if (previous === undefined || seq > previous.endSeq + 1) {
      ranges.push({ startSeq: seq, endSeq: seq });
    } else if (seq > previous.endSeq) {
      previous.endSeq = seq;
    }
  }
  return ranges;
}

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

export interface BackupManifest {
  schemaVersion: "1";
  id: string;
  path: string;
  createdAt: number;
  firstEventSeq: number;
  lastEventSeq: number;
  projectionVersions: Record<string, number>;
  sourceDbSha256: string;
  backupSha256: string;
}

export interface BackupOptions {
  id?: string;
  createdAt?: number;
}

export interface ManagedBackup extends BackupManifest {
  status: "active" | "purge-pending" | "deleted";
  pendingPath?: string;
  purgedAt?: number;
}

export interface ProjectionHealth {
  projectionName: string;
  projectionVersion: number;
  lastSeq: number;
  lag: number;
}

export interface StoreHealth {
  filename: string;
  pragmas: SqlitePragmas;
  lastSeq: number;
  writerBackfillCount: number;
  projections: ProjectionHealth[];
  orphanVerificationCount: number;
  pendingPurgeCount: number;
  managedBackups: {
    active: number;
    purgePending: number;
    deleted: number;
    missingFiles: string[];
    invalidChecksums: string[];
  };
  invalidatedAssetCount: number;
  purgedSeqRanges: LedgerSeqGap[];
  walCheckpoint: { busy: number; log: number; checkpointed: number };
}

export interface PrivacyPurgePlan {
  schemaVersion: "1";
  scope: { type: "session"; value: string };
  eventIds: string[];
  eventSeqs: number[];
  ledgerLastSeq: number;
  seqRanges: Array<{ startSeq: number; endSeq: number }>;
  affectedAssetIds: string[];
  invalidatedProjectionNames: string[];
  invalidatedSnapshotCount: number;
  managedBackupIds: string[];
  planHash: string;
}

export interface PrivacyPurgeReceipt {
  receiptId: string;
  planHash: string;
  scope: { type: "session"; value: string };
  deletedEventCount: number;
  deletedSeqRanges: Array<{ startSeq: number; endSeq: number }>;
  invalidatedAssetIds: string[];
  managedBackupIds: string[];
  executedAt: number;
  writerId: string;
}

export interface PrivacyPurgeResult {
  dryRun: boolean;
  plan: PrivacyPurgePlan;
  receipt?: PrivacyPurgeReceipt;
  cleanup?: PurgeCleanupResult;
}

export interface PurgeCleanupResult {
  finalizedBackupIds: string[];
  pendingBackupIds: string[];
}

export interface PrivacyPurgeOptions {
  confirm?: boolean;
  preserveManagedBackups?: boolean;
  executedAt?: number;
}

export interface RestoreDatabaseOptions {
  sourcePath: string;
  destinationPath: string;
  safetyBackupPath?: string;
  expectedSha256?: string;
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
  writer_json: string | null;
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
    writer_json:
      row.writer_json === undefined || row.writer_json === null
        ? null
        : requireString(row.writer_json, "writer_json"),
    content_hash: requireString(row.content_hash, "content_hash"),
  };
}

function rowToRecord(
  row: EventRow,
  fallbackWriter?: WriterContext,
): EventRecord {
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
  if (row.writer_json === null && fallbackWriter === undefined) {
    throw new StoreError(
      "STORAGE_ERROR",
      "Stored event is missing required writer provenance",
      { seq: row.seq },
    );
  }
  let writer: WriterContext;
  try {
    writer =
      row.writer_json === null
        ? parseWriterContext(fallbackWriter)
        : parseWriterContext(readJson(row.writer_json, "writer_json"));
  } catch (error) {
    throw new StoreError(
      "STORAGE_ERROR",
      "Stored writer failed contract validation",
      {
        seq: row.seq,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
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
    writer,
  };
}

export class SqliteEventStore
  implements EventReader, EventWriter, EventBatchWriter, ProjectionPersistence
{
  readonly filename: string;
  readonly migrationVersion: number;
  readonly migrationStatus: MigrationStatus;
  readonly #database: DatabaseSyncConnection;
  readonly #hasWriterColumn: boolean;
  #closed = false;

  private readonly selectByIdStatement;
  private readonly selectByOperationIdStatement;
  private readonly selectByOperationAndTypeStatement;
  private readonly selectBySeqStatement;
  private readonly selectLastSeqStatement;
  private readonly insertStatement;

  constructor(options: SqliteEventStoreOptions) {
    this.filename = options.filename;
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
      this.#hasWriterColumn = this.#database
        .prepare("PRAGMA table_info(events)")
        .all()
        .some((row) => (row as Record<string, unknown>).name === "writer_json");
      this.insertStatement = this.#database.prepare(
        this.#hasWriterColumn
          ? `
        INSERT INTO events (
          id, schema_version, event_version, type,
          occurred_at, observed_at, recorded_at,
          actor_type, actor_id, session_id, trace_id, operation_id,
          source_json, payload_json, evidence_json, links_json,
          provenance_json, writer_json, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
          : `
        INSERT INTO events (
          id, schema_version, event_version, type,
          occurred_at, observed_at, recorded_at,
          actor_type, actor_id, session_id, trace_id, operation_id,
          source_json, payload_json, evidence_json, links_json,
          provenance_json, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      );
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

  backupTo(
    destinationPath: string,
    options: BackupOptions = {},
  ): BackupManifest {
    this.assertOpen();
    const sourcePath = resolve(this.filename);
    const targetPath = resolve(destinationPath);
    if (sourcePath === targetPath) {
      throw new StoreError(
        "STORAGE_ERROR",
        "backup destination must differ from the active database",
      );
    }
    if (existsSync(targetPath)) {
      throw new StoreError(
        "STORAGE_ERROR",
        "backup destination already exists",
        {
          destinationPath: targetPath,
        },
      );
    }
    if (!existsSync(dirname(targetPath))) {
      throw new StoreError(
        "STORAGE_ERROR",
        "backup destination directory does not exist",
        {
          destinationPath: targetPath,
        },
      );
    }
    const createdAt = options.createdAt ?? Date.now();
    assertTimestampMilliseconds(createdAt, "backup createdAt");
    const backupId = options.id ?? `backup:${createdAt}:${randomUUID()}`;
    if (backupId.length < 1) {
      throw new StoreError("STORAGE_ERROR", "backup id must not be empty");
    }
    const lastEventSeq = this.getLastSeq();
    const sourceDbSha256 = sha256File(sourcePath);
    try {
      // VACUUM INTO is SQLite's portable online snapshot operation for the
      // supported Node 22.13 baseline. A raw copy of a live WAL database is
      // deliberately not used.
      this.#database.exec(`VACUUM INTO ${sqlStringLiteral(targetPath)}`);
      const backupLastSeq = validateSqliteFile(targetPath);
      if (backupLastSeq !== lastEventSeq) {
        unlinkSync(targetPath);
        throw new StoreError(
          "STORAGE_ERROR",
          "backup sequence does not match the source snapshot",
          {
            sourceLastSeq: lastEventSeq,
            backupLastSeq,
          },
        );
      }
    } catch (error) {
      if (existsSync(targetPath)) {
        try {
          unlinkSync(targetPath);
        } catch {
          // Preserve the original backup failure; doctor will surface the fragment.
        }
      }
      if (error instanceof StoreError) throw error;
      throw new StoreError("STORAGE_ERROR", "SQLite online backup failed", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      schemaVersion: "1",
      id: backupId,
      path: targetPath,
      createdAt,
      firstEventSeq: lastEventSeq === 0 ? 0 : 1,
      lastEventSeq,
      projectionVersions: this.getProjectionVersions(),
      sourceDbSha256,
      backupSha256: sha256File(targetPath),
    };
  }

  createManagedBackup(
    destinationPath: string,
    writer: WriterContext,
    options: BackupOptions = {},
  ): BackupManifest {
    let authorized: WriterContext;
    try {
      authorized = authorizeWriterScope(
        writer,
        "history.export",
        "managed backup creation",
      );
    } catch (error) {
      throw this.authorizationStoreError(error);
    }
    const manifest = this.backupTo(destinationPath, options);
    this.registerManagedBackup(manifest, authorized);
    return manifest;
  }

  registerManagedBackup(manifest: BackupManifest, writer: WriterContext): void {
    let authorized: WriterContext;
    try {
      authorized = authorizeWriterScope(
        writer,
        "history.export",
        "managed backup registration",
      );
    } catch (error) {
      throw this.authorizationStoreError(error);
    }
    this.assertOpen();
    if (manifest.path !== resolve(manifest.path)) {
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup path must be absolute",
      );
    }
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const existing = this.#database
        .prepare("SELECT * FROM managed_backups WHERE backup_id = ?")
        .get(manifest.id) as Record<string, unknown> | undefined;
      if (existing !== undefined) {
        const same =
          existing.path === manifest.path &&
          existing.backup_sha256 === manifest.backupSha256;
        if (!same) {
          throw new StoreError(
            "STORAGE_ERROR",
            "managed backup id conflicts with existing metadata",
            {
              backupId: manifest.id,
            },
          );
        }
        this.#database.exec("COMMIT");
        return;
      }
      this.#database
        .prepare(
          `INSERT INTO managed_backups (
             backup_id, schema_version, path, created_at,
             first_event_seq, last_event_seq, projection_versions_json,
             source_db_sha256, backup_sha256, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        )
        .run(
          manifest.id,
          manifest.schemaVersion,
          manifest.path,
          manifest.createdAt,
          manifest.firstEventSeq,
          manifest.lastEventSeq,
          stableStringify(manifest.projectionVersions as unknown as JsonValue),
          manifest.sourceDbSha256,
          manifest.backupSha256,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original registration error.
      }
      if (error instanceof StoreError) throw error;
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup registration failed",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
    void authorized;
  }

  listManagedBackups(): ManagedBackup[] {
    this.assertOpen();
    const rows = this.#database
      .prepare(
        "SELECT * FROM managed_backups ORDER BY created_at ASC, backup_id ASC",
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.managedBackupFromRow(row));
  }

  planPrivacyPurge(sessionId: string): PrivacyPurgePlan {
    this.assertOpen();
    this.assertNonEmpty(sessionId, "sessionId");
    const events = this.readAllEvents();
    const targets = new Set<number>();
    const identifiers = new Set<string>([sessionId]);
    const traceIds = new Set<string>();
    for (const event of events) {
      if (event.sessionId !== sessionId) continue;
      targets.add(event.seq);
      identifiers.add(event.id);
      if (event.operationId !== undefined) identifiers.add(event.operationId);
      if (event.traceId !== undefined) {
        identifiers.add(event.traceId);
        traceIds.add(event.traceId);
      }
      if (event.source.ref !== undefined) identifiers.add(event.source.ref);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const event of events) {
        if (
          targets.has(event.seq) ||
          event.sessionId === sessionId ||
          (event.traceId !== undefined && traceIds.has(event.traceId)) ||
          eventReferences(event, identifiers)
        ) {
          if (targets.has(event.seq)) continue;
          targets.add(event.seq);
          changed = true;
          identifiers.add(event.id);
          if (event.operationId !== undefined)
            identifiers.add(event.operationId);
          if (event.traceId !== undefined) {
            identifiers.add(event.traceId);
            traceIds.add(event.traceId);
          }
          if (event.source.ref !== undefined) identifiers.add(event.source.ref);
        }
      }
    }
    const targetEvents = events.filter((event) => targets.has(event.seq));
    const eventSeqs = targetEvents.map((event) => event.seq);
    const eventIds = targetEvents.map((event) => event.id);
    const affectedAssetIds = new Set<string>();
    for (const event of targetEvents) {
      for (const evidence of event.evidence ?? []) {
        if (evidence.assetId !== undefined)
          affectedAssetIds.add(evidence.assetId);
      }
      if (event.type.startsWith("asset.")) {
        const payload = asObject(event.payload);
        if (typeof payload?.id === "string") affectedAssetIds.add(payload.id);
      }
    }
    const projectionNames = this.#database
      .prepare(
        `SELECT projection_name FROM projection_state
         UNION
         SELECT projection_name FROM projection_data
         ORDER BY projection_name ASC`,
      )
      .all()
      .map((row) => String((row as Record<string, unknown>).projection_name));
    const snapshotCount = Number(
      Object.values(
        this.#database
          .prepare("SELECT COUNT(*) AS count FROM snapshots")
          .get() as Record<string, unknown>,
      )[0],
    );
    const ranges = sequenceRanges(eventSeqs);
    const managedBackupIds = this.listManagedBackups()
      .filter(
        (backup) =>
          backup.status !== "deleted" &&
          ranges.some(
            (range) =>
              backup.firstEventSeq <= range.endSeq &&
              backup.lastEventSeq >= range.startSeq,
          ),
      )
      .map((backup) => backup.id)
      .sort();
    const planWithoutHash = {
      schemaVersion: "1" as const,
      scope: { type: "session" as const, value: sessionId },
      eventIds,
      eventSeqs,
      ledgerLastSeq: this.getLastSeq(),
      seqRanges: ranges,
      affectedAssetIds: [...affectedAssetIds].sort(),
      invalidatedProjectionNames: projectionNames,
      invalidatedSnapshotCount: Number.isSafeInteger(snapshotCount)
        ? snapshotCount
        : 0,
      managedBackupIds,
    };
    const planHash = createHash("sha256")
      .update(stableStringify(planWithoutHash as unknown as JsonValue))
      .digest("hex");
    return { ...planWithoutHash, planHash };
  }

  privacyPurge(
    sessionId: string,
    writer: WriterContext,
    options: PrivacyPurgeOptions = {},
  ): PrivacyPurgeResult {
    let authorized: WriterContext;
    try {
      authorized = authorizeHumanControl(
        writer,
        "privacy purge",
        "history.purge",
      );
    } catch (error) {
      throw this.authorizationStoreError(error);
    }
    const plan = this.planPrivacyPurge(sessionId);
    if (options.confirm !== true) return { dryRun: true, plan };
    if (plan.eventSeqs.length === 0) {
      return {
        dryRun: false,
        plan,
        cleanup: this.finalizePendingPurgeAuthorized(authorized),
      };
    }
    const executedAt = options.executedAt ?? Date.now();
    assertTimestampMilliseconds(executedAt, "purge executedAt");
    const preserveManagedBackups = options.preserveManagedBackups ?? false;
    const managedBackups = this.listManagedBackups().filter((backup) =>
      plan.managedBackupIds.includes(backup.id),
    );
    const purgeToken = `purge-${randomUUID()}`;
    const pendingBackups: Array<{
      backup: ManagedBackup;
      sourcePath: string;
    }> = [];
    if (!preserveManagedBackups) {
      for (const backup of managedBackups) {
        const sourcePath = backup.pendingPath ?? backup.path;
        if (!existsSync(sourcePath)) {
          throw new StoreError(
            "STORAGE_ERROR",
            "managed backup file is missing; purge stopped",
            {
              backupId: backup.id,
              path: sourcePath,
            },
          );
        }
        // Do not rename a backup before the purge transaction commits. The
        // database row is the recovery journal; a pre-transaction rename can
        // leave an untracked fragment after a process crash.
        pendingBackups.push({ backup, sourcePath });
      }
    }
    const receiptId = `purge-receipt:${randomUUID()}`;
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      if (this.getLastSeq() !== plan.ledgerLastSeq) {
        throw new StoreError(
          "STORAGE_ERROR",
          "purge plan is stale; run dry-run again",
        );
      }
      this.#database
        .prepare(
          `INSERT INTO privacy_purge_authorizations (
             token, writer_id, scope_type, scope_value, created_at, active
           ) VALUES (?, ?, 'session', ?, ?, 1)`,
        )
        .run(purgeToken, authorized.writerId, sessionId, executedAt);
      this.#database
        .prepare(
          `INSERT INTO purge_receipts (
             receipt_id, scope_type, scope_value, executed_at, writer_id,
             deleted_event_count, deleted_seq_ranges_json, plan_hash,
             managed_backup_ids_json
           ) VALUES (?, 'session', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          receiptId,
          sessionId,
          executedAt,
          authorized.writerId,
          plan.eventSeqs.length,
          stableStringify(plan.seqRanges as unknown as JsonValue),
          plan.planHash,
          stableStringify(plan.managedBackupIds as unknown as JsonValue),
        );
      for (const range of plan.seqRanges) {
        this.#database
          .prepare(
            "INSERT INTO purged_seq_ranges(start_seq, end_seq, receipt_id) VALUES (?, ?, ?)",
          )
          .run(range.startSeq, range.endSeq, receiptId);
      }
      for (const assetId of plan.affectedAssetIds) {
        this.#database
          .prepare(
            `INSERT INTO purge_asset_invalidations(
               asset_id, receipt_id, invalidated_at, reason, source_event_ids_json
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            assetId,
            receiptId,
            executedAt,
            "source event removed by user-authorized privacy purge",
            stableStringify(plan.eventIds as unknown as JsonValue),
          );
      }
      if (!preserveManagedBackups) {
        for (const item of pendingBackups) {
          this.#database
            .prepare(
              `UPDATE managed_backups
               SET status = 'purge-pending', pending_path = ?, purged_at = ?
               WHERE backup_id = ?`,
            )
            .run(item.sourcePath, executedAt, item.backup.id);
        }
      }
      this.#database.exec("DELETE FROM snapshots");
      this.#database.exec("DELETE FROM projection_data");
      this.#database.exec("DELETE FROM projection_state");
      const placeholders = plan.eventSeqs.map(() => "?").join(", ");
      this.#database
        .prepare(`DELETE FROM events WHERE seq IN (${placeholders})`)
        .run(...plan.eventSeqs);
      this.#database
        .prepare(
          "UPDATE privacy_purge_authorizations SET active = 0 WHERE token = ?",
        )
        .run(purgeToken);
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original purge failure.
      }
      if (error instanceof StoreError) throw error;
      throw new StoreError("STORAGE_ERROR", "privacy purge failed", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const cleanup = preserveManagedBackups
      ? undefined
      : this.finalizePendingPurgeAuthorized(authorized);
    return {
      dryRun: false,
      plan,
      ...(cleanup === undefined ? {} : { cleanup }),
      receipt: {
        receiptId,
        planHash: plan.planHash,
        scope: plan.scope,
        deletedEventCount: plan.eventSeqs.length,
        deletedSeqRanges: plan.seqRanges,
        invalidatedAssetIds: plan.affectedAssetIds,
        managedBackupIds: plan.managedBackupIds,
        executedAt,
        writerId: authorized.writerId,
      },
    };
  }

  finalizePendingPurge(writer: WriterContext): PurgeCleanupResult {
    let authorized: WriterContext;
    try {
      authorized = authorizeHumanControl(
        writer,
        "finalize pending privacy purge cleanup",
        "history.purge",
      );
    } catch (error) {
      throw this.authorizationStoreError(error);
    }
    return this.finalizePendingPurgeAuthorized(authorized);
  }

  private finalizePendingPurgeAuthorized(
    _writer: WriterContext,
  ): PurgeCleanupResult {
    this.assertOpen();
    const pending = this.listManagedBackups().filter(
      (backup) => backup.status === "purge-pending",
    );
    const finalizedBackupIds: string[] = [];
    const pendingBackupIds: string[] = [];
    for (const backup of pending) {
      const path = backup.pendingPath ?? backup.path;
      try {
        if (existsSync(path)) unlinkSync(path);
        finalizedBackupIds.push(backup.id);
      } catch {
        pendingBackupIds.push(backup.id);
      }
    }
    if (finalizedBackupIds.length > 0) {
      try {
        this.#database.exec("BEGIN IMMEDIATE");
        const placeholders = finalizedBackupIds.map(() => "?").join(", ");
        this.#database
          .prepare(
            `UPDATE managed_backups
             SET status = 'deleted', pending_path = NULL
             WHERE status = 'purge-pending' AND backup_id IN (${placeholders})`,
          )
          .run(...finalizedBackupIds);
        this.#database.exec("COMMIT");
      } catch {
        try {
          this.#database.exec("ROLLBACK");
        } catch {
          // The database health check will retain the pending cleanup signal.
        }
        pendingBackupIds.push(...finalizedBackupIds);
        finalizedBackupIds.length = 0;
      }
    }
    return {
      finalizedBackupIds: [...new Set(finalizedBackupIds)].sort(),
      pendingBackupIds: [...new Set(pendingBackupIds)].sort(),
    };
  }

  getPurgedSeqRanges(): LedgerSeqGap[] {
    this.assertOpen();
    const rows = this.#database
      .prepare(
        "SELECT start_seq, end_seq, receipt_id FROM purged_seq_ranges ORDER BY start_seq ASC",
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      startSeq: this.requireRowInteger(row.start_seq, "start_seq"),
      endSeq: this.requireRowInteger(row.end_seq, "end_seq"),
      receiptId: this.requireRowString(row.receipt_id, "receipt_id"),
    }));
  }

  getHealth(): StoreHealth {
    this.assertOpen();
    const lastSeq = this.getLastSeq();
    const checkpoint = this.readWalCheckpoint();
    const managedBackups = this.listManagedBackups();
    const activeBackups = managedBackups.filter(
      (item) => item.status === "active",
    );
    const missingFiles = activeBackups
      .filter((item) => !existsSync(item.path))
      .map((item) => item.id);
    const invalidChecksums = activeBackups
      .filter((item) => {
        if (!existsSync(item.path)) return false;
        try {
          return sha256File(item.path) !== item.backupSha256;
        } catch {
          return true;
        }
      })
      .map((item) => item.id);
    const invalidatedAssetCount = this.requireRowInteger(
      Object.values(
        this.#database
          .prepare(
            "SELECT COUNT(DISTINCT asset_id) AS count FROM purge_asset_invalidations",
          )
          .get() as Record<string, unknown>,
      )[0],
      "invalidated asset count",
    );
    return {
      filename: resolve(this.filename),
      pragmas: this.pragmas,
      lastSeq,
      writerBackfillCount: this.getWriterBackfillCount(),
      projections: this.getProjectionHealth(lastSeq),
      orphanVerificationCount: this.getOrphanVerificationCount(),
      pendingPurgeCount: this.getPendingPurgeCount(),
      managedBackups: {
        active: managedBackups.filter((item) => item.status === "active")
          .length,
        purgePending: managedBackups.filter(
          (item) => item.status === "purge-pending",
        ).length,
        deleted: managedBackups.filter((item) => item.status === "deleted")
          .length,
        missingFiles,
        invalidChecksums,
      },
      invalidatedAssetCount,
      purgedSeqRanges: this.getPurgedSeqRanges(),
      walCheckpoint: checkpoint,
    };
  }

  append(event: EventEnvelope, writer: WriterContext): EventAppendResult {
    return this.appendBatch([event], writer)[0]!;
  }

  appendBatch(
    events: EventEnvelope[],
    writer: WriterContext,
  ): EventAppendResult[] {
    if (events.length === 0) return [];
    let authorizedWriter: WriterContext;
    try {
      authorizedWriter = parseWriterContext(writer);
      for (const event of events) {
        authorizeEventAppend(authorizedWriter, event.type);
      }
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw new StoreError(
          "AUTHORIZATION_ERROR",
          error.message,
          error.details,
        );
      }
      throw new StoreError(
        "AUTHORIZATION_ERROR",
        "WriterContext failed authorization validation",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
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
        const existingById = this.findById(normalized.id, authorizedWriter);
        if (existingById !== null) {
          this.assertSameEvent(existingById, contentHash, "EVENT_ID_CONFLICT");
          results.push({ record: existingById, inserted: false });
          continue;
        }

        if (normalized.operationId !== undefined) {
          const existingByOperationAndType = this.findByOperationAndType(
            normalized.operationId,
            normalized.type,
            authorizedWriter,
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
          ...(this.#hasWriterColumn
            ? [stableStringify(authorizedWriter as unknown as JsonValue)]
            : []),
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
        results.push({
          record: rowToRecord(asEventRow(row), authorizedWriter),
          inserted: true,
        });
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

  private getProjectionVersions(): Record<string, number> {
    const rows = this.#database
      .prepare(
        "SELECT projection_name, projection_version FROM projection_state ORDER BY projection_name ASC",
      )
      .all() as Array<Record<string, unknown>>;
    const versions: Record<string, number> = {};
    for (const row of rows) {
      const name = this.requireRowString(
        row.projection_name,
        "projection_name",
      );
      versions[name] = this.requireRowInteger(
        row.projection_version,
        "projection_version",
      );
    }
    return versions;
  }

  private getProjectionHealth(lastSeq: number): ProjectionHealth[] {
    const rows = this.#database
      .prepare(
        "SELECT projection_name, projection_version, last_seq FROM projection_state ORDER BY projection_name ASC",
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const projectionName = this.requireRowString(
        row.projection_name,
        "projection_name",
      );
      const projectionVersion = this.requireRowInteger(
        row.projection_version,
        "projection_version",
      );
      const projectionLastSeq = this.requireRowInteger(
        row.last_seq,
        "last_seq",
      );
      if (projectionLastSeq > lastSeq) {
        throw new StoreError(
          "STORAGE_ERROR",
          "projection cursor is ahead of the event ledger",
          {
            projectionName,
            projectionLastSeq,
            lastSeq,
          },
        );
      }
      return {
        projectionName,
        projectionVersion,
        lastSeq: projectionLastSeq,
        lag: lastSeq - projectionLastSeq,
      };
    });
  }

  private getWriterBackfillCount(): number {
    if (!this.#hasWriterColumn) return 0;
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM events WHERE writer_json IS NULL")
      .get() as Record<string, unknown>;
    return this.requireRowInteger(row.count, "writer backfill count");
  }

  private getOrphanVerificationCount(): number {
    const events = this.readAllEvents();
    const expectationIds = new Set<string>();
    for (const event of events) {
      if (
        event.type === "expectation.created" ||
        event.type === "expectation.updated"
      ) {
        const payload = asObject(event.payload);
        if (typeof payload?.id === "string") expectationIds.add(payload.id);
      }
      if (event.type === "expectation.registered") {
        const payload = asObject(event.payload);
        if (typeof payload?.expectationId === "string") {
          expectationIds.add(payload.expectationId);
        }
      }
    }
    let orphanCount = 0;
    for (const event of events) {
      if (event.type !== "verification.completed") continue;
      const payload = asObject(event.payload);
      const result = asObject(payload?.result);
      if (
        typeof result?.expectationId !== "string" ||
        !expectationIds.has(result.expectationId)
      ) {
        orphanCount += 1;
      }
    }
    return orphanCount;
  }

  private getPendingPurgeCount(): number {
    const row = this.#database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM privacy_purge_authorizations WHERE active = 1) +
           (SELECT COUNT(*) FROM managed_backups WHERE status = 'purge-pending') AS count`,
      )
      .get() as Record<string, unknown>;
    return this.requireRowInteger(row.count, "pending purge count");
  }

  private readWalCheckpoint(): StoreHealth["walCheckpoint"] {
    const row = this.#database
      .prepare("PRAGMA wal_checkpoint(PASSIVE)")
      .get() as Record<string, unknown>;
    const values = Object.values(row);
    const [busy, log, checkpointed] = values.map((value) => Number(value));
    if (
      busy === undefined ||
      log === undefined ||
      checkpointed === undefined ||
      !Number.isSafeInteger(busy) ||
      !Number.isSafeInteger(log) ||
      !Number.isSafeInteger(checkpointed)
    ) {
      throw new StoreError(
        "STORAGE_ERROR",
        "WAL checkpoint status is malformed",
      );
    }
    return { busy, log, checkpointed };
  }

  private readAllEvents(): EventRecord[] {
    const events: EventRecord[] = [];
    let afterSeq = 0;
    while (true) {
      const batch = this.getSince(afterSeq, 10_000);
      if (batch.length === 0) break;
      events.push(...batch);
      const last = batch.at(-1);
      if (last === undefined) break;
      afterSeq = last.seq;
      if (batch.length < 10_000) break;
    }
    return events;
  }

  private managedBackupFromRow(row: Record<string, unknown>): ManagedBackup {
    const projectionVersionsValue = readJson(
      this.requireRowString(
        row.projection_versions_json,
        "projection_versions_json",
      ),
      "projection_versions_json",
    );
    const projectionVersionsObject = asObject(projectionVersionsValue);
    if (projectionVersionsObject === null) {
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup projection versions are malformed",
      );
    }
    const projectionVersions: Record<string, number> = {};
    for (const [name, value] of Object.entries(projectionVersionsObject)) {
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1
      ) {
        throw new StoreError(
          "STORAGE_ERROR",
          "managed backup projection version is malformed",
          {
            name,
          },
        );
      }
      projectionVersions[name] = value;
    }
    const status = this.requireRowString(row.status, "status");
    if (
      status !== "active" &&
      status !== "purge-pending" &&
      status !== "deleted"
    ) {
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup status is malformed",
        { status },
      );
    }
    const pendingPath =
      row.pending_path === null || row.pending_path === undefined
        ? undefined
        : this.requireRowString(row.pending_path, "pending_path");
    const purgedAt =
      row.purged_at === null || row.purged_at === undefined
        ? undefined
        : this.requireRowInteger(row.purged_at, "purged_at");
    return {
      schemaVersion: this.requireRowString(
        row.schema_version,
        "schema_version",
      ) as "1",
      id: this.requireRowString(row.backup_id, "backup_id"),
      path: this.requireRowString(row.path, "path"),
      createdAt: this.requireRowInteger(row.created_at, "created_at"),
      firstEventSeq: this.requireRowInteger(
        row.first_event_seq,
        "first_event_seq",
      ),
      lastEventSeq: this.requireRowInteger(
        row.last_event_seq,
        "last_event_seq",
      ),
      projectionVersions,
      sourceDbSha256: this.requireRowString(
        row.source_db_sha256,
        "source_db_sha256",
      ),
      backupSha256: this.requireRowString(row.backup_sha256, "backup_sha256"),
      status,
      ...(pendingPath === undefined ? {} : { pendingPath }),
      ...(purgedAt === undefined ? {} : { purgedAt }),
    };
  }

  private authorizationStoreError(error: unknown): StoreError {
    if (error instanceof StoreError) return error;
    return new StoreError(
      "AUTHORIZATION_ERROR",
      "writer is not authorized for this operation",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  private requireRowString(value: unknown, field: string): string {
    return requireString(value, field);
  }

  private requireRowInteger(value: unknown, field: string): number {
    return requireNumber(value, field);
  }

  private assertOpen(): void {
    if (this.#closed) {
      throw new StoreError("STORAGE_ERROR", "event store is closed");
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

  private findById(
    id: string,
    fallbackWriter?: WriterContext,
  ): EventRecord | null {
    const row = this.selectByIdStatement.get(id);
    return row === undefined
      ? null
      : rowToRecord(asEventRow(row), fallbackWriter);
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
    fallbackWriter?: WriterContext,
  ): EventRecord | null {
    const row = this.selectByOperationAndTypeStatement.get(operationId, type);
    return row === undefined
      ? null
      : rowToRecord(asEventRow(row), fallbackWriter);
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

export function restoreDatabaseFile(options: RestoreDatabaseOptions): void {
  const sourcePath = resolve(options.sourcePath);
  const destinationPath = resolve(options.destinationPath);
  if (sourcePath === destinationPath) {
    throw new StoreError(
      "STORAGE_ERROR",
      "restore source and destination must differ",
    );
  }
  const sourceLastSeq = validateSqliteFile(sourcePath);
  const sourceSha256 = sha256File(sourcePath);
  if (
    options.expectedSha256 !== undefined &&
    sourceSha256 !== options.expectedSha256.toLowerCase()
  ) {
    throw new StoreError(
      "STORAGE_ERROR",
      "restore source checksum does not match the expected manifest",
      {
        sourcePath,
        expectedSha256: options.expectedSha256,
        actualSha256: sourceSha256,
      },
    );
  }
  const destinationExists = existsSync(destinationPath);
  let safetyPath: string | undefined;
  if (destinationExists) {
    safetyPath =
      options.safetyBackupPath === undefined
        ? undefined
        : resolve(options.safetyBackupPath);
    if (safetyPath === undefined) {
      throw new StoreError(
        "STORAGE_ERROR",
        "restoring over an existing database requires a safety backup path",
      );
    }
    if (
      safetyPath === sourcePath ||
      safetyPath === destinationPath ||
      existsSync(safetyPath)
    ) {
      throw new StoreError(
        "STORAGE_ERROR",
        "restore safety backup path is invalid",
      );
    }
    copyFileSync(destinationPath, safetyPath);
  }
  const stagedPath = `${destinationPath}.restore-pending-${randomUUID()}`;
  if (existsSync(stagedPath)) {
    throw new StoreError(
      "STORAGE_ERROR",
      "restore staging path already exists",
      { stagedPath },
    );
  }
  let displacedPath: string | undefined;
  try {
    copyFileSync(sourcePath, stagedPath);
    const restoredLastSeq = validateSqliteFile(stagedPath);
    if (restoredLastSeq !== sourceLastSeq) {
      throw new StoreError(
        "STORAGE_ERROR",
        "restored database sequence differs from source",
      );
    }
    if (sha256File(stagedPath) !== sourceSha256) {
      throw new StoreError(
        "STORAGE_ERROR",
        "restored database checksum differs from source",
      );
    }
    if (destinationExists) {
      displacedPath = `${destinationPath}.restore-old-${randomUUID()}`;
      renameSync(destinationPath, displacedPath);
    }
    renameSync(stagedPath, destinationPath);
    if (displacedPath !== undefined && existsSync(displacedPath)) {
      try {
        unlinkSync(displacedPath);
      } catch {
        // The safety copy remains available; an old-file fragment is harmless.
      }
    }
  } catch (error) {
    if (existsSync(stagedPath)) {
      try {
        unlinkSync(stagedPath);
      } catch {
        // Keep the staging artifact for doctor/manual recovery.
      }
    }
    if (
      destinationExists &&
      safetyPath !== undefined &&
      existsSync(safetyPath)
    ) {
      try {
        copyFileSync(safetyPath, destinationPath);
      } catch {
        // Keep the original failure; the safety artifact remains available for manual recovery.
      }
    } else if (!destinationExists && existsSync(destinationPath)) {
      try {
        unlinkSync(destinationPath);
      } catch {
        // Keep the original failure; the doctor can identify the fragment.
      }
    }
    if (error instanceof StoreError) throw error;
    throw new StoreError("STORAGE_ERROR", "database restore failed", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
