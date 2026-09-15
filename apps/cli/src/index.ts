import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  authorizeWriterScope,
  isLegacyEventType,
  parseWriterContext,
  permissionScopes,
  stableStringify,
  type EventEnvelope,
  type JsonValue,
  type WriterContext,
} from "@praxis/contracts";
import {
  isRuntimeReservedEventType,
  RuntimeCompositionRoot,
  WriterOwnershipLock,
  type RuntimeMode,
} from "@praxis/runtime";
import { restoreDatabaseFile, SqliteEventStore } from "@praxis/store";

import {
  booleanFlag,
  optionalFlag,
  parseArgs,
  parseJsonArgument,
  requireFlag,
  requirePositional,
  type ParsedCommand,
} from "./args.js";
import { configAuditFields, loadConfig, type LoadedConfig } from "./config.js";
import { classifyError, CliError, exitCodes, newTraceId } from "./errors.js";
import {
  processSink,
  renderFailure,
  renderSuccess,
  type CommandOutcome,
  type OutputSink,
} from "./output.js";

/**
 * Praxis command line.
 *
 * The command line is an adapter: it resolves configuration and environment,
 * then calls runtime use cases. It owns no domain rule. Where a command needs
 * a decision the runtime already makes — whether an event family may use the
 * generic append, what a promotion policy requires, what an import plan hash
 * covers — the command asks the runtime rather than restating the rule.
 */

interface ResolvedEnvironment {
  config: LoadedConfig;
  dataDir: string;
  databasePath: string;
  migrationsDir: string;
  backupsDir: string;
  legacyArchiveRoot: string;
  actor: { type: "human" | "model" | "agent" | "tool" | "system"; id: string };
  writer: WriterContext;
}

function resolveEnvironment(
  parsed: ParsedCommand,
  env: Record<string, string | undefined>,
  cwd: string,
): ResolvedEnvironment {
  const loaded = loadConfig(optionalFlag(parsed, "config"), env, cwd);
  const config = loaded.config;

  const dataDir = resolve(
    optionalFlag(parsed, "data-dir") ??
      config.dataDir ??
      env["PRAXIS_DATA_DIR"] ??
      join(cwd, ".praxis"),
  );
  const migrationsDir = resolve(
    config.migrationsDir ??
      env["PRAXIS_MIGRATIONS_DIR"] ??
      join(cwd, "migrations"),
  );
  const backupsDir = resolve(
    config.backupsDir ?? env["PRAXIS_BACKUPS_DIR"] ?? join(dataDir, "backups"),
  );
  const legacyArchiveRoot = resolve(
    optionalFlag(parsed, "archive") ??
      config.legacyArchiveRoot ??
      env["PRAXIS_LEGACY_ARCHIVE"] ??
      join(dataDir, "legacy-archive"),
  );

  const actor = {
    type: config.actor?.type ?? ("human" as const),
    id:
      optionalFlag(parsed, "actor") ??
      config.actor?.id ??
      config.actorId ??
      env["PRAXIS_ACTOR_ID"] ??
      "local-owner",
  };
  const writer = parseWriterContext({
    writerId:
      optionalFlag(parsed, "writer") ??
      config.writerId ??
      env["PRAXIS_WRITER_ID"] ??
      "local:owner",
    kind: "human",
    role: "OWNER",
    authn: "embedded-local",
    scopes: [...permissionScopes],
    policyVersion: 1,
  });

  return {
    config: loaded,
    dataDir,
    databasePath: resolve(
      optionalFlag(parsed, "database") ?? join(dataDir, "events.db"),
    ),
    migrationsDir,
    backupsDir,
    legacyArchiveRoot,
    actor,
    writer,
  };
}

function openRoot(
  environment: ResolvedEnvironment,
  mode: RuntimeMode,
  options: {
    databasePath?: string;
    existingLock?: WriterOwnershipLock;
    lock?: WriterOwnershipLock;
    acquire?: boolean;
  } = {},
): { root: RuntimeCompositionRoot; lock: WriterOwnershipLock } {
  mkdirSync(environment.dataDir, { recursive: true });
  mkdirSync(environment.backupsDir, { recursive: true });
  const databasePath = resolve(
    options.databasePath ?? environment.databasePath,
  );
  const lock =
    options.lock ??
    options.existingLock ??
    new WriterOwnershipLock(`${databasePath}.writer.lock`);
  if (options.acquire !== false && options.existingLock === undefined) {
    lock.acquire({
      pid: process.pid,
      mode,
      startedAt: new Date().toISOString(),
      dbPath: databasePath,
    });
  }
  let store: SqliteEventStore | undefined;
  try {
    store = new SqliteEventStore({
      filename: databasePath,
      migrationsDir: environment.migrationsDir,
      managedBackupRoot: environment.backupsDir,
    });
    const root = new RuntimeCompositionRoot({
      store,
      mode,
      lock,
      actor: environment.actor,
      writer: environment.writer,
      ...(environment.config.config.promotionPolicy === undefined
        ? {}
        : { promotionPolicy: environment.config.config.promotionPolicy }),
    }).start();
    return { root, lock };
  } catch (error) {
    store?.close();
    if (options.acquire !== false && options.existingLock === undefined) {
      lock.release();
    }
    throw error;
  }
}

