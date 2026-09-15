import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { authorizeWriterScope, permissionScopes } from "@praxis/contracts";
import {
  RuntimeCompositionRoot,
  WriterOwnershipLock,
  type RuntimeMode,
} from "@praxis/runtime";
import { restoreDatabaseFile, SqliteEventStore } from "@praxis/store";

interface AppConfig {
  dataDir: string;
  databasePath: string;
  migrationsDir: string;
  backupsDir: string;
}

function configFromEnvironment(): AppConfig {
  const dataDir = resolve(
    process.env.PRAXIS_DATA_DIR ?? join(process.cwd(), ".praxis"),
  );
  return {
    dataDir,
    databasePath: join(dataDir, "events.db"),
    migrationsDir: resolve(
      process.env.PRAXIS_MIGRATIONS_DIR ?? join(process.cwd(), "migrations"),
    ),
    backupsDir: join(dataDir, "backups"),
  };
}

function openRoot(
  config: AppConfig,
  mode: RuntimeMode,
  databasePath = config.databasePath,
  existingLock?: WriterOwnershipLock,
): RuntimeCompositionRoot {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.backupsDir, { recursive: true });
  const resolvedDatabasePath = resolve(databasePath);
  const lock =
    existingLock ??
    new WriterOwnershipLock(`${resolvedDatabasePath}.writer.lock`);
  if (existingLock === undefined) {
    lock.acquire({
      pid: process.pid,
      mode,
      startedAt: new Date().toISOString(),
      dbPath: resolvedDatabasePath,
    });
  }
  let store: SqliteEventStore | undefined;
  try {
    store = new SqliteEventStore({
      filename: resolvedDatabasePath,
      migrationsDir: config.migrationsDir,
      managedBackupRoot: config.backupsDir,
    });
    return new RuntimeCompositionRoot({
      store,
      mode,
      lock,
      actor: {
        type: "human",
        id: process.env.PRAXIS_ACTOR_ID ?? "local-owner",
      },
      writer: {
        writerId: process.env.PRAXIS_WRITER_ID ?? "local:owner",
        kind: "human",
        role: "OWNER",
        authn: "embedded-local",
        scopes: [...permissionScopes],
        policyVersion: 1,
      },
    });
  } catch (error) {
    store?.close();
    lock.release();
    throw error;
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  praxis doctor",
      "  praxis projection rebuild",
      "  praxis backup create [path]",
      "  praxis backup list",
      "  praxis backup restore <backup-id-or-path> [destination]",
      "  praxis privacy purge --session <id> --dry-run",
      "  praxis privacy purge --session <id> --confirm --plan-hash <sha256> [--preserve-managed-backups]",
      "  praxis privacy purge --finalize-pending",
      "  praxis lock inspect",
      "  praxis lock clear-stale --token <token>",
    ].join("\n"),
  );
}

