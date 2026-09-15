import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncConnection } from "node:sqlite";
import type * as Sqlite from "node:sqlite";

import {
  AuthorizationError,
  authorizeHumanControl,
  authorizeEventAppend,
  authorizeWriterScope,
  eventEnvelopeSchema,
  legacyImportRunId,
  parseWriterContext,
  parseLegacyMigrationReport,
  parseReusableAsset,
  stableStringify,
  validateLegacyEventEnvelope,
  validatePhase3EventEnvelope,
} from "@praxis/contracts";
import type {
  ActorRef,
  AssetEventWriter,
  AssetReader,
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
  LegacyAnomaly,
  LegacyMigrationReport,
  LegacySourceEntry,
  OperationState,
  OperationStatus,
  ProjectionDataRecord,
  ProjectionPersistence,
  ProjectionStateRecord,
  SourceRef,
  SnapshotRecord,
  Provenance,
  AssetStatus,
  ReusableAsset,
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

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
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
    ...assetLineageReferences(event),
  ].filter((value): value is string => typeof value === "string");
  return explicitReferences.some((value) => identifiers.has(value));
}

function assetLineageReferences(event: EventRecord): string[] {
  if (!event.type.startsWith("asset.")) return [];
  const payload = asObject(event.payload);
  if (payload === null) return [];
  const references: string[] = [];
  for (const key of [
    "id",
    "assetId",
    "sourceAssetId",
    "targetAssetId",
    "sourceEventId",
  ]) {
    if (typeof payload[key] === "string") references.push(payload[key]);
  }
  const nestedAsset = asObject(payload.asset);
  if (nestedAsset !== null) {
    for (const key of ["id"]) {
      if (typeof nestedAsset[key] === "string")
        references.push(nestedAsset[key]);
    }
    const derivedFrom = nestedAsset.derivedFrom;
    if (Array.isArray(derivedFrom)) {
      for (const item of derivedFrom) {
        const evidence = asObject(item);
        if (evidence === null) continue;
        for (const key of ["eventId", "assetId"]) {
          if (typeof evidence[key] === "string") references.push(evidence[key]);
        }
      }
    }
    const forkedFrom = asObject(nestedAsset.forkedFrom);
    if (forkedFrom !== null && typeof forkedFrom.id === "string") {
      references.push(forkedFrom.id);
    }
  }
  return references;
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
  managedBackupRoot?: string;
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
  assetIntegrityIssues: string[];
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
  managedBackupFingerprints: string[];
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
  warnings?: string[];
}

export interface PurgeCleanupResult {
  finalizedBackupIds: string[];
  pendingBackupIds: string[];
}

export interface PrivacyPurgeOptions {
  confirm?: boolean;
  preserveManagedBackups?: boolean;
  executedAt?: number;
  planHash?: string;
}

export interface RestoreDatabaseOptions {
  sourcePath: string;
  destinationPath: string;
  safetyBackupPath?: string;
  expectedSha256?: string;
}

export interface LegacyImportRecordInput {
  report: LegacyMigrationReport;
  inventory: LegacySourceEntry[];
  anomalies: LegacyAnomaly[];
  events: EventEnvelope[];
}

export interface LegacyImportRecordResult {
  run: LegacyMigrationReport;
  /** `false` when an identical run was already recorded. */
  inserted: boolean;
  appendedEvents: number;
  lastSeq: number;
}

export interface LegacyImportRunRecord {
  runId: string;
  sourceFingerprint: string;
  planHash: string;
  root: string;
  status: LegacyMigrationReport["status"];
  counts: LegacyMigrationReport["counts"];
  anomalySummary: LegacyMigrationReport["anomalySummary"];
  hasArchive: boolean;
  startedAt: string;
  completedAt: string;
  lastSeq: number;
}

/**
 * A structural problem doctor can point at. These are integrity signals about
 * record linkage, not a judgement about whether the imported material is true.
 */