function integerFlag(
  parsed: ParsedCommand,
  name: string,
  fallback: number,
): number {
  const raw = optionalFlag(parsed, name);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CliError(
      "USAGE_ERROR",
      `--${name} must be a non-negative integer`,
      { received: raw },
    );
  }
  return value;
}

function describeEvent(record: {
  seq: number;
  id: string;
  type: string;
  recordedAt: string;
  provenance: { origin: string; confidence: number };
}): string {
  return `${String(record.seq).padStart(6, " ")}  ${record.recordedAt}  ${record.type}  ${record.id}  [${record.provenance.origin}]`;
}

// --- Commands -----------------------------------------------------------------

function commandInit(
  environment: ResolvedEnvironment,
  _parsed: ParsedCommand,
): CommandOutcome {
  mkdirSync(environment.dataDir, { recursive: true });
  mkdirSync(environment.backupsDir, { recursive: true });
  if (!existsSync(environment.migrationsDir)) {
    throw new CliError(
      "CONFIG_ERROR",
      `migrations directory not found: ${environment.migrationsDir}`,
    );
  }
  const { root } = openRoot(environment, "embedded");
  try {
    const health = root.getHealth();
    // A configuration change is recorded as an event, not as a silent
    // difference: only safe fields and a digest are written.
    const audit = configAuditFields(environment.config);
    const previous = root
      .exportEvents({ type: "system.config.changed" })
      .slice(-1)[0];
    const previousHash =
      previous === undefined
        ? undefined
        : (previous.payload as { configHash?: string }).configHash;
    let configChanged = false;
    if (previousHash !== audit["configHash"]) {
      const now = root.clock.now().toISOString();
      root.runtime.appendEvent({
        schemaVersion: "1",
        eventVersion: "1",
        id: `system-config-changed:${randomUUID()}`,
        type: "system.config.changed",
        occurredAt: now,
        observedAt: now,
        recordedAt: now,
        actor: environment.actor,
        sessionId: "system:configuration",
        operationId: `system-config-changed:${String(audit["configHash"])}`,
        source: { kind: "praxis-cli", ref: "init" },
        payload: {
          materialClassification: "declared",
          ...audit,
        } as unknown as JsonValue,
        evidence: [
          {
            artifactHash: environment.config.hash
              .replace(/^fnv1a32:/, "")
              .padEnd(64, "0"),
            origin: "declared",
          },
        ],
        provenance: { origin: "declared", confidence: 1 },
      });
      configChanged = true;
      // The ledger now holds one more event than the projections have seen.
      // Catching up here keeps "init then doctor" a clean sequence instead of
      // leaving a lag that doctor would immediately, and correctly, report.
      root.catchUpCoreProjections();
    }
    return {
      data: {
        dataDir: environment.dataDir,
        databasePath: root.databasePath,
        migrationsDir: environment.migrationsDir,
        backupsDir: environment.backupsDir,
        migrationVersion: health.migrationVersion ?? null,
        lastSeq: health.lastSeq,
        configPath: environment.config.path,
        configHash: environment.config.hash,
        configChanged,
      },
      lines: [
        `data directory   ${environment.dataDir}`,
        `database         ${root.databasePath}`,
        `migrations       ${environment.migrationsDir}`,
        `backups          ${environment.backupsDir}`,
        `config           ${environment.config.path ?? "(defaults; no praxis.config.json found)"}`,
        `ledger last seq  ${health.lastSeq}`,
        configChanged
          ? "recorded system.config.changed"
          : "configuration unchanged since the last recorded digest",
      ],
    };
  } finally {
    root.close();
  }
}

function commandDoctor(
  environment: ResolvedEnvironment,
  _parsed: ParsedCommand,
): CommandOutcome & { failed?: boolean } {
  const { root } = openRoot(environment, "embedded");
  try {
    const report = root.doctor();
    const checks = root.getHealth();
    const configCheck = {
      name: "config",
      status: "pass" as const,
      message:
        environment.config.path === null
          ? "no configuration file; defaults are in effect"
          : "configuration file schema and fields are valid",
      details: {
        path: environment.config.path,
        hash: environment.config.hash,
      },
    };
    const checksWithConfig = [configCheck, ...report.checks];
    const failed = checksWithConfig.some((check) => check.status === "fail");
    return {
      data: {
        schemaVersion: "1",
        status: failed ? "fail" : "pass",
        command: "doctor",
        checks: checksWithConfig,
        health: checks,
      },
      lines: [
        ...checksWithConfig.map(
          (check) =>
            `${check.status === "pass" ? "ok  " : check.status === "fail" ? "FAIL" : "info"}  ${check.name}  ${check.message}`,
        ),
        failed ? "doctor: FAIL" : "doctor: pass",
      ],
      failed,
    };
  } finally {
    root.close();
  }
}

