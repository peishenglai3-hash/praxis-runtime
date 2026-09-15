import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { RuntimeCompositionRoot, WriterOwnershipLock } from "@praxis/runtime";
import { SqliteEventStore } from "@praxis/store";

function openRoot(): RuntimeCompositionRoot {
  const dataDir = resolve(
    process.env.PRAXIS_DATA_DIR ?? join(process.cwd(), ".praxis"),
  );
  const migrationsDir = resolve(
    process.env.PRAXIS_MIGRATIONS_DIR ?? join(process.cwd(), "migrations"),
  );
  mkdirSync(dataDir, { recursive: true });
  const backupsDir = join(dataDir, "backups");
  mkdirSync(backupsDir, { recursive: true });
  const databasePath = join(dataDir, "events.db");
  const lock = new WriterOwnershipLock(`${databasePath}.writer.lock`);
  lock.acquire({
    pid: process.pid,
    mode: "daemon",
    startedAt: new Date().toISOString(),
    dbPath: resolve(databasePath),
  });
  let store: SqliteEventStore | undefined;
  try {
    store = new SqliteEventStore({
      filename: databasePath,
      migrationsDir,
      managedBackupRoot: backupsDir,
    });
    return new RuntimeCompositionRoot({
      store,
      lock,
      mode: "daemon",
      actor: {
        type: "system",
        id: process.env.PRAXIS_ACTOR_ID ?? "local-daemon",
      },
      writer: {
        writerId: process.env.PRAXIS_WRITER_ID ?? "daemon:local",
        kind: "runtime",
        role: "COORDINATOR",
        authn: "daemon-token",
        scopes: ["event.read", "event.append", "state.read", "tool.execute"],
        policyVersion: 1,
      },
    });
  } catch (error) {
    store?.close();
    lock.release();
    throw error;
  }
}

const root = openRoot();
let startupReady = false;
try {
  root.start();
  const catchUp = root.catchUpCoreProjections();
  if (catchUp.some((result) => result.status === "failed")) {
    throw new Error("daemon projection catch-up failed; startup is blocked");
  }
  const report = root.doctor();
  if (report.status === "fail") {
    throw new Error("daemon doctor gate failed; startup is blocked");
  }
  startupReady = true;
  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      mode: "daemon",
      database: root.databasePath,
      writerLock: root.writerLockPath,
      catchUp,
      doctor: report,
    })}\n`,
  );
} catch (error) {
  try {
    root.close();
  } catch {
    // Preserve the startup failure; the lock/doctor evidence remains local.
  }
  process.stderr.write(
    `${JSON.stringify({
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}

let healthTimer: ReturnType<typeof setInterval> | undefined;
let closed = false;

const shutdown = (): void => {
  if (closed) return;
  closed = true;
  if (healthTimer !== undefined) clearInterval(healthTimer);
  root.close();
  process.exitCode = 0;
};

if (startupReady) {
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (process.argv.includes("--once")) {
    shutdown();
  } else {
    healthTimer = setInterval(() => {
      const report = root.doctor();
      if (report.status === "fail") {
        process.stderr.write(`${JSON.stringify({ ready: false, report })}\n`);
      }
    }, 30_000);
  }
}