export interface LegacyIntegrityIssue {
  kind:
    | "legacy-event-without-run"
    | "legacy-run-count-mismatch"
    | "legacy-run-without-events"
    | "legacy-inventory-missing"
    | "legacy-completion-missing";
  detail: string;
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

const managedAssetEventTypes = new Set([
  "asset.validated",
  "asset.activate",
  "asset.contest",
  "asset.disable",
  "asset.restore",
  "asset.fork",
]);

function isManagedAssetEvent(event: EventEnvelope): boolean {
  if (managedAssetEventTypes.has(event.type)) return true;
  if (event.type !== "asset.candidate") return false;
  const payload = asObject(event.payload);
  return payload?.asset !== undefined;
}

function expectedAssetStatusForEvent(
  type: string,
): AssetStatus | "validated-or-active" | undefined {
  switch (type) {
    case "asset.candidate":
    case "asset.fork":
      return "candidate";
    case "asset.validated":
    case "asset.restore":
      return type === "asset.validated" ? "validated" : "validated-or-active";
    case "asset.activate":
      return "active";
    case "asset.contest":
      return "challenged";
    case "asset.disable":
      return "deprecated";
    default:
      return undefined;
  }
}

function assertManagedAssetWriteContract(
  event: EventEnvelope,
  asset: ReusableAsset,
): void {
  const payload = asObject(event.payload);
  const expectedStatus = expectedAssetStatusForEvent(event.type);
  if (payload === null || expectedStatus === undefined) {
    throw new StoreError(
      "ASSET_WRITE_REQUIRED",
      "managed asset event has an unsupported lifecycle shape",
      { eventType: event.type },
    );
  }
  if (
    expectedStatus !== "validated-or-active" &&
    asset.status !== expectedStatus
  ) {
    throw new StoreError(
      "INVALID_EVENT",
      "managed asset event status does not match its event type",
      { eventType: event.type, expectedStatus, actualStatus: asset.status },
    );
  }
  if (
    expectedStatus === "validated-or-active" &&
    asset.status !== "validated" &&
    asset.status !== "active"
  ) {
    throw new StoreError(
      "INVALID_EVENT",
      "asset restore must target validated or active status",
      { actualStatus: asset.status },
    );
  }
  if (
    event.type === "asset.candidate" &&
    event.source.kind !== "asset-proposer"
  ) {
    throw new StoreError(
      "ASSET_WRITE_REQUIRED",
      "asset candidates must be created by the asset proposer use-case",
    );
  }
  if (["asset.validated", "asset.activate"].includes(event.type)) {
    const review = asObject(payload.review);
    const decision = asObject(payload.decision);
    if (
      event.source.kind !== "asset-promotion" ||
      review === null ||
      decision === null ||
      review.targetStatus !== asset.status ||
      decision.targetStatus !== asset.status ||
      decision.allowed !== true ||
      (event.type === "asset.activate" && review.humanConfirmed !== true)
    ) {
      throw new StoreError(
        "ASSET_WRITE_REQUIRED",
        "asset promotion events require an accepted runtime policy decision",
        { eventType: event.type },
      );
    }
  }
  if (
    ["asset.contest", "asset.disable", "asset.restore", "asset.fork"].includes(
      event.type,
    )
  ) {
    const reason = payload.reason;
    if (
      event.source.kind !== "human-control" ||
      typeof reason !== "string" ||
      reason.length < 1
    ) {
      throw new StoreError(
        "ASSET_WRITE_REQUIRED",
        "asset control events require the human-control use-case",
        { eventType: event.type },
      );
    }
  }
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

function assetTimestamp(value: unknown, field: string): string {
  const milliseconds = requireNumber(value, field);
  const timestamp = new Date(milliseconds).toISOString();
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new StoreError("STORAGE_ERROR", `Stored ${field} is invalid`);
  }
  return timestamp;
}

function rowToAsset(row: Record<string, unknown>): ReusableAsset {
  try {
    const forkedFromJson = row.forked_from_json;
    return parseReusableAsset({
      id: requireString(row.id, "asset id"),
      kind: requireString(row.kind, "asset kind"),
      version: requireString(row.version, "asset version"),
      revision: requireNumber(row.revision, "asset revision"),
      status: requireString(row.status, "asset status"),
      body: readJson(
        requireString(row.body_json, "asset body_json"),
        "asset body_json",
      ),
      derivedFrom: readJson(
        requireString(row.derived_from_json, "asset derived_from_json"),
        "asset derived_from_json",
      ),
      ...(forkedFromJson === null || forkedFromJson === undefined
        ? {}
        : {
            forkedFrom: readJson(
              requireString(forkedFromJson, "asset forked_from_json"),
              "asset forked_from_json",
            ),
          }),
      createdAt: assetTimestamp(row.created_at, "asset created_at"),
      updatedAt: assetTimestamp(row.updated_at, "asset updated_at"),
    });
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError(
      "STORAGE_ERROR",
      "Stored asset failed contract validation",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

function legacyRunRecordFromRow(
  row: Record<string, unknown>,
): LegacyImportRunRecord {
  const readJsonField = (value: unknown, label: string): unknown => {
    if (typeof value !== "string") {
      throw new StoreError("STORAGE_ERROR", `legacy run ${label} is not text`);
    }
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new StoreError(
        "STORAGE_ERROR",
        `legacy run ${label} is not valid JSON`,
      );
    }
  };
  const archiveJson = row["archive_manifest_json"];
  return {
    runId: String(row["run_id"]),
    sourceFingerprint: String(row["source_fingerprint"]),
    planHash: String(row["plan_hash"]),
    root: String(row["root"]),
    status: String(row["status"]) as LegacyImportRunRecord["status"],
    counts: readJsonField(
      row["counts_json"],
      "counts_json",
    ) as LegacyImportRunRecord["counts"],
    anomalySummary: readJsonField(
      row["anomaly_summary_json"],
      "anomaly_summary_json",
    ) as LegacyImportRunRecord["anomalySummary"],
    hasArchive: typeof archiveJson === "string" && archiveJson.length > 0,
    startedAt: new Date(Number(row["started_at"])).toISOString(),
    completedAt: new Date(Number(row["completed_at"])).toISOString(),
    lastSeq: Number(row["last_seq"] ?? 0),
  };
}

export class SqliteEventStore
  implements
    EventReader,
    EventWriter,
    EventBatchWriter,
    ProjectionPersistence,
    AssetEventWriter,
    AssetReader
{
  readonly filename: string;
  readonly migrationVersion: number;
  readonly migrationStatus: MigrationStatus;
  readonly #managedBackupRoot: string | undefined;
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
    this.#managedBackupRoot =
      options.managedBackupRoot === undefined
        ? undefined
        : resolve(options.managedBackupRoot);
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

  private assertManagedBackupTarget(targetPath: string): void {
    if (
      this.#managedBackupRoot !== undefined &&
      !isPathWithinRoot(targetPath, this.#managedBackupRoot)
    ) {
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup path must remain inside the configured backup root",
        { targetPath, backupRoot: this.#managedBackupRoot },
      );
    }
  }

  private validateBackupManifestFile(manifest: BackupManifest): void {
    if (manifest.schemaVersion !== "1") {
      throw new StoreError(
        "STORAGE_ERROR",
        "backup manifest version is invalid",
      );
    }
    if (
      !isSha256(manifest.sourceDbSha256) ||
      !isSha256(manifest.backupSha256) ||
      !Number.isSafeInteger(manifest.firstEventSeq) ||
      !Number.isSafeInteger(manifest.lastEventSeq) ||
      manifest.firstEventSeq < 0 ||
      manifest.lastEventSeq < manifest.firstEventSeq
    ) {
      throw new StoreError(
        "STORAGE_ERROR",
        "backup manifest integrity fields are invalid",
      );
    }
    if (!existsSync(manifest.path)) {
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup file does not exist",
        { path: manifest.path },
      );
    }
    if (sha256File(manifest.path) !== manifest.backupSha256) {
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup file checksum does not match its manifest",
        { path: manifest.path },
      );
    }
    if (validateSqliteFile(manifest.path) !== manifest.lastEventSeq) {
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup sequence does not match its manifest",
        { path: manifest.path },
      );
    }
  }

  private reserveManagedBackup(
    backupId: string,
    targetPath: string,
    createdAt: number,
    lastEventSeq: number,
    writerId: string,
  ): void {
    if (backupId.length < 1) {
      throw new StoreError("STORAGE_ERROR", "backup id must not be empty");
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
        { destinationPath: targetPath },
      );
    }
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const existing = this.#database
        .prepare(
          "SELECT path, status, backup_sha256 FROM managed_backups WHERE backup_id = ?",
        )
        .get(backupId) as Record<string, unknown> | undefined;
      if (existing !== undefined) {
        if (
          existing.path !== targetPath ||
          existing.status !== "active" ||
          String(existing.backup_sha256 ?? "").length > 0
        ) {
          throw new StoreError(
            "STORAGE_ERROR",
            "managed backup id already belongs to another operation",
            { backupId },
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
           ) VALUES (?, '1', ?, ?, ?, ?, '{}', '', '', 'active')`,
        )
        .run(
          backupId,
          targetPath,
          createdAt,
          lastEventSeq === 0 ? 0 : 1,
          lastEventSeq,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original reservation failure.
      }
      if (error instanceof StoreError) throw error;
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup reservation failed",
        {
          backupId,
          writerId,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private removeManagedBackupReservation(backupId: string): void {
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      this.#database
        .prepare(
          "DELETE FROM managed_backups WHERE backup_id = ? AND status = 'active' AND backup_sha256 = ''",
        )
        .run(backupId);
      this.#database.exec("COMMIT");
    } catch {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Doctor will retain the incomplete reservation as an explicit issue.
      }
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
    const stagingPath = `${targetPath}.backup-pending-${randomUUID()}`;
    try {
      // VACUUM INTO is SQLite's portable online snapshot operation for the
      // supported Node 22.13 baseline. A raw copy of a live WAL database is
      // deliberately not used.
      this.#database.exec(`VACUUM INTO ${sqlStringLiteral(stagingPath)}`);
      const backupLastSeq = validateSqliteFile(stagingPath);
      if (backupLastSeq !== lastEventSeq) {
        throw new StoreError(
          "STORAGE_ERROR",
          "backup sequence does not match the source snapshot",
          {
            sourceLastSeq: lastEventSeq,
            backupLastSeq,
          },
        );
      }
      if (existsSync(targetPath)) {
        throw new StoreError(
          "STORAGE_ERROR",
          "backup destination appeared during snapshot finalization",
          { destinationPath: targetPath },
        );
      }
      renameSync(stagingPath, targetPath);
    } catch (error) {
      if (existsSync(stagingPath)) {
        try {
          unlinkSync(stagingPath);
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
    this.assertOpen();
    const targetPath = resolve(destinationPath);
    this.assertManagedBackupTarget(targetPath);
    const createdAt = options.createdAt ?? Date.now();
    assertTimestampMilliseconds(createdAt, "managed backup createdAt");
    const backupId = options.id ?? `backup:${createdAt}:${randomUUID()}`;
    const lastEventSeq = this.getLastSeq();
    this.reserveManagedBackup(
      backupId,
      targetPath,
      createdAt,
      lastEventSeq,
      authorized.writerId,
    );
    try {
      const manifest = this.backupTo(targetPath, {
        ...options,
        id: backupId,
        createdAt,
      });
      this.registerManagedBackup(manifest, authorized);
      return manifest;
    } catch (error) {
      // If no final file exists, remove only our incomplete reservation. If a
      // file exists, keep the row so doctor/purge can see and handle it.
      if (!existsSync(targetPath)) {
        this.removeManagedBackupReservation(backupId);
      }
      throw error;
    }
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
    void authorized;
    this.assertOpen();
    if (manifest.path !== resolve(manifest.path)) {
      throw new StoreError(
        "STORAGE_ERROR",
        "managed backup path must be absolute",
      );
    }
    this.assertManagedBackupTarget(manifest.path);
    this.validateBackupManifestFile(manifest);
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const existing = this.#database
        .prepare("SELECT * FROM managed_backups WHERE backup_id = ?")
        .get(manifest.id) as Record<string, unknown> | undefined;
      if (existing !== undefined) {
        const samePath = existing.path === manifest.path;
        const existingHash = String(existing.backup_sha256 ?? "");
        if (
          !samePath ||
          existing.status !== "active" ||
          (existingHash.length > 0 && existingHash !== manifest.backupSha256)
        ) {
          throw new StoreError(
            "STORAGE_ERROR",
            "managed backup id conflicts with existing metadata",
            {
              backupId: manifest.id,
            },
          );
        }
        this.#database
          .prepare(
            `UPDATE managed_backups
             SET schema_version = ?, path = ?, created_at = ?,
                 first_event_seq = ?, last_event_seq = ?,
                 projection_versions_json = ?, source_db_sha256 = ?,
                 backup_sha256 = ?, status = 'active',
                 pending_path = NULL, purged_at = NULL
             WHERE backup_id = ?`,
          )
          .run(
            manifest.schemaVersion,
            manifest.path,
            manifest.createdAt,
            manifest.firstEventSeq,
            manifest.lastEventSeq,
            stableStringify(
              manifest.projectionVersions as unknown as JsonValue,
            ),
            manifest.sourceDbSha256,
            manifest.backupSha256,
            manifest.id,
          );
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

  planPrivacyPurge(sessionId: string, writer: WriterContext): PrivacyPurgePlan {
    try {
      authorizeHumanControl(writer, "privacy purge dry-run", "history.purge");
    } catch (error) {
      throw this.authorizationStoreError(error);
    }
    return this.buildPrivacyPurgePlan(sessionId);
  }

  private buildPrivacyPurgePlan(sessionId: string): PrivacyPurgePlan {
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
    const managedBackups = this.listManagedBackups();
    const selectedManagedBackups = managedBackups.filter(
      (backup) =>
        backup.status !== "deleted" &&
        ranges.some(
          (range) =>
            backup.firstEventSeq <= range.endSeq &&
            backup.lastEventSeq >= range.startSeq,
        ),
    );
    const managedBackupIds = selectedManagedBackups
      .map((backup) => backup.id)
      .sort();
    const managedBackupFingerprints = selectedManagedBackups
      .map((backup) =>
        stableStringify({
          id: backup.id,
          path: backup.path,
          pendingPath: backup.pendingPath ?? null,
          status: backup.status,
          lastEventSeq: backup.lastEventSeq,
          backupSha256: backup.backupSha256,
        } as unknown as JsonValue),
      )
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
      managedBackupFingerprints,
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
    const plan = this.buildPrivacyPurgePlan(sessionId);
    const warnings =
      options.preserveManagedBackups === true &&
      plan.managedBackupIds.length > 0
        ? ["selected managed backups still contain data covered by this purge"]
        : undefined;
    if (options.confirm !== true) {
      return {
        dryRun: true,
        plan,
        ...(warnings === undefined ? {} : { warnings }),
      };
    }
    if (options.planHash !== plan.planHash) {
      throw new StoreError(
        "STORAGE_ERROR",
        "purge confirmation must include the current dry-run plan hash",
        {
          expectedPlanHash: plan.planHash,
          providedPlanHash: options.planHash ?? null,
        },
      );
    }
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
      if (plan.affectedAssetIds.length > 0) {
        const assetPlaceholders = plan.affectedAssetIds
          .map(() => "?")
          .join(", ");
        this.#database
          .prepare(`DELETE FROM assets WHERE id IN (${assetPlaceholders})`)
          .run(...plan.affectedAssetIds);
      }
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
      ...(warnings === undefined ? {} : { warnings }),
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
    const assetIntegrityIssues = this.getAssetIntegrityIssues();
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
      assetIntegrityIssues,
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
    const { authorizedWriter, normalizedEvents } =
      this.authorizeAndNormalizeEvents(events, writer);
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const results = this.appendEventsInTransaction(
        normalizedEvents,
        authorizedWriter,
      );
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

  appendAssetEvent(
    event: EventEnvelope,
    writer: WriterContext,
    assetInput: ReusableAsset,
    expectedRevision?: number,
  ): EventAppendResult {
    this.assertOpen();
    const { authorizedWriter, normalizedEvents } =
      this.authorizeAndNormalizeEvents([event], writer, true);
    const normalized = normalizedEvents[0];
    if (
      normalized === undefined ||
      !isManagedAssetEvent(normalized.normalized)
    ) {
      throw new StoreError(
        "ASSET_WRITE_REQUIRED",
        "appendAssetEvent requires a managed asset lifecycle event",
      );
    }
    const asset = this.parseAssetInput(assetInput);
    const payload = asObject(normalized.normalized.payload);
    const payloadAsset = payload?.asset;
    if (payloadAsset === undefined) {
      throw new StoreError(
        "INVALID_EVENT",
        "managed asset event payload must contain the complete asset snapshot",
      );
    }
    let normalizedPayloadAsset: ReusableAsset;
    try {
      normalizedPayloadAsset = parseReusableAsset(payloadAsset);
    } catch (error) {
      throw new StoreError(
        "INVALID_EVENT",
        "managed asset event payload contains an invalid asset snapshot",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (
      stableStringify(normalizedPayloadAsset as unknown as JsonValue) !==
      stableStringify(asset as unknown as JsonValue)
    ) {
      throw new StoreError(
        "INVALID_EVENT",
        "managed asset event payload does not match the asset argument",
      );
    }
    const payloadAssetId = payload?.assetId;
    if (typeof payloadAssetId !== "string" || payloadAssetId !== asset.id) {
      throw new StoreError(
        "INVALID_EVENT",
        "managed asset event assetId does not match the asset snapshot",
      );
    }
    assertManagedAssetWriteContract(normalized.normalized, asset);
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      throw new StoreError(
        "ASSET_REVISION_CONFLICT",
        "expected asset revision must be a non-negative safe integer",
        { expectedRevision },
      );
    }

    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const existingById = this.findById(
        normalized.normalized.id,
        authorizedWriter,
      );
      if (existingById !== null) {
        this.assertSameEvent(
          existingById,
          normalized.contentHash,
          "EVENT_ID_CONFLICT",
        );
        this.#database.exec("COMMIT");
        return { record: existingById, inserted: false };
      }
      if (normalized.normalized.operationId !== undefined) {
        const existingByOperationAndType = this.findByOperationAndType(
          normalized.normalized.operationId,
          normalized.normalized.type,
          authorizedWriter,
        );
        if (existingByOperationAndType !== null) {
          this.assertSameEvent(
            existingByOperationAndType,
            normalized.contentHash,
            "OPERATION_ID_CONFLICT",
          );
          this.#database.exec("COMMIT");
          return { record: existingByOperationAndType, inserted: false };
        }
      }
      const current = this.readAssetInTransaction(asset.id);
      this.assertAssetRevision(current, asset, expectedRevision);
      const result = this.appendEventsInTransaction(
        normalizedEvents,
        authorizedWriter,
      )[0];
      if (result === undefined || !result.inserted) {
        throw new StoreError(
          "STORAGE_ERROR",
          "managed asset event did not insert a new ledger row",
        );
      }
      this.writeAssetInTransaction(asset, result.record.seq);
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original asset write failure.
      }
      if (error instanceof StoreError) throw error;
      throw new StoreError(
        "STORAGE_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Record one Legacy import run and its imported events atomically.
   *
   * The run row, the source inventory, the anomaly rows and every `legacy.*`
   * event commit in one transaction, so a crash leaves either the whole run or
   * none of it. Idempotency is by `(source_fingerprint, plan_hash)`: an
   * identical re-import is reported as `already-imported` and appends nothing,
   * while a changed corpus produces new event identities through the
   * fingerprint that participates in them.
   */
  recordLegacyImport(
    input: LegacyImportRecordInput,
    writer: WriterContext,
  ): LegacyImportRecordResult {
    this.assertOpen();
    let authorizedWriter: WriterContext;
    try {
      authorizedWriter = authorizeWriterScope(
        writer,
        "system.migrate",
        "legacy import",
      );
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw new StoreError(
          "AUTHORIZATION_ERROR",
          error.message,
          error.details,
        );
      }
      throw this.authorizationStoreError(error);
    }
    const role = authorizedWriter.role.toUpperCase();
    if (authorizedWriter.kind !== "importer" && role !== "OWNER") {
      throw new StoreError(
        "AUTHORIZATION_ERROR",
        "legacy import requires an importer writer or an owner writer",
        { writerId: authorizedWriter.writerId, role: authorizedWriter.role },
      );
    }

    let report: LegacyMigrationReport;
    try {
      report = parseLegacyMigrationReport(input.report);
    } catch (error) {
      throw new StoreError(
        "INVALID_EVENT",
        "legacy migration report failed contract validation",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (report.status === "dry-run") {
      throw new StoreError(
        "INVALID_EVENT",
        "a dry-run report is not an import; only applied runs are recorded",
      );
    }
    for (const event of input.events) {
      if (!event.type.startsWith("legacy.")) {
        throw new StoreError(
          "INVALID_EVENT",
          "a legacy import run may only append legacy.* events",
          { eventType: event.type },
        );
      }
    }
    if (input.events.length === 0) {
      throw new StoreError(
        "INVALID_EVENT",
        "a legacy import run must append at least its completion event",
      );
    }

    const { normalizedEvents } = this.authorizeAndNormalizeEvents(
      input.events,
      authorizedWriter,
    );

    const startedAt = Date.parse(report.startedAt);
    const completedAt = Date.parse(report.completedAt);

    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const existing = this.readLegacyRunInTransaction(
        report.sourceFingerprint,
        report.planHash,
      );
      if (existing !== null) {
        if (
          stableStringify(existing.counts as unknown as JsonValue) !==
          stableStringify(report.counts as unknown as JsonValue)
        ) {
          throw new StoreError(
            "EVENT_ID_CONFLICT",
            "a recorded legacy import run with this plan hash has different counts",
            { runId: existing.runId },
          );
        }
        this.#database.exec("COMMIT");
        return {
          run: { ...report, runId: existing.runId, status: "already-imported" },
          inserted: false,
          appendedEvents: 0,
          lastSeq: existing.lastSeq,
        };
      }

      // Events first, so the run row can be written complete in a single
      // insert. `legacy_import_runs` is append-only — a run is history, and a
      // correction is a new run — so there is deliberately no follow-up
      // UPDATE of `last_seq`.
      const results = this.appendEventsInTransaction(
        normalizedEvents,
        authorizedWriter,
      );
      const lastSeq = results[results.length - 1]?.record.seq ?? 0;

      const runId = legacyImportRunId(
        report.sourceFingerprint,
        report.planHash,
      );
      this.#database
        .prepare(
          `INSERT INTO legacy_import_runs (
             run_id, source_fingerprint, plan_hash, root, status, counts_json,
             anomaly_summary_json, archive_manifest_json, started_at,
             completed_at, last_seq
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          report.sourceFingerprint,
          report.planHash,
          report.root,
          report.status,
          stableStringify(report.counts as unknown as JsonValue),
          stableStringify(report.anomalySummary as unknown as JsonValue),
          report.archive === null
            ? null
            : stableStringify(report.archive as unknown as JsonValue),
          startedAt,
          completedAt,
          lastSeq,
        );

      const inventoryStatement = this.#database.prepare(
        `INSERT INTO legacy_source_inventory (
           run_id, relative_path, artifact_kind, size_bytes, modified_at,
           sha256, parse_status, anomaly_classes_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const entry of input.inventory) {
        inventoryStatement.run(
          runId,
          entry.relativePath,
          entry.artifactKind,
          entry.sizeBytes,
          entry.modifiedAtMs,
          entry.sha256,
          entry.parseStatus,
          stableStringify(entry.anomalyClasses as unknown as JsonValue),
        );
      }

      const anomalyStatement = this.#database.prepare(
        `INSERT INTO legacy_anomalies (
           run_id, anomaly_id, anomaly_class, reason, relative_path,
           artifact_kind, affected_count, declared_value
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const anomaly of input.anomalies) {
        anomalyStatement.run(
          runId,
          anomaly.id,
          anomaly.class,
          anomaly.reason,
          anomaly.relativePath ?? null,
          anomaly.artifactKind ?? null,
          anomaly.affectedCount,
          anomaly.declaredValue ?? null,
        );
      }

      this.#database.exec("COMMIT");

      return {
        run: { ...report, runId },
        inserted: true,
        appendedEvents: results.filter((result) => result.inserted).length,
        lastSeq,
      };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original import failure.
      }
      if (error instanceof StoreError) throw error;
      throw new StoreError(
        "STORAGE_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  listLegacyImportRuns(): LegacyImportRunRecord[] {
    this.assertOpen();
    const rows = this.#database
      .prepare(
        `SELECT run_id, source_fingerprint, plan_hash, root, status,
                counts_json, anomaly_summary_json, archive_manifest_json,
                started_at, completed_at, last_seq
         FROM legacy_import_runs
         ORDER BY completed_at DESC, run_id ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => legacyRunRecordFromRow(row));
  }

  getLegacyImportRun(runId: string): LegacyImportRunRecord | null {
    this.assertOpen();
    const row = this.#database
      .prepare(
        `SELECT run_id, source_fingerprint, plan_hash, root, status,
                counts_json, anomaly_summary_json, archive_manifest_json,
                started_at, completed_at, last_seq
         FROM legacy_import_runs
         WHERE run_id = ?`,
      )
      .get(runId) as Record<string, unknown> | undefined;
    return row === undefined ? null : legacyRunRecordFromRow(row);
  }

  getLegacyAnomalies(runId: string): LegacyAnomaly[] {
    this.assertOpen();
    const rows = this.#database
      .prepare(
        `SELECT anomaly_id, anomaly_class, reason, relative_path,
                artifact_kind, affected_count, declared_value
         FROM legacy_anomalies
         WHERE run_id = ?
         ORDER BY anomaly_id ASC`,
      )
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const anomaly: LegacyAnomaly = {
        id: String(row["anomaly_id"]),
        class: String(row["anomaly_class"]) as LegacyAnomaly["class"],
        reason: String(row["reason"]),
        affectedCount: Number(row["affected_count"]),
      };
      const relativePath = row["relative_path"];
      if (typeof relativePath === "string") {
        anomaly.relativePath = relativePath;
      }
      const artifactKind = row["artifact_kind"];
      if (typeof artifactKind === "string") {
        anomaly.artifactKind = artifactKind as NonNullable<
          LegacyAnomaly["artifactKind"]
        >;
      }
      const declaredValue = row["declared_value"];
      if (typeof declaredValue === "string") {
        anomaly.declaredValue = declaredValue;
      }
      return anomaly;
    });
  }

  /**
   * Doctor's view of the Legacy boundary. These checks prove that every
   * imported record is reachable from a recorded run and that the recorded
   * counts match the ledger; they do not claim the imported material is true.
   */
  getLegacyIntegrityIssues(): LegacyIntegrityIssue[] {
    this.assertOpen();
    const issues: LegacyIntegrityIssue[] = [];

    const orphanEvents = this.#database
      .prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE type LIKE 'legacy.%'
           AND json_extract(payload_json, '$.sourceFingerprint') NOT IN (
             SELECT source_fingerprint FROM legacy_import_runs
           )`,
      )
      .get() as Record<string, unknown> | undefined;
    const orphanCount = Number(orphanEvents?.["count"] ?? 0);
    if (orphanCount > 0) {
      issues.push({
        kind: "legacy-event-without-run",
        detail: `${orphanCount} legacy event(s) reference a corpus fingerprint with no recorded import run`,
      });
    }

    const runs = this.#database
      .prepare(
        `SELECT run_id, source_fingerprint, counts_json
         FROM legacy_import_runs`,
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of runs) {
      const runId = String(row["run_id"]);
      const fingerprint = String(row["source_fingerprint"]);
      let counts: Record<string, unknown> = {};
      try {
        counts = JSON.parse(String(row["counts_json"])) as Record<
          string,
          unknown
        >;
      } catch {
        issues.push({
          kind: "legacy-run-count-mismatch",
          detail: `run ${runId} has unreadable counts`,
        });
        continue;
      }

      const observed = this.#database
        .prepare(
          `SELECT type, COUNT(*) AS count FROM events
           WHERE json_extract(payload_json, '$.sourceFingerprint') = ?
           GROUP BY type`,
        )
        .all(fingerprint) as Array<Record<string, unknown>>;
      const byType = new Map<string, number>();
      for (const entry of observed) {
        byType.set(String(entry["type"]), Number(entry["count"]));
      }

      const expected: Array<[string, string]> = [
        ["signals", "legacy.signal.imported"],
        ["patterns", "legacy.pattern.imported"],
        ["graphEdges", "legacy.graph-edge.imported"],
      ];
      for (const [field, type] of expected) {
        const declared = Number(counts[field] ?? 0);
        const actual = byType.get(type) ?? 0;
        if (declared !== actual) {
          issues.push({
            kind: "legacy-run-count-mismatch",
            detail: `run ${runId} declares ${declared} ${field} but the ledger holds ${actual}`,
          });
        }
      }
      if ((byType.get("legacy.import.completed") ?? 0) === 0) {
        issues.push({
          kind: "legacy-completion-missing",
          detail: `run ${runId} has no legacy.import.completed event`,
        });
      }
      if (byType.size === 0) {
        issues.push({
          kind: "legacy-run-without-events",
          detail: `run ${runId} has no ledger events for its corpus fingerprint`,
        });
      }

      const inventoryCount = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM legacy_source_inventory WHERE run_id = ?",
        )
        .get(runId) as Record<string, unknown> | undefined;
      if (Number(inventoryCount?.["count"] ?? 0) === 0) {
        issues.push({
          kind: "legacy-inventory-missing",
          detail: `run ${runId} recorded no source inventory`,
        });
      }
    }

    return issues;
  }

  private readLegacyRunInTransaction(
    sourceFingerprint: string,
    planHash: string,
  ): { runId: string; counts: unknown; lastSeq: number } | null {
    const row = this.#database
      .prepare(
        `SELECT run_id, counts_json, last_seq FROM legacy_import_runs
         WHERE source_fingerprint = ? AND plan_hash = ?`,
      )
      .get(sourceFingerprint, planHash) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    let counts: unknown = {};
    try {
      counts = JSON.parse(String(row["counts_json"])) as unknown;
    } catch {
      counts = {};
    }
    return {
      runId: String(row["run_id"]),
      counts,
      lastSeq: Number(row["last_seq"] ?? 0),
    };
  }

  private authorizeAndNormalizeEvents(
    events: EventEnvelope[],
    writer: WriterContext,
    allowManagedAssetEvents = false,
  ): {
    authorizedWriter: WriterContext;
    normalizedEvents: Array<{
      normalized: EventEnvelope;
      contentHash: string;
    }>;
  } {
    let authorizedWriter: WriterContext;
    try {
      authorizedWriter = parseWriterContext(writer);
      for (const event of events) {
        authorizeEventAppend(authorizedWriter, event.type);
        if (!allowManagedAssetEvents && isManagedAssetEvent(event)) {
          throw new StoreError(
            "ASSET_WRITE_REQUIRED",
            "managed asset lifecycle events must use the asset runtime write path",
            { eventType: event.type },
          );
        }
      }
    } catch (error) {
      if (error instanceof StoreError) throw error;
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
          { issues: parsed.error.issues },
        );
      }
      const normalized = parsed.data as EventEnvelope;
      try {
        validatePhase3EventEnvelope(normalized);
        validateLegacyEventEnvelope(normalized);
      } catch (error) {
        throw new StoreError(
          "INVALID_EVENT",
          error instanceof Error ? error.message : String(error),
        );
      }
      return { normalized, contentHash: hashEvent(normalized) };
    });
    return { authorizedWriter, normalizedEvents };
  }

  private appendEventsInTransaction(
    normalizedEvents: Array<{
      normalized: EventEnvelope;
      contentHash: string;
    }>,
    authorizedWriter: WriterContext,
  ): EventAppendResult[] {
    const results: EventAppendResult[] = [];
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
          { id: normalized.id, seq },
        );
      }
      results.push({
        record: rowToRecord(asEventRow(row), authorizedWriter),
        inserted: true,
      });
    }
    return results;
  }

  private parseAssetInput(assetInput: ReusableAsset): ReusableAsset {
    try {
      return parseReusableAsset(assetInput);
    } catch (error) {
      throw new StoreError(
        "INVALID_EVENT",
        "asset snapshot failed the reusable-asset contract",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private readAssetInTransaction(id: string): ReusableAsset | null {
    const row = this.#database
      .prepare("SELECT * FROM assets WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row === undefined ? null : rowToAsset(row);
  }

  private assertAssetRevision(
    current: ReusableAsset | null,
    incoming: ReusableAsset,
    expectedRevision: number | undefined,
  ): void {
    if (current === null) {
      if (expectedRevision !== undefined && expectedRevision !== 0) {
        throw new StoreError(
          "ASSET_REVISION_CONFLICT",
          "asset revision compare-and-set expected an absent asset",
          { expectedRevision, actualRevision: null },
        );
      }
      if (incoming.revision !== 1) {
        throw new StoreError(
          "ASSET_REVISION_CONFLICT",
          "a new asset must start at revision 1",
          { incomingRevision: incoming.revision },
        );
      }
      return;
    }
    if (
      expectedRevision === undefined ||
      expectedRevision !== current.revision
    ) {
      throw new StoreError(
        "ASSET_REVISION_CONFLICT",
        "asset revision compare-and-set failed",
        {
          expectedRevision: expectedRevision ?? null,
          actualRevision: current.revision,
        },
      );
    }
    if (incoming.revision !== current.revision + 1) {
      throw new StoreError(
        "ASSET_REVISION_CONFLICT",
        "asset revision must advance exactly once",
        {
          currentRevision: current.revision,
          incomingRevision: incoming.revision,
        },
      );
    }
  }

  private writeAssetInTransaction(asset: ReusableAsset, lastSeq: number): void {
    this.#database
      .prepare(
        `
        INSERT INTO assets (
          id, kind, version, revision, status, body_json,
          derived_from_json, forked_from_json, created_at, updated_at, last_seq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          version = excluded.version,
          revision = excluded.revision,
          status = excluded.status,
          body_json = excluded.body_json,
          derived_from_json = excluded.derived_from_json,
          forked_from_json = excluded.forked_from_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_seq = excluded.last_seq
      `,
      )
      .run(
        asset.id,
        asset.kind,
        asset.version,
        asset.revision,
        asset.status,
        stableStringify(asset.body),
        stableStringify(asset.derivedFrom as unknown as JsonValue),
        asset.forkedFrom === undefined
          ? null
          : stableStringify(asset.forkedFrom as unknown as JsonValue),
        epochMilliseconds(asset.createdAt),
        epochMilliseconds(asset.updatedAt),
        lastSeq,
      );
  }

  getById(id: string): EventRecord | null {
    return this.findById(id);
  }

  getAsset(id: string): ReusableAsset | null {
    this.assertOpen();
    this.assertNonEmpty(id, "asset id");
    return this.readAssetInTransaction(id);
  }

  listAssets(): ReusableAsset[] {
    this.assertOpen();
    const rows = this.#database
      .prepare("SELECT * FROM assets ORDER BY updated_at ASC, id ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => rowToAsset(row));
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

  private getAssetIntegrityIssues(): string[] {
    const rows = this.#database
      .prepare("SELECT * FROM assets ORDER BY id ASC")
      .all() as Array<Record<string, unknown>>;
    const assetIds = new Set(
      rows.flatMap((row) =>
        typeof row.id === "string" && row.id.length > 0 ? [row.id] : [],
      ),
    );
    const issues = new Set<string>();
    const addIssue = (assetId: string, issue: string): void => {
      issues.add(`${assetId}:${issue}`);
    };

    for (const row of rows) {
      const assetId =
        typeof row.id === "string" && row.id.length > 0
          ? row.id
          : "<invalid-asset-id>";
      let asset: ReusableAsset;
      try {
        asset = rowToAsset(row);
      } catch {
        addIssue(assetId, "catalog-row-invalid");
        continue;
      }

      const lastSeq = row.last_seq;
      if (
        typeof lastSeq !== "number" ||
        !Number.isSafeInteger(lastSeq) ||
        lastSeq < 1
      ) {
        addIssue(asset.id, "last-seq-invalid");
      } else {
        const eventRow = this.#database
          .prepare("SELECT * FROM events WHERE seq = ?")
          .get(lastSeq) as Record<string, unknown> | undefined;
        if (eventRow === undefined) {
          addIssue(asset.id, "last-seq-event-missing");
        } else {
          try {
            const event = rowToRecord(asEventRow(eventRow));
            const payload = asObject(event.payload);
            const nestedAsset = payload?.asset;
            if (!isManagedAssetEvent(event) || nestedAsset === undefined) {
              addIssue(asset.id, "last-seq-is-not-managed-asset-event");
            } else {
              const eventAsset = parseReusableAsset(nestedAsset);
              if (
                eventAsset.id !== asset.id ||
                stableStringify(eventAsset as unknown as JsonValue) !==
                  stableStringify(asset as unknown as JsonValue)
              ) {
                addIssue(asset.id, "catalog-snapshot-mismatch");
              }
              const expectedStatus = expectedAssetStatusForEvent(event.type);
              if (
                expectedStatus !== undefined &&
                expectedStatus !== "validated-or-active" &&
                eventAsset.status !== expectedStatus
              ) {
                addIssue(asset.id, "event-status-mismatch");
              }
              if (
                expectedStatus === "validated-or-active" &&
                eventAsset.status !== "validated" &&
                eventAsset.status !== "active"
              ) {
                addIssue(asset.id, "restore-status-mismatch");
              }
            }
          } catch {
            addIssue(asset.id, "last-seq-event-invalid");
          }
        }
      }

      for (const evidence of asset.derivedFrom) {
        if (evidence.eventId !== undefined) {
          let sourceEvent: EventRecord | null;
          try {
            sourceEvent = this.getById(evidence.eventId);
          } catch {
            sourceEvent = null;
          }
          if (sourceEvent === null) {
            addIssue(asset.id, `missing-event:${evidence.eventId}`);
          } else if (sourceEvent.provenance.origin !== evidence.origin) {
            addIssue(asset.id, `evidence-origin-mismatch:${evidence.eventId}`);
          }
        }
        if (evidence.assetId !== undefined && !assetIds.has(evidence.assetId)) {
          addIssue(asset.id, `missing-asset:${evidence.assetId}`);
        }
      }
      if (
        asset.forkedFrom !== undefined &&
        !assetIds.has(asset.forkedFrom.id)
      ) {
        addIssue(asset.id, `missing-fork-parent:${asset.forkedFrom.id}`);
      }
    }
    return [...issues].sort();
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