function commandEvent(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const { root } = openRoot(environment, "embedded");
  try {
    if (parsed.subcommand === "append") {
      const type = requireFlag(parsed, "type");
      if (isRuntimeReservedEventType(type) || isLegacyEventType(type)) {
        throw new CliError(
          "INVARIANT_VIOLATION",
          `${type} must be recorded through its runtime use case, not the generic append`,
          { eventType: type },
        );
      }
      const rawPayload = optionalFlag(parsed, "payload") ?? "{}";
      const payload = parseJsonArgument(rawPayload, "--payload");
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload)
      ) {
        throw new CliError(
          "VALIDATION_ERROR",
          "--payload must be a JSON object",
        );
      }
      const now =
        optionalFlag(parsed, "occurred-at") ?? root.clock.now().toISOString();
      const event: EventEnvelope = {
        schemaVersion: "1",
        eventVersion: optionalFlag(parsed, "event-version") ?? "1",
        id: optionalFlag(parsed, "id") ?? randomUUID(),
        type,
        occurredAt: now,
        observedAt: now,
        recordedAt: now,
        actor: environment.actor,
        ...(optionalFlag(parsed, "session") === undefined
          ? {}
          : { sessionId: optionalFlag(parsed, "session") as string }),
        ...(optionalFlag(parsed, "trace") === undefined
          ? {}
          : { traceId: optionalFlag(parsed, "trace") as string }),
        ...(optionalFlag(parsed, "operation") === undefined
          ? {}
          : { operationId: optionalFlag(parsed, "operation") as string }),
        source: {
          kind: optionalFlag(parsed, "source-kind") ?? "praxis-cli",
          ref: optionalFlag(parsed, "source-ref") ?? type,
        },
        payload: payload as JsonValue,
        evidence: [
          {
            artifactHash:
              optionalFlag(parsed, "artifact-hash") ?? "0".repeat(64),
            origin: "declared",
          },
        ],
        provenance: { origin: "declared", confidence: 1 },
      };
      const result = root.runtime.appendEvent(event);
      return {
        data: {
          seq: result.record.seq,
          id: result.record.id,
          type: result.record.type,
          inserted: result.inserted,
        },
        lines: [
          `${result.inserted ? "recorded" : "already present"} seq=${result.record.seq} ${result.record.type} ${result.record.id}`,
        ],
      };
    }

    const records = root.exportEvents({
      ...(optionalFlag(parsed, "type") === undefined
        ? {}
        : { type: optionalFlag(parsed, "type") as string }),
      ...(optionalFlag(parsed, "session") === undefined
        ? {}
        : { sessionId: optionalFlag(parsed, "session") as string }),
      limit: integerFlag(parsed, "limit", 50),
    });
    return {
      data: { schemaVersion: "1", count: records.length, events: records },
      lines:
        records.length === 0
          ? ["(no events)"]
          : records.map((record) => describeEvent(record)),
    };
  } finally {
    root.close();
  }
}

function commandState(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const { root } = openRoot(environment, "embedded");
  try {
    const name = optionalFlag(parsed, "projection");
    const health = root.getHealth();
    const projections =
      name === undefined
        ? health.projections
        : health.projections.filter((item) => item.projectionName === name);
    if (name !== undefined && projections.length === 0) {
      throw new CliError(
        "VALIDATION_ERROR",
        `no projection named ${name}; known projections: ${health.projections
          .map((item) => item.projectionName)
          .join(", ")}`,
      );
    }
    const states = projections.map((projection) => ({
      projectionName: projection.projectionName,
      lastSeq: projection.lastSeq,
      projectionVersion: projection.projectionVersion,
      lag: projection.lag,
      state: root.getProjectionState(projection.projectionName)?.state ?? null,
    }));
    return {
      data: {
        schemaVersion: "1",
        ledgerLastSeq: health.lastSeq,
        projections: states,
      },
      lines: states.map(
        (item) =>
          `${item.projectionName}  lastSeq=${item.lastSeq}  version=${item.projectionVersion}  lag=${item.lag}`,
      ),
    };
  } finally {
    root.close();
  }
}

function commandRebuild(
  environment: ResolvedEnvironment,
  _parsed: ParsedCommand,
): CommandOutcome {
  const { root } = openRoot(environment, "embedded");
  try {
    const results = root.rebuildCoreProjections();
    return {
      data: { schemaVersion: "1", rebuilt: results },
      lines: results.map(
        (result) =>
          `${result.projectionName}  rebuilt to seq ${result.lastSeq}  (${result.applied} applied)`,
      ),
    };
  } finally {
    root.close();
  }
}

