import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  eventEnvelopeSchema,
  stableStringify,
  validatePhase3EventPayload,
} from "@praxis/contracts";
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

interface MigrationEventReference {
  seq: number;
  type: string;
  payload: JsonValue;
  evidence?: JsonValue;
  links?: JsonValue;
  provenance: JsonValue;
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
    if (migration.version === 6) {
      this.validatePhase3EventsBeforeIntegrityMigration();
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

  private validatePhase3EventsBeforeIntegrityMigration(): void {
    const rows = this.database
      .prepare(
        `
        SELECT seq, id, type, operation_id,
               occurred_at, observed_at, recorded_at,
               payload_json, evidence_json, links_json, provenance_json
        FROM events
        WHERE type IN (
          'expectation.registered',
          'context.plan.created',
          'context.item.exposed',
          'residual.detected',
          'reflection.proposed'
        )
        ORDER BY seq ASC
        `,
      )
      .all() as Array<{
      seq: unknown;
      id: unknown;
      type: unknown;
      operation_id: unknown;
      occurred_at: unknown;
      observed_at: unknown;
      recorded_at: unknown;
      payload_json: unknown;
      evidence_json: unknown;
      links_json: unknown;
      provenance_json: unknown;
    }>;
    const allEvents = this.database
      .prepare(
        `SELECT id, seq, type, payload_json, evidence_json,
                links_json, provenance_json
         FROM events`,
      )
      .all() as Array<{
      id: unknown;
      seq: unknown;
      type: unknown;
      payload_json: unknown;
      evidence_json: unknown;
      links_json: unknown;
      provenance_json: unknown;
    }>;
    const eventById: Map<string, MigrationEventReference> = new Map(
      allEvents.map(
        (row) =>
          [
            requireMigrationString(row.id, "id", 0),
            {
              seq: requireMigrationInteger(row.seq, "seq"),
              type: requireMigrationString(
                row.type,
                "type",
                requireMigrationInteger(row.seq, "seq"),
              ),
              payload: parseMigrationJson(
                row.payload_json,
                "payload_json",
                requireMigrationInteger(row.seq, "seq"),
              ),
              evidence:
                row.evidence_json === null
                  ? undefined
                  : parseMigrationJson(
                      row.evidence_json,
                      "evidence_json",
                      requireMigrationInteger(row.seq, "seq"),
                    ),
              links:
                row.links_json === null
                  ? undefined
                  : parseMigrationJson(
                      row.links_json,
                      "links_json",
                      requireMigrationInteger(row.seq, "seq"),
                    ),
              provenance: parseMigrationJson(
                row.provenance_json,
                "provenance_json",
                requireMigrationInteger(row.seq, "seq"),
              ),
            } as MigrationEventReference,
          ] as [string, MigrationEventReference],
      ),
    );
    const ledgerLastSeq = allEvents.reduce(
      (lastSeq, row) =>
        Math.max(lastSeq, requireMigrationInteger(row.seq, "seq")),
      0,
    );
    const latestReflectionByResidual = new Map<
      string,
      { id: string; toSeq: number }
    >();

    for (const row of rows) {
      const seq = requireMigrationInteger(row.seq, "seq");
      const id = requireMigrationString(row.id, "id", seq);
      const type = requireMigrationString(row.type, "type", seq);
      const operationId =
        row.operation_id === null
          ? null
          : requireMigrationString(row.operation_id, "operation_id", seq);
      const payload = parseMigrationJson(row.payload_json, "payload_json", seq);
      const evidence =
        row.evidence_json === null
          ? null
          : parseMigrationJson(row.evidence_json, "evidence_json", seq);
      const links =
        row.links_json === null
          ? null
          : parseMigrationJson(row.links_json, "links_json", seq);
      const provenance = parseMigrationJson(
        row.provenance_json,
        "provenance_json",
        seq,
      );
      let canonicalPayload;
      try {
        canonicalPayload = validatePhase3EventPayload(type, payload);
      } catch (error) {
        throw phase3MigrationError(
          seq,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (canonicalPayload !== undefined) {
        const envelopeEvidence = assertMigrationEvidenceList(
          evidence,
          eventById,
          seq,
          `${type} envelope evidence`,
          false,
        );
        const payloadEvidence = assertMigrationEvidenceList(
          (canonicalPayload as { evidence: unknown }).evidence,
          eventById,
          seq,
          `${type} payload evidence`,
          false,
        );
        assertMigrationValue(
          stableStringify(envelopeEvidence) ===
            stableStringify(payloadEvidence),
          seq,
          `${type} envelope and payload evidence differ`,
        );
        assertMigrationPhase3Identity(
          type,
          id,
          operationId,
          row.occurred_at,
          row.observed_at,
          row.recorded_at,
          canonicalPayload as unknown as JsonValue,
          provenance,
          seq,
        );
        if (type === "reflection.proposed") {
          const reflectionPayload = canonicalPayload as {
            hypotheses: Array<{
              support: unknown;
              counterevidence: unknown;
            }>;
            evidenceDelta: {
              evidence: unknown;
              fromSeq: number;
              toSeq: number;
            };
          };
          for (const hypothesis of reflectionPayload.hypotheses) {
            assertMigrationEvidenceList(
              hypothesis.support,
              eventById,
              seq,
              "reflection hypothesis support",
              false,
            );
            assertMigrationEvidenceList(
              hypothesis.counterevidence,
              eventById,
              seq,
              "reflection hypothesis counterevidence",
              true,
            );
          }
          assertMigrationEvidenceList(
            reflectionPayload.evidenceDelta.evidence,
            eventById,
            seq,
            "reflection evidence delta",
            reflectionPayload.evidenceDelta.fromSeq ===
              reflectionPayload.evidenceDelta.toSeq,
          );
        }
      }
      const payloadObject = migrationObject(payload, seq, "payload");
      const provenanceObject = migrationObject(provenance, seq, "provenance");
      if (
        provenanceObject.origin !== "inferred" &&
        type !== "expectation.registered"
      ) {
        throw phase3MigrationError(
          seq,
          `${type} must have inferred provenance before integrity migration`,
        );
      }
      if (type === "expectation.registered") {
        assertMigrationValue(
          payloadObject.materialClassification === "declared" &&
            typeof payloadObject.expectationId === "string" &&
            payloadObject.expectationId.length > 0 &&
            operationId === payloadObject.expectationId &&
            typeof payloadObject.subject === "object" &&
            payloadObject.expected !== undefined &&
            ["exact", "predicate", "external"].includes(
              String(payloadObject.verification),
            ) &&
            typeof payloadObject.createdAt === "string" &&
            Array.isArray(payloadObject.evidence) &&
            payloadObject.evidence.length > 0 &&
            Array.isArray(evidence) &&
            evidence.length > 0 &&
            provenanceObject.origin === "declared",
          seq,
          "expectation.registered shape is not recoverable",
        );
      } else if (type === "context.plan.created") {
        assertMigrationValue(
          payloadObject.classification === "candidate" &&
            typeof payloadObject.planId === "string" &&
            payloadObject.planId.length > 0 &&
            operationId === payloadObject.planId &&
            Array.isArray(payloadObject.candidateSources) &&
            Array.isArray(payloadObject.selected) &&
            Array.isArray(payloadObject.reasons) &&
            Array.isArray(payloadObject.exposureProposals) &&
            Number.isSafeInteger(payloadObject.stateSeq) &&
            Number(payloadObject.stateSeq) >= 0 &&
            Number(payloadObject.stateSeq) <= ledgerLastSeq &&
            isMigrationObject(links),
          seq,
          "context.plan.created shape is not recoverable",
        );
        for (const candidate of payloadObject.candidateSources) {
          const source = migrationObject(candidate, seq, "candidate source");
          const sourceId = source.sourceEventId;
          const sourceRecord =
            typeof sourceId === "string" ? eventById.get(sourceId) : undefined;
          assertMigrationValue(
            typeof source.id === "string" &&
              typeof sourceId === "string" &&
              Number.isSafeInteger(source.seq) &&
              typeof source.sourceOrigin === "string" &&
              sourceRecord !== undefined &&
              sourceRecord.seq === source.seq &&
              migrationOrigin(sourceRecord.provenance) === source.sourceOrigin,
            seq,
            "context plan candidate source is not recoverable",
          );
        }
      } else if (type === "context.item.exposed") {
        assertMigrationValue(
          payloadObject.materialClassification === "inferred" &&
            typeof payloadObject.planId === "string" &&
            typeof payloadObject.itemId === "string" &&
            typeof payloadObject.sourceEventId === "string" &&
            typeof payloadObject.sourceOrigin === "string" &&
            typeof payloadObject.sourceId === "string" &&
            Number.isSafeInteger(payloadObject.stateSeq) &&
            isMigrationObject(links) &&
            Array.isArray(evidence) &&
            evidence.length >= 2,
          seq,
          "context.item.exposed shape is not recoverable",
        );
        const sourceRecord = eventById.get(String(payloadObject.sourceEventId));
        assertMigrationValue(
          sourceRecord !== undefined &&
            sourceRecord.seq <= Number(payloadObject.stateSeq) &&
            migrationOrigin(sourceRecord.provenance) ===
              payloadObject.sourceOrigin,
          seq,
          "context exposure source is not recoverable",
        );
      } else if (type === "residual.detected") {
        assertMigrationValue(
          payloadObject.materialClassification === "inferred" &&
            typeof payloadObject.residualId === "string" &&
            payloadObject.residualId.length > 0 &&
            operationId === payloadObject.residualId &&
            [
              "outcome",
              "timing",
              "rule",
              "representation",
              "relation",
              "retrospective",
            ].includes(String(payloadObject.kind)) &&
            payloadObject.effect === "unknown" &&
            isMigrationObject(payloadObject.observed) &&
            isMigrationObject(payloadObject.field) &&
            typeof payloadObject.confidence === "number" &&
            payloadObject.confidence >= 0 &&
            payloadObject.confidence <= 1 &&
            Array.isArray(payloadObject.evidence) &&
            payloadObject.evidence.length > 0 &&
            Array.isArray(evidence) &&
            evidence.length > 0 &&
            typeof payloadObject.detectedAt === "string",
          seq,
          "residual.detected shape is not recoverable",
        );
        if (payloadObject.kind === "outcome") {
          const baselineId = payloadObject.baselineId;
          const expectationRecord =
            typeof baselineId === "string"
              ? eventById.get(
                  `expectation-registered:${encodeURIComponent(baselineId)}`,
                )
              : undefined;
          assertMigrationValue(
            typeof baselineId === "string" &&
              baselineId.length > 0 &&
              isMigrationObject(payloadObject.baseline) &&
              expectationRecord !== undefined &&
              expectationRecord.type === "expectation.registered" &&
              migrationOrigin(expectationRecord.provenance) === "declared" &&
              isMigrationObject(expectationRecord.payload) &&
              expectationRecord.payload.expectationId === baselineId,
            seq,
            "outcome residual baseline is not recoverable",
          );
          const expectationPayload =
            expectationRecord === undefined
              ? undefined
              : expectationRecord.payload;
          const baseline = payloadObject.baseline;
          assertMigrationValue(
            isMigrationObject(expectationPayload) &&
              isMigrationObject(expectationPayload.subject) &&
              isMigrationObject(baseline) &&
              stableStringify(
                expectationPayload.subject as unknown as JsonValue,
              ) ===
                stableStringify({
                  kind: baseline.kind,
                  id: baseline.id,
                } as unknown as JsonValue) &&
              stableStringify(expectationPayload.expected as JsonValue) ===
                stableStringify(baseline.value as JsonValue),
            seq,
            "outcome residual baseline does not match expectation",
          );
        }
      } else if (type === "reflection.proposed") {
        const delta = payloadObject.evidenceDelta;
        const deltaObject = migrationObject(delta, seq, "evidence delta");
        const fromSeq =
          typeof deltaObject.fromSeq === "number" ? deltaObject.fromSeq : -1;
        const toSeq =
          typeof deltaObject.toSeq === "number" ? deltaObject.toSeq : -1;
        const deltaEvidence = deltaObject.evidence;
        assertMigrationValue(
          payloadObject.materialClassification === "inferred" &&
            typeof payloadObject.residualId === "string" &&
            payloadObject.residualId.length > 0 &&
            ["STOP", "CONTINUE", "ESCALATE"].includes(
              String(payloadObject.decision),
            ) &&
            Array.isArray(payloadObject.reasons) &&
            payloadObject.reasons.length > 0 &&
            Array.isArray(payloadObject.hypotheses) &&
            Array.isArray(payloadObject.recommendedActions) &&
            isMigrationObject(payloadObject.budget) &&
            isMigrationObject(payloadObject.budgetUsed) &&
            Number.isSafeInteger(fromSeq) &&
            fromSeq >= 0 &&
            Number.isSafeInteger(toSeq) &&
            toSeq >= 0 &&
            toSeq >= fromSeq &&
            Array.isArray(deltaEvidence) &&
            (toSeq > fromSeq
              ? deltaEvidence.length > 0
              : deltaEvidence.length === 0) &&
            Array.isArray(evidence) &&
            evidence.length > 0 &&
            operationId ===
              `reflection:${String(payloadObject.residualId)}:${String(toSeq)}` &&
            isMigrationObject(links),
          seq,
          "reflection.proposed shape is not recoverable",
        );
        const linkObject = migrationObject(links, seq, "reflection links");
        const respondsTo = linkObject.respondsTo;
        const linkedResidual = Array.isArray(respondsTo)
          ? respondsTo.find((value) => {
              if (typeof value !== "string") return false;
              const record = eventById.get(value);
              return (
                record !== undefined &&
                record.type === "residual.detected" &&
                isMigrationObject(record.payload) &&
                record.payload.residualId === payloadObject.residualId
              );
            })
          : undefined;
        assertMigrationValue(
          linkedResidual !== undefined,
          seq,
          "reflection proposal residual link is not recoverable",
        );
        const residualRecord =
          linkedResidual === undefined
            ? undefined
            : eventById.get(linkedResidual);
        const previousRound = latestReflectionByResidual.get(
          String(payloadObject.residualId),
        );
        assertMigrationValue(
          residualRecord !== undefined &&
            (previousRound === undefined
              ? fromSeq === residualRecord.seq
              : fromSeq === previousRound.toSeq && toSeq > previousRound.toSeq),
          seq,
          "reflection proposal round is not monotonic",
        );
        if (previousRound !== undefined) {
          const supersedes = linkObject.supersedes;
          assertMigrationValue(
            Array.isArray(supersedes) && supersedes.includes(previousRound.id),
            seq,
            "reflection proposal does not supersede the previous round",
          );
        }
        latestReflectionByResidual.set(String(payloadObject.residualId), {
          id,
          toSeq,
        });
      }

      if (id.length < 1) {
        throw phase3MigrationError(seq, "Phase 3 event id is empty");
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

function isMigrationObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function migrationObject(
  value: unknown,
  seq: number,
  field: string,
): Record<string, unknown> {
  if (!isMigrationObject(value)) {
    throw phase3MigrationError(seq, `${field} is not an object`);
  }
  return value;
}

function migrationOrigin(value: unknown): string | undefined {
  return isMigrationObject(value) && typeof value.origin === "string"
    ? value.origin
    : undefined;
}

function assertMigrationValue(
  condition: boolean,
  seq: number,
  message: string,
): asserts condition {
  if (!condition) throw phase3MigrationError(seq, message);
}

function assertMigrationEvidenceList(
  value: unknown,
  eventById: Map<string, MigrationEventReference>,
  seq: number,
  label: string,
  allowEmpty: boolean,
): JsonValue[] {
  assertMigrationValue(
    Array.isArray(value) && (allowEmpty || value.length > 0),
    seq,
    `${label} is missing or empty`,
  );
  for (const item of value) {
    const evidence = migrationObject(item, seq, label);
    assertMigrationValue(
      typeof evidence.origin === "string" &&
        ["direct", "declared", "inferred", "institutional"].includes(
          evidence.origin,
        ) &&
        (evidence.eventId === undefined ||
          (typeof evidence.eventId === "string" &&
            evidence.eventId.length > 0)) &&
        (evidence.assetId === undefined ||
          (typeof evidence.assetId === "string" &&
            evidence.assetId.length > 0)) &&
        (evidence.artifactHash === undefined ||
          (typeof evidence.artifactHash === "string" &&
            evidence.artifactHash.length > 0)) &&
        (evidence.exposureInfluenced === undefined ||
          typeof evidence.exposureInfluenced === "boolean") &&
        (evidence.eventId !== undefined ||
          evidence.assetId !== undefined ||
          evidence.artifactHash !== undefined),
      seq,
      `${label} contains an invalid evidence reference`,
    );
    if (typeof evidence.eventId !== "string") continue;
    const source = eventById.get(evidence.eventId);
    assertMigrationValue(
      source !== undefined &&
        source.seq < seq &&
        migrationOrigin(source.provenance) === evidence.origin,
      seq,
      `${label} references a missing, future, or mismatched event`,
    );
  }
  return value as JsonValue[];
}

function assertMigrationPhase3Identity(
  type: string,
  id: string,
  operationId: string | null,
  occurredAtValue: unknown,
  observedAtValue: unknown,
  recordedAtValue: unknown,
  payload: JsonValue,
  provenance: JsonValue,
  seq: number,
): void {
  const payloadObject = migrationObject(payload, seq, `${type} payload`);
  const provenanceObject = migrationObject(
    provenance,
    seq,
    `${type} provenance`,
  );
  const occurredAt = epochToTimestamp(occurredAtValue, "occurred_at", seq);
  const observedAt = epochToTimestamp(observedAtValue, "observed_at", seq);
  const recordedAt = epochToTimestamp(recordedAtValue, "recorded_at", seq);
  if (type === "expectation.registered") {
    const expectationId = String(payloadObject.expectationId);
    assertMigrationValue(
      id === `expectation-registered:${encodeURIComponent(expectationId)}` &&
        operationId === expectationId &&
        provenanceObject.origin === "declared" &&
        occurredAt === payloadObject.createdAt &&
        observedAt === payloadObject.createdAt &&
        recordedAt === payloadObject.createdAt,
      seq,
      "expectation.registered identity or timestamps are not canonical",
    );
    return;
  }
  if (type === "residual.detected") {
    const residualId = String(payloadObject.residualId);
    assertMigrationValue(
      id === `residual-detected:${encodeURIComponent(residualId)}` &&
        operationId === residualId &&
        provenanceObject.origin === "inferred" &&
        occurredAt === payloadObject.detectedAt &&
        observedAt === payloadObject.detectedAt &&
        recordedAt === payloadObject.detectedAt,
      seq,
      "residual.detected identity or timestamps are not canonical",
    );
    return;
  }
  const residualId = String(payloadObject.residualId);
  const evidenceDelta = migrationObject(
    payloadObject.evidenceDelta,
    seq,
    "reflection evidence delta",
  );
  assertMigrationValue(
    id ===
      `reflection-proposed:${encodeURIComponent(residualId)}:${String(evidenceDelta.toSeq)}` &&
      operationId ===
        `reflection:${residualId}:${String(evidenceDelta.toSeq)}` &&
      provenanceObject.origin === "inferred",
    seq,
    "reflection.proposed identity is not canonical",
  );
}

function phase3MigrationError(seq: number, message: string): StoreError {
  return new StoreError(
    "MIGRATION_ERROR",
    `Legacy Phase 3 event ${seq} ${message}; migration aborted (RFC MISMATCH)`,
    { seq },
  );
}
