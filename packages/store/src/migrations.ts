import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { eventEnvelopeSchema, stableStringify } from "@praxis/contracts";
import type {
  EventEnvelope,
  EventLinks,
  EvidenceRef,
  JsonValue,
  Provenance,
  SourceRef,
} from "@praxis/contracts";

import { StoreError } from "./errors.js";

const migrationPattern = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/;

export interface MigrationRunnerOptions {
  now?: () => number;
}

export interface MigrationResult {
  applied: number[];
  currentVersion: number;
  latestVersion: number;
  pendingVersions: number[];
}

export interface MigrationStatus {
  currentVersion: number;
  latestVersion: number;
  pendingVersions: number[];
}

interface MigrationFile {
  version: number;
  name: string;
  filename: string;
}

interface LegacyEventRow {
  seq: unknown;
  id: unknown;
  schema_version: unknown;
  event_version: unknown;
  type: unknown;
  occurred_at: unknown;
  observed_at: unknown;
  recorded_at: unknown;
  actor_type: unknown;
  actor_id: unknown;
  session_id: unknown;
  trace_id: unknown;
  operation_id: unknown;
  source_json: unknown;
  payload_json: unknown;
  evidence_json: unknown;
  links_json: unknown;
  provenance_json: unknown;
  content_hash: unknown;
}

function checksum(sql: string): string {
  return createHash("sha256")
    .update(sql.replaceAll("\r\n", "\n"))
    .digest("hex");
}

export class MigrationRunner {
  private readonly now: () => number;

  constructor(
    private readonly database: DatabaseSync,
    private readonly migrationsDir: string,
    options: MigrationRunnerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  run(): MigrationResult {
    try {
      this.ensureMetadataTable();
      const files = this.readMigrationFiles();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const appliedRows = this.database
          .prepare(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC",
          )
          .all() as Array<{
          version: number;
          name: string;
          checksum: string;
        }>;
        const appliedByVersion = new Map(
          appliedRows.map((row) => [row.version, row.name]),
        );

        this.validateAppliedRows(appliedRows, files);

        const applied: number[] = [];
        for (const migration of files) {
          if (appliedByVersion.has(migration.version)) continue;
          this.applyMigration(migration);
          applied.push(migration.version);
          appliedByVersion.set(migration.version, migration.name);
        }

        this.database.exec("COMMIT");
        const currentVersion = files.at(-1)?.version ?? 0;
        return {
          applied,
          currentVersion,
          latestVersion: currentVersion,
          pendingVersions: files
            .filter((migration) => !appliedByVersion.has(migration.version))
            .map((migration) => migration.version),
        };
      } catch (error) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          // Preserve the original migration error; the connection can be closed by the caller.
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof StoreError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoreError("MIGRATION_ERROR", message);
    }
  }