function commandContext(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const candidatesPath = requireFlag(parsed, "candidates");
  if (!existsSync(candidatesPath)) {
    throw new CliError(
      "CONFIG_ERROR",
      `candidate file not found: ${candidatesPath}`,
    );
  }
  const candidates = parseJsonArgument(
    readTextFile(candidatesPath),
    "--candidates",
  );
  if (!Array.isArray(candidates)) {
    throw new CliError(
      "VALIDATION_ERROR",
      "--candidates must contain a JSON array of context sources",
    );
  }
  const { root } = openRoot(environment, "embedded");
  try {
    const health = root.getHealth();
    const plan = root.runtime.buildContextPlan({
      mode: (optionalFlag(parsed, "mode") ?? "refresh") as never,
      candidates: candidates as never,
      budget: {
        maxItems: integerFlag(parsed, "max-items", 20),
        maxTokens: integerFlag(parsed, "max-tokens", 4000),
        ...(optionalFlag(parsed, "model-hint") === undefined
          ? {}
          : { modelHint: optionalFlag(parsed, "model-hint") as string }),
      },
      stateSeq: health.lastSeq,
      ...(optionalFlag(parsed, "task-id") === undefined
        ? {}
        : { taskId: optionalFlag(parsed, "task-id") as string }),
      ...(optionalFlag(parsed, "project-id") === undefined
        ? {}
        : { projectId: optionalFlag(parsed, "project-id") as string }),
    });
    if (booleanFlag(parsed, "record")) {
      root.runtime.recordContextPlan(plan);
    }
    return {
      data: { schemaVersion: "1", plan },
      lines: [
        `mode ${plan.mode}  selected ${plan.selected.length} of ${plan.candidateSources.length} candidates  stateSeq ${plan.stateSeq}`,
        ...plan.selected.map(
          (item) =>
            `  ${item.id}  ${item.sourceOrigin}  ${item.sourceId}  score ${item.score.toFixed(3)}  ~${item.tokenEstimate} tokens`,
        ),
      ],
    };
  } finally {
    root.close();
  }
}

function commandResidualList(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const { root } = openRoot(environment, "embedded");
  try {
    const records = root.exportEvents({
      type: "residual.detected",
      limit: integerFlag(parsed, "limit", 50),
    });
    return {
      data: { schemaVersion: "1", count: records.length, residuals: records },
      lines:
        records.length === 0
          ? ["(no recorded residuals)"]
          : records.map((record) => {
              const payload = record.payload as {
                kind?: string;
                effect?: string;
                confidence?: number;
              };
              return `${String(record.seq).padStart(6, " ")}  ${payload.kind ?? "?"}  effect=${payload.effect ?? "unknown"}  confidence=${payload.confidence ?? "?"}  ${record.id}`;
            }),
    };
  } finally {
    root.close();
  }
}

function commandReflectionRun(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const residualEventId = requireFlag(parsed, "residual");
  const evidence = optionalFlag(parsed, "evidence");
  const { root } = openRoot(environment, "embedded");
  try {
    const input = root.runtime.reflectionInputForResidual(residualEventId, {
      budget: {
        maxDepth: integerFlag(parsed, "max-depth", 2),
        maxHypotheses: integerFlag(parsed, "max-hypotheses", 3),
        maxToolCalls: integerFlag(parsed, "max-tool-calls", 0),
        maxElapsedMs: integerFlag(parsed, "max-elapsed-ms", 30_000),
      },
      ...(evidence === undefined
        ? {}
        : { evidenceEventIds: evidence.split(",").filter(Boolean) }),
    });
    const result = root.runtime.runReflection(input);
    return {
      data: {
        schemaVersion: "1",
        residualEventId,
        input: { budget: input.budget, evidenceDelta: input.evidenceDelta },
        result,
      },
      lines: [
        `decision ${result.decision}`,
        ...result.reasons.map((reason) => `  reason: ${reason}`),
        ...(result.recommendedActions ?? []).map(
          (action) =>
            `  proposed: ${action.kind} (requires ${action.requiredPermission ?? "none"})`,
        ),
        "a proposal is not an execution; nothing was performed",
      ],
    };
  } finally {
    root.close();
  }
}

