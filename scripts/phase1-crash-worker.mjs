import { DatabaseSync } from "node:sqlite";
import { argv, exit, stdout } from "node:process";

// Test-only internal entry: MigrationRunner is intentionally not part of the
// public @praxis/store package surface because it accepts a raw SQLite handle.
import { MigrationRunner } from "../packages/store/dist/migrations.js";

const [, , filename, migrationsDir] = argv;
if (filename === undefined || migrationsDir === undefined) {
  throw new Error("Usage: phase1-crash-worker <db> <migrations>");
}

const database = new DatabaseSync(filename);
database.exec("PRAGMA busy_timeout = 5000");
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA synchronous = FULL");
new MigrationRunner(database, migrationsDir).run();
database.exec("BEGIN IMMEDIATE");
database
  .prepare(
    `
    INSERT INTO events (
      id, schema_version, event_version, type,
      occurred_at, observed_at, recorded_at,
      actor_type, actor_id, source_json, payload_json,
      provenance_json, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  )
  .run(
    "crash-only-event",
    "1",
    "1",
    "system.crash-probe",
    Date.parse("2026-09-13T00:00:00.000Z"),
    Date.parse("2026-09-13T00:00:00.000Z"),
    Date.parse("2026-09-13T00:00:00.000Z"),
    "system",
    "phase1-crash",
    "{}",
    "{}",
    '{"origin":"direct","confidence":1}',
    "0".repeat(64),
  );
stdout.write("CRASH_WORKER_INSERTED_UNCOMMITTED\n", () => exit(17));