function run(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();
  const config = configFromEnvironment();
  const [command, subcommand] = args;
  const lock = new WriterOwnershipLock(`${config.databasePath}.writer.lock`);
  if (command === "lock" && subcommand === "inspect") {
    print(lock.inspect());
    return;
  }
  if (command === "lock" && subcommand === "clear-stale") {
    const token = optionValue(args, "--token");
    if (token === undefined || token.length < 1) {
      fail("lock clear-stale requires --token <token>");
    }
    print({ cleared: lock.clearStale(token), path: lock.path });
    return;
  }
  let root: RuntimeCompositionRoot | undefined;
  try {
    root = openRoot(config, "embedded");
    root.start();
    if (command === "doctor") {
      const report = root.doctor();
      print(report);
      if (report.status === "fail") process.exitCode = 1;
      return;
    }
    if (command === "projection" && subcommand === "rebuild") {
      print(root.rebuildCoreProjections());
      return;
    }
    if (command === "backup" && subcommand === "list") {
      print(root.listManagedBackups());
      return;
    }
    if (command === "backup" && subcommand === "create") {
      const requestedPath = args[2];
      const target = resolve(
        requestedPath ?? join(config.backupsDir, `backup-${Date.now()}.db`),
      );
      print(root.createManagedBackup(target));
      return;
    }
    if (command === "backup" && subcommand === "restore") {
      const reference =
        args[2] ?? fail("backup restore requires a backup id or path");
      const managed = root.listManagedBackups().find((item) => {
        const resolvedReference = resolve(reference);
        return (
          item.id === reference ||
          item.path === resolvedReference ||
          item.pendingPath === resolvedReference
        );
      });
      if (managed !== undefined && managed.status !== "active") {
        fail(
          `backup ${reference} is ${managed.status} and cannot be used as a restore source`,
        );
      }
      const source = managed?.path ?? resolve(reference);
      const destination = resolve(args[3] ?? config.databasePath);
      authorizeWriterScope(root.writer, "history.export", "backup restore");
      const safety = `${destination}.restore-safety-${Date.now()}.db`;
      const canonicalDestination = destination === config.databasePath;
      const maintenanceLock = canonicalDestination
        ? root.handoffForMaintenance()
        : undefined;
      if (!canonicalDestination) root.close();
      root = undefined;
      try {
        restoreDatabaseFile({
          sourcePath: source,
          destinationPath: destination,
          ...(managed === undefined
            ? {}
            : { expectedSha256: managed.backupSha256 }),
          ...(canonicalDestination ? { safetyBackupPath: safety } : {}),
        });
      } catch (error) {
        if (maintenanceLock !== undefined) {
          const recoveryRoot = openRoot(
            config,
            "embedded",
            destination,
            maintenanceLock,
          );
          recoveryRoot.close();
        }
        throw error;
      }
      let validationRoot: RuntimeCompositionRoot | undefined = openRoot(
        config,
        "embedded",
        destination,
        maintenanceLock,
      ).start();
      try {
        const projectionRebuild = validationRoot.rebuildCoreProjections();
        const doctor = validationRoot.doctor();
        if (doctor.status === "fail") {
          fail("restored database failed the post-restore doctor gate");
        }
        print({
          restored: true,
          source,
          destination,
          safetyBackup:
            destination === config.databasePath ? safety : undefined,
          projectionRebuild,
          doctor,
        });
      } catch (error) {
        if (canonicalDestination && existsSync(safety)) {
          const rollbackLock = validationRoot.handoffForMaintenance();
          validationRoot = undefined;
          const failedRestoreSafety = `${destination}.failed-restore-safety-${Date.now()}.db`;
          restoreDatabaseFile({
            sourcePath: safety,
            destinationPath: destination,
            safetyBackupPath: failedRestoreSafety,
          });
          const recoveredRoot = openRoot(
            config,
            "embedded",
            destination,
            rollbackLock,
          ).start();
          recoveredRoot.close();
        }
        throw error;
      } finally {
        validationRoot?.close();
      }
      return;
    }
    if (command === "privacy" && subcommand === "purge") {
      if (args.includes("--finalize-pending")) {
        print(root.finalizePendingPurge());
        return;
      }
      const sessionId = optionValue(args, "--session");
      if (sessionId === undefined)
        fail("privacy purge requires --session <id>");
      const dryRun = args.includes("--dry-run");
      const confirm = args.includes("--confirm");
      if (dryRun === confirm) {
        fail("privacy purge requires exactly one of --dry-run or --confirm");
      }
      const planHash = confirm ? optionValue(args, "--plan-hash") : undefined;
      if (confirm && (planHash === undefined || planHash.length < 1)) {
        fail("privacy purge --confirm requires --plan-hash <sha256>");
      }
      print(
        root.privacyPurge(sessionId, {
          confirm,
          ...(planHash === undefined ? {} : { planHash }),
          preserveManagedBackups: args.includes("--preserve-managed-backups"),
        }),
      );
      return;
    }
    usage();
  } finally {
    root?.close();
  }
}

try {
  run();
} catch (error) {
  const details =
    typeof error === "object" && error !== null && "details" in error
      ? (error as { details?: unknown }).details
      : undefined;
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      ...(details === undefined ? {} : { details }),
    })}\n`,
  );
  process.exitCode = 1;
}