function commandAsset(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const { root } = openRoot(environment, "embedded");
  try {
    switch (parsed.subcommand) {
      case "list": {
        const assets = root.listAssets();
        return {
          data: { schemaVersion: "1", count: assets.length, assets },
          lines:
            assets.length === 0
              ? ["(no managed assets)"]
              : assets.map(
                  (asset) =>
                    `${asset.id}  ${asset.kind}  ${asset.status}  revision ${asset.revision}`,
                ),
        };
      }
      case "inspect": {
        const id = requirePositional(parsed, 0, "asset id");
        const asset = root.inspectAsset(id);
        if (asset === null) {
          throw new CliError("VALIDATION_ERROR", `no managed asset ${id}`);
        }
        return {
          data: { schemaVersion: "1", asset },
          lines: [
            `${asset.id}  ${asset.kind}  ${asset.status}  revision ${asset.revision}`,
            `derived from ${asset.derivedFrom.length} evidence reference(s)`,
            ...(asset.forkedFrom === undefined
              ? []
              : [
                  `forked from ${asset.forkedFrom.id}@${asset.forkedFrom.revision}`,
                ]),
          ],
        };
      }
      case "contest":
      case "disable":
      case "restore":
      case "fork":
      case "activate": {
        const id = requirePositional(parsed, 0, "asset id");
        const reason = requireFlag(parsed, "reason");
        const at = optionalFlag(parsed, "at") ?? root.clock.now().toISOString();
        let result;
        if (parsed.subcommand === "contest") {
          result = root.runtime.contestAsset(id, reason, at);
        } else if (parsed.subcommand === "disable") {
          result = root.runtime.disableAsset(id, reason, at);
        } else if (parsed.subcommand === "restore") {
          result = root.runtime.restoreAsset(id, reason, at);
        } else if (parsed.subcommand === "fork") {
          result = root.runtime.forkAsset(
            id,
            requireFlag(parsed, "new-id"),
            reason,
            at,
          );
        } else {
          // Activation requires the full promotion review, so the command
          // reads it from a file rather than assembling one from flags. The
          // policy that judges it stays in the runtime.
          const reviewPath = requireFlag(parsed, "review");
          if (!existsSync(reviewPath)) {
            throw new CliError(
              "CONFIG_ERROR",
              `promotion review file not found: ${reviewPath}`,
            );
          }
          const review = parseJsonArgument(
            readTextFile(reviewPath),
            "--review",
          );
          result = root.runtime.promoteAsset(
            id,
            {
              ...(review as Record<string, unknown>),
              targetStatus: "active",
              ...(booleanFlag(parsed, "human-confirmed")
                ? { humanConfirmed: true }
                : {}),
            } as never,
            at,
          );
        }
        return {
          data: {
            schemaVersion: "1",
            assetId: id,
            action: parsed.subcommand,
            seq: result.record.seq,
            eventId: result.record.id,
          },
          lines: [
            `${parsed.subcommand} recorded for ${id} at seq ${result.record.seq}`,
          ],
        };
      }
      default:
        throw new CliError(
          "USAGE_ERROR",
          `unknown asset subcommand ${String(parsed.subcommand)}`,
        );
    }
  } finally {
    root.close();
  }
}

function commandHistoryExplain(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const reference = requirePositional(parsed, 0, "event or asset id");
  const { root } = openRoot(environment, "embedded");
  try {
    const chain: Array<{
      kind: string;
      id: string;
      type?: string;
      origin?: string;
      relation?: string;
    }> = [];
    const seen = new Set<string>();
    let current: string | undefined = reference;
    let relation: string | undefined;

    while (current !== undefined && chain.length < 64) {
      if (seen.has(current)) {
        chain.push({ kind: "cycle", id: current });
        break;
      }
      seen.add(current);
      const asset = root.inspectAsset(current);
      if (asset !== null) {
        chain.push({
          kind: "asset",
          id: asset.id,
          type: `${asset.kind}:${asset.status}`,
          ...(relation === undefined ? {} : { relation }),
        });
        for (const evidence of asset.derivedFrom) {
          if (evidence.eventId !== undefined && !seen.has(evidence.eventId)) {
            const record = root.inspectEvent(evidence.eventId);
            if (record !== null) {
              chain.push({
                kind: "event",
                id: record.id,
                type: record.type,
                origin: record.provenance.origin,
                relation: "derivedFrom",
              });
              seen.add(record.id);
            }
          }
        }
        current = undefined;
        break;
      }
      const record = root.inspectEvent(current);
      if (record === null) {
        throw new CliError(
          "VALIDATION_ERROR",
          `no event or asset matches ${current}`,
        );
      }
      chain.push({
        kind: "event",
        id: record.id,
        type: record.type,
        origin: record.provenance.origin,
        ...(relation === undefined ? {} : { relation }),
      });
      const next =
        record.links?.derivedFrom?.[0] ??
        record.links?.causedBy?.[0] ??
        record.links?.respondsTo?.[0];
      relation =
        record.links?.derivedFrom?.[0] !== undefined
          ? "derivedFrom"
          : record.links?.causedBy?.[0] !== undefined
            ? "causedBy"
            : "respondsTo";
      current = next ?? undefined;
    }

    return {
      data: { schemaVersion: "1", start: reference, chain },
      lines:
        chain.length === 1
          ? [`${chain[0]?.kind} ${chain[0]?.id} has no recorded ancestry`]
          : chain.map(
              (link) =>
                `${link.kind.padEnd(6)} ${link.id}  ${link.type ?? ""}  ${link.origin ?? ""}  ${link.relation ?? "start"}`,
            ),
    };
  } finally {
    root.close();
  }
}