  status(): MigrationStatus {
    try {
      this.ensureMetadataTable();
      const files = this.readMigrationFiles();
      const appliedRows = this.database
        .prepare(
          "SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC",
        )
        .all() as Array<{
        version: number;
        name: string;
        checksum: string;
      }>;
      this.validateAppliedRows(appliedRows, files);
      const appliedVersions = new Set(appliedRows.map((row) => row.version));
      return {
        currentVersion: appliedRows.at(-1)?.version ?? 0,
        latestVersion: files.at(-1)?.version ?? 0,
        pendingVersions: files
          .filter((migration) => !appliedVersions.has(migration.version))
          .map((migration) => migration.version),
      };
    } catch (error) {
      if (error instanceof StoreError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoreError("MIGRATION_ERROR", message);
    }
  }

  private ensureMetadataTable(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
  }

  private readMigrationFiles(): MigrationFile[] {
    const files = readdirSync(this.migrationsDir)
      .map((filename): MigrationFile | null => {
        const match = migrationPattern.exec(filename);
        if (!match) return null;
        const versionText = match[1];
        const name = match[2];
        if (versionText === undefined || name === undefined) return null;
        return {
          version: Number(versionText),
          name,
          filename,
        };
      })
      .filter((file): file is MigrationFile => file !== null)
      .sort((left, right) => left.version - right.version);

    for (let index = 1; index < files.length; index += 1) {
      const previous = files[index - 1];
      const current = files[index];
      if (previous === undefined || current === undefined) continue;
      if (previous.version === current.version) {
        throw new StoreError(
          "MIGRATION_ERROR",
          `Duplicate migration version ${current.version}`,
        );
      }
      if (current.version !== previous.version + 1) {
        throw new StoreError(
          "MIGRATION_ERROR",
          `Migration versions must be contiguous: expected ${previous.version + 1}, found ${current.version}`,
        );
      }
    }

    if (files.length > 0 && files[0]?.version !== 1) {
      throw new StoreError(
        "MIGRATION_ERROR",
        `Migration versions must start at 1, found ${files[0]?.version}`,
      );
    }

    return files;
  }

  private applyMigration(migration: MigrationFile): void {
    if (migration.version === 3) {
      this.validateEventsBeforeContractMigration();
    }
    const sql = this.readMigrationSql(migration);
    this.database.exec(sql);
    this.database
      .prepare(
        "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      )
      .run(migration.version, migration.name, checksum(sql), this.now());
  }

  private validateAppliedRows(
    appliedRows: Array<{ version: number; name: string; checksum: string }>,
    files: MigrationFile[],
  ): void {
    for (let index = 0; index < appliedRows.length; index += 1) {
      const row = appliedRows[index];
      const expectedVersion = index + 1;
      if (row === undefined || row.version !== expectedVersion) {
        throw new StoreError(
          "MIGRATION_ERROR",
          `Applied migration versions must be contiguous: expected ${expectedVersion}, found ${row?.version ?? "missing"}`,
          { expectedVersion, actualVersion: row?.version },
        );
      }
    }

    for (const row of appliedRows) {
      const migration = files.find((file) => file.version === row.version);
      if (
        !migration ||
        migration.name !== row.name ||
        row.checksum !== checksum(this.readMigrationSql(migration))
      ) {
        throw new StoreError(
          "MIGRATION_ERROR",
          `Applied migration ${row.version} does not match the local migration set`,
          {
            appliedName: row.name,
            appliedChecksum: row.checksum,
            version: row.version,
          },
        );
      }
    }
  }

  private readMigrationSql(migration: MigrationFile): string {
    return readFileSync(join(this.migrationsDir, migration.filename), "utf8");
  }

  private validateEventsBeforeContractMigration(): void {
    const rows = this.database
      .prepare("SELECT * FROM events ORDER BY seq ASC")
      .all() as unknown as LegacyEventRow[];

    for (const row of rows) {
      const seq = requireMigrationInteger(row.seq, "seq");
      const envelope: EventEnvelope = {
        schemaVersion: requireMigrationString(
          row.schema_version,
          "schema_version",
          seq,
        ) as "1",
        eventVersion: requireMigrationString(
          row.event_version,
          "event_version",
          seq,
        ),
        id: requireMigrationString(row.id, "id", seq),
        type: requireMigrationString(row.type, "type", seq),
        occurredAt: epochToTimestamp(row.occurred_at, "occurred_at", seq),
        observedAt: epochToTimestamp(row.observed_at, "observed_at", seq),
        recordedAt: epochToTimestamp(row.recorded_at, "recorded_at", seq),
        actor: {
          type: requireMigrationString(
            row.actor_type,
            "actor_type",
            seq,
          ) as EventEnvelope["actor"]["type"],
          id: requireMigrationString(row.actor_id, "actor_id", seq),
        },
        source: parseMigrationJson(
          row.source_json,
          "source_json",
          seq,
        ) as unknown as SourceRef,
        payload: parseMigrationJson(row.payload_json, "payload_json", seq),
        provenance: parseMigrationJson(
          row.provenance_json,
          "provenance_json",
          seq,
        ) as unknown as Provenance,
      };

      if (row.session_id !== null) {
        envelope.sessionId = requireMigrationString(
          row.session_id,
          "session_id",
          seq,
        );
      }
      if (row.trace_id !== null) {
        envelope.traceId = requireMigrationString(
          row.trace_id,
          "trace_id",
          seq,
        );
      }
      if (row.operation_id !== null) {
        envelope.operationId = requireMigrationString(
          row.operation_id,
          "operation_id",
          seq,
        );
      }
      if (row.evidence_json !== null) {
        envelope.evidence = parseMigrationJson(
          row.evidence_json,
          "evidence_json",
          seq,
        ) as unknown as EvidenceRef[];
      }
      if (row.links_json !== null) {
        envelope.links = parseMigrationJson(
          row.links_json,
          "links_json",
          seq,
        ) as unknown as EventLinks;
      }

      const parsed = eventEnvelopeSchema.safeParse(envelope);
      if (!parsed.success) {
        throw new StoreError(
          "MIGRATION_ERROR",
          `Legacy event ${seq} does not satisfy the v1 contract; migration aborted (RFC MISMATCH)`,
          { seq, issues: parsed.error.issues },
        );
      }

      const storedHash = requireMigrationString(
        row.content_hash,
        "content_hash",
        seq,
      );
      const expectedHash = createHash("sha256")
        .update(stableStringify(parsed.data as unknown as JsonValue))
        .digest("hex");
      if (storedHash !== expectedHash) {
        throw new StoreError(
          "MIGRATION_ERROR",
          `Legacy event ${seq} content hash mismatch; migration aborted`,
          { seq, expectedHash, storedHash },
        );
      }
    }
  }
}

function requireMigrationString(
  value: unknown,
  field: string,
  seq: number,
): string {
  if (typeof value !== "string") {
    throw new StoreError(
      "MIGRATION_ERROR",
      `Legacy event ${seq} has invalid ${field}`,
      { seq, field },
    );
  }
  return value;
}

function requireMigrationInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StoreError(
      "MIGRATION_ERROR",
      `Legacy ${field} is not a safe integer`,
      { field, value },
    );
  }
  return value;
}

function epochToTimestamp(value: unknown, field: string, seq: number): string {
  const milliseconds = requireMigrationInteger(value, field);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw new StoreError(
      "MIGRATION_ERROR",
      `Legacy event ${seq} has an invalid ${field} timestamp`,
      { seq, field, value },
    );
  }
  return date.toISOString();
}

function parseMigrationJson(
  value: unknown,
  field: string,
  seq: number,
): JsonValue {
  if (typeof value !== "string") {
    throw new StoreError(
      "MIGRATION_ERROR",
      `Legacy event ${seq} has invalid ${field} storage`,
      { seq, field },
    );
  }
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StoreError(
      "MIGRATION_ERROR",
      `Legacy event ${seq} has invalid JSON in ${field}`,
      { seq, field, cause: message },
    );
  }
}
