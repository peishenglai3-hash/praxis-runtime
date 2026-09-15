import { mkdirSync } from "node:fs";
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
): RuntimeCompositionRoot {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.backupsDir, { recursive: true });
  const store = new SqliteEventStore({
    filename: databasePath,
    migrationsDir: config.migrationsDir,
  });
  return new RuntimeCompositionRoot({
    store,
    mode,
    actor: { type: "human", id: process.env.PRAXIS_ACTOR_ID ?? "local-owner" },
    writer: {
      writerId: process.env.PRAXIS_WRITER_ID ?? "local:owner",
      kind: "human",
      role: "OWNER",
      authn: "embedded-local",
      scopes: [...permissionScopes],
      policyVersion: 1,
    },
  });
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
      "  praxis privacy purge --session <id> --confirm [--preserve-managed-backups]",
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
      const managed = root
        .listManagedBackups()
        .find((item) => item.id === reference);
      const source =
        managed?.pendingPath ?? managed?.path ?? resolve(reference);
      const destination = resolve(args[3] ?? config.databasePath);
      authorizeWriterScope(root.writer, "history.export", "backup restore");
      const safety = `${destination}.restore-safety-${Date.now()}.db`;
      root.close();
      root = undefined;
      restoreDatabaseFile({
        sourcePath: source,
        destinationPath: destination,
        ...(managed === undefined
          ? {}
          : { expectedSha256: managed.backupSha256 }),
        ...(destination === config.databasePath
          ? { safetyBackupPath: safety }
          : {}),
      });
      const validationRoot = openRoot(config, "embedded", destination).start();
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
      } finally {
        validationRoot.close();
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
      print(
        root.privacyPurge(sessionId, {
          confirm,
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