function commandLegacy(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  if (parsed.subcommand === "runs") {
    const { root } = openRoot(environment, "embedded");
    try {
      const runs = root.listLegacyImportRuns();
      return {
        data: { schemaVersion: "1", count: runs.length, runs },
        lines:
          runs.length === 0
            ? ["(no legacy import runs)"]
            : runs.map(
                (run) =>
                  `${run.runId}\n  status ${run.status}  corpus ${run.sourceFingerprint}  anomalies ${run.counts.anomalies}  archive ${run.hasArchive ? "yes" : "no"}`,
              ),
      };
    } finally {
      root.close();
    }
  }

  if (parsed.subcommand === "anomalies") {
    const runId = requirePositional(parsed, 0, "run id");
    const { root } = openRoot(environment, "embedded");
    try {
      const anomalies = root.getLegacyImportAnomalies(runId);
      return {
        data: { schemaVersion: "1", runId, count: anomalies.length, anomalies },
        lines:
          anomalies.length === 0
            ? ["(no anomalies recorded for this run)"]
            : anomalies.map(
                (anomaly) =>
                  `${anomaly.class}  x${anomaly.affectedCount}  ${anomaly.declaredValue ?? anomaly.relativePath ?? ""}\n    ${anomaly.reason}`,
              ),
      };
    } finally {
      root.close();
    }
  }

  const sourcePath = requirePositional(parsed, 0, "legacy source path");
  if (!existsSync(sourcePath)) {
    throw new CliError(
      "CONFIG_ERROR",
      `legacy source not found: ${sourcePath}`,
    );
  }
  const { root } = openRoot(environment, "embedded");
  try {
    const plan = root.planLegacyImport({
      roots: [resolve(sourcePath)],
      ...(environment.config.config.legacyPrivacyRules === undefined
        ? {}
        : { privacyRules: environment.config.config.legacyPrivacyRules }),
    });

    if (booleanFlag(parsed, "dry-run")) {
      return {
        data: { schemaVersion: "1", dryRun: true, plan },
        lines: [
          `corpus fingerprint  ${plan.sourceFingerprint}`,
          `plan hash           ${plan.planHash}`,
          `scanned files       ${plan.counts.scannedFiles}`,
          `signals             ${plan.counts.signals}`,
          `patterns            ${plan.counts.patterns}`,
          `graph edges         ${plan.counts.graphEdges}`,
          `anomalies           ${plan.counts.anomalies}`,
          `exclusions          ${plan.counts.exclusions}`,
          "",
          "anomalies:",
          ...plan.inventory.anomalies.map(
            (anomaly) =>
              `  ${anomaly.class}  x${anomaly.affectedCount}  ${anomaly.reason}`,
          ),
          "",
          "nothing was written; re-run with --confirm --plan-hash <hash> to import",
        ],
      };
    }

    if (!booleanFlag(parsed, "confirm")) {
      throw new CliError(
        "USAGE_ERROR",
        "legacy import requires exactly one of --dry-run or --confirm",
      );
    }
    const confirmed = requireFlag(parsed, "plan-hash");
    const application = root.applyLegacyImport({
      plan,
      planHash: confirmed,
      archiveRoot: environment.legacyArchiveRoot,
    });
    return {
      data: { schemaVersion: "1", dryRun: false, application },
      lines: [
        `status              ${application.status}`,
        `run                 ${application.runId}`,
        `events appended     ${application.appendedEvents}`,
        `last seq            ${application.lastSeq}`,
        `archive             ${environment.legacyArchiveRoot}`,
      ],
    };
  } finally {
    root.close();
  }
}

function commandPrivacy(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  if (parsed.subcommand !== "purge") {
    throw new CliError("USAGE_ERROR", "privacy requires the purge subcommand");
  }
  const { root } = openRoot(environment, "embedded");
  try {
    if (booleanFlag(parsed, "finalize-pending")) {
      const result = root.finalizePendingPurge();
      return {
        data: { schemaVersion: "1", finalizePending: result },
        lines: [
          `finalized ${result.finalizedBackupIds.length} pending cleanup item(s)`,
          ...(result.pendingBackupIds.length === 0
            ? []
            : [`${result.pendingBackupIds.length} still pending`]),
        ],
      };
    }
    const sessionId = requireFlag(parsed, "session");
    const dryRun = booleanFlag(parsed, "dry-run");
    const confirm = booleanFlag(parsed, "confirm");
    if (dryRun === confirm) {
      throw new CliError(
        "USAGE_ERROR",
        "privacy purge requires exactly one of --dry-run or --confirm",
      );
    }
    if (dryRun) {
      const plan = root.planPrivacyPurge(sessionId);
      return {
        data: { schemaVersion: "1", dryRun: true, plan },
        lines: [
          `scope               session ${sessionId}`,
          `events affected     ${plan.eventIds.length}`,
          `assets affected     ${plan.affectedAssetIds.length}`,
          `backups affected    ${plan.managedBackupIds.length}`,
          `plan hash           ${plan.planHash}`,
          "nothing was deleted",
        ],
      };
    }
    const planHash = requireFlag(parsed, "plan-hash");
    const result = root.privacyPurge(sessionId, {
      confirm: true,
      planHash,
      preserveManagedBackups: booleanFlag(parsed, "preserve-managed-backups"),
    });
    return {
      data: { schemaVersion: "1", dryRun: false, result },
      lines: [
        `purged session ${sessionId}`,
        `receipt         ${result.receipt?.receiptId ?? "(none)"}`,
      ],
    };
  } finally {
    root.close();
  }
}

function commandExport(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const { root } = openRoot(environment, "embedded");
  try {
    const records = root.exportEvents({
      ...(optionalFlag(parsed, "type") === undefined
        ? {}
        : { type: optionalFlag(parsed, "type") as string }),
      limit: integerFlag(parsed, "limit", 10_000),
    });
    const manifest = {
      schemaVersion: "1",
      exportedAt: root.clock.now().toISOString(),
      eventCount: records.length,
      lastSeq: root.getHealth().lastSeq,
      digest: stableStringify(
        records.map((record) => ({
          seq: record.seq,
          id: record.id,
          contentHash: record.contentHash,
        })) as unknown as JsonValue,
      ).length,
    };
    const out = optionalFlag(parsed, "out");
    if (out !== undefined) {
      writeFileSync(
        resolve(out),
        `${JSON.stringify({ manifest, events: records }, null, 2)}\n`,
      );
    }
    return {
      data: { schemaVersion: "1", manifest, output: out ?? null },
      lines: [
        `exported ${records.length} event(s)`,
        `last seq ${manifest.lastSeq}`,
        ...(out === undefined
          ? ["(no --out given; nothing was written to disk)"]
          : [`written to ${resolve(out)}`]),
      ],
    };
  } finally {
    root.close();
  }
}

function commandBackup(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const { root } = openRoot(environment, "embedded");
  try {
    switch (parsed.subcommand) {
      case "create": {
        const target = resolve(
          requirePositional(parsed, 0, "backup destination path"),
        );
        const manifest = root.createManagedBackup(target);
        return {
          data: { schemaVersion: "1", manifest },
          lines: [
            `backup written to ${manifest.path}`,
            `digest ${manifest.backupSha256}`,
          ],
        };
      }
      case "list": {
        const backups = root.listManagedBackups();
        return {
          data: { schemaVersion: "1", count: backups.length, backups },
          lines:
            backups.length === 0
              ? ["(no managed backups)"]
              : backups.map(
                  (backup) => `${backup.id}  ${backup.status}  ${backup.path}`,
                ),
        };
      }
      case "restore": {
        const reference = requirePositional(parsed, 0, "backup id or path");
        const managed = root.listManagedBackups().find((item) => {
          const resolvedReference = resolve(reference);
          return (
            item.id === reference ||
            item.path === resolvedReference ||
            item.pendingPath === resolvedReference
          );
        });
        if (managed !== undefined && managed.status !== "active") {
          throw new CliError(
            "VALIDATION_ERROR",
            `backup ${reference} is ${managed.status} and cannot be used as a restore source`,
          );
        }
        const source = managed?.path ?? resolve(reference);
        const destination = resolve(
          optionalFlag(parsed, "destination") ?? environment.databasePath,
        );
        authorizeWriterScope(
          environment.writer,
          "history.export",
          "backup restore",
        );
        const canonical = destination === environment.databasePath;
        const maintenanceLock = canonical
          ? root.handoffForMaintenance()
          : undefined;
        if (!canonical) root.close();
        try {
          restoreDatabaseFile({
            sourcePath: source,
            destinationPath: destination,
            ...(managed === undefined
              ? {}
              : { expectedSha256: managed.backupSha256 }),
            ...(canonical
              ? { safetyBackupPath: `${destination}.restore-safety.db` }
              : {}),
          });
        } catch (error) {
          if (maintenanceLock !== undefined) {
            openRoot(environment, "embedded", {
              databasePath: destination,
              existingLock: maintenanceLock,
              acquire: false,
            }).root.close();
          }
          throw error;
        }
        const reopened = openRoot(environment, "embedded", {
          databasePath: destination,
          ...(maintenanceLock === undefined
            ? {}
            : { existingLock: maintenanceLock }),
          acquire: maintenanceLock === undefined,
        });
        try {
          const projectionRebuild = reopened.root.rebuildCoreProjections();
          const doctor = reopened.root.doctor();
          if (doctor.status === "fail") {
            throw new CliError(
              "STORAGE_ERROR",
              "the restored database failed the post-restore doctor gate",
            );
          }
          return {
            data: {
              schemaVersion: "1",
              restored: true,
              source,
              destination,
              projectionRebuild,
              doctor,
            },
            lines: [
              `restored ${source} -> ${destination}`,
              `doctor ${doctor.status}`,
            ],
          };
        } finally {
          reopened.root.close();
        }
      }
      default:
        throw new CliError(
          "USAGE_ERROR",
          `unknown backup subcommand ${String(parsed.subcommand)}`,
        );
    }
  } finally {
    root.close();
  }
}

function commandLock(
  environment: ResolvedEnvironment,
  parsed: ParsedCommand,
): CommandOutcome {
  const lock = new WriterOwnershipLock(
    `${environment.databasePath}.writer.lock`,
  );
  if (parsed.subcommand === "inspect") {
    const inspected = lock.inspect();
    return {
      data: { schemaVersion: "1", lock: inspected },
      lines: [
        `lock path ${lock.path}`,
        inspected === null
          ? "not held"
          : `held by pid ${inspected.pid} (${inspected.mode}) since ${inspected.startedAt}`,
      ],
    };
  }
  const token = requireFlag(parsed, "token");
  const cleared = lock.clearStale(token);
  return {
    data: { schemaVersion: "1", cleared, path: lock.path },
    lines: [
      cleared ? `cleared stale lock ${lock.path}` : "lock was not cleared",
    ],
  };
}

function readTextFile(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(readFileSync(path)),
  );
}

// --- Dispatch -----------------------------------------------------------------

const handlers: Record<
  string,
  (
    environment: ResolvedEnvironment,
    parsed: ParsedCommand,
  ) => CommandOutcome & { failed?: boolean }
> = {
  init: commandInit,
  doctor: commandDoctor,
  event: commandEvent,
  state: commandState,
  rebuild: commandRebuild,
  projection: commandRebuild,
  context: commandContext,
  residual: commandResidualList,
  reflection: commandReflectionRun,
  asset: commandAsset,
  history: commandHistoryExplain,
  legacy: commandLegacy,
  privacy: commandPrivacy,
  export: commandExport,
  backup: commandBackup,
  lock: commandLock,
};

export function run(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  cwd: string,
  sink: OutputSink = processSink,
): number {
  const traceId = newTraceId();
  let json = argv.includes("--json");
  try {
    // An explicit help request is a successful invocation, not a usage error.
    if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
      renderSuccess(
        "help",
        {
          data: { schemaVersion: "1", usage: usageText() },
          lines: [usageText()],
        },
        json,
        sink,
      );
      return exitCodes.success;
    }
    const parsed = parseArgs(argv);
    json = parsed.json;
    if (parsed.help) {
      const outcome = {
        data: { schemaVersion: "1", usage: usageText() },
        lines: [usageText()],
      };
      renderSuccess(parsed.path.join(" "), outcome, json, sink);
      return exitCodes.success;
    }
    const environment = resolveEnvironment(parsed, env, cwd);
    const handler = handlers[parsed.command];
    if (handler === undefined) {
      throw new CliError("USAGE_ERROR", `unknown command ${parsed.command}`);
    }
    const outcome = handler(environment, parsed);
    renderSuccess(parsed.path.join(" "), outcome, json, sink);
    if (outcome.failed === true) return exitCodes.invariant;
    return exitCodes.success;
  } catch (error) {
    const classified = classifyError(error, traceId);
    renderFailure(classified, json, sink);
    return classified.exitCode;
  }
}

export function usageText(): string {
  return [
    "praxis — local-first runtime for auditable long-term collaboration",
    "",
    "Usage: praxis <command> [subcommand] [arguments] [--json]",
    "",
    "  praxis init",
    "  praxis doctor [--json]",
    "  praxis event append --type <t> --payload <json> [...]",
    "  praxis event list [--type <t>] [--limit <n>]",
    "  praxis state show [--projection <name>]",
    "  praxis rebuild | praxis projection rebuild",
    "  praxis context plan --candidates <file> [--mode reuse|reindex|refresh] [--record]",
    "  praxis residual list [--limit <n>]",
    "  praxis reflection run --residual <eventId> [--evidence <ids>]",
    "  praxis asset list | inspect <id> | contest|disable|restore|fork|activate <id> --reason <r>",
    "  praxis history explain <event-or-asset id>",
    "  praxis legacy import <path> --dry-run",
    "  praxis legacy import <path> --confirm --plan-hash <sha256> [--archive <dir>]",
    "  praxis legacy runs | praxis legacy anomalies <runId>",
    "  praxis privacy purge --session <id> --dry-run",
    "  praxis privacy purge --session <id> --confirm --plan-hash <sha256>",
    "  praxis privacy purge --finalize-pending",
    "  praxis export [--type <t>] [--limit <n>] [--out <path>]",
    "  praxis backup create <path> | list | restore <id|path> [--destination <path>]",
    "  praxis lock inspect | lock clear-stale --token <token>",
    "",
    "Exit codes: 0 success, 2 validation, 3 config, 4 migration, 5 storage,",
    "            6 RFC/invariant violation, 7 external adapter, 8 privacy/permission.",
    "With --json, stdout carries only the machine document; diagnostics go to stderr.",
  ].join("\n");
}

/**
 * Run only when this module is the process entry point. An importing test or a
 * future in-process caller gets the exported `run` without the side effect of
 * reading the real argv.
 */
const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(entryPoint).href
) {
  process.exitCode = run(
    process.argv.slice(2),
    process.env,
    process.cwd(),
    processSink,
  );
}
