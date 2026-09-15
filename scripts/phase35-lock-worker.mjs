import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

import { permissionScopes } from "../packages/contracts/dist/index.js";
import { RuntimeCompositionRoot } from "../packages/runtime/dist/index.js";
import { SqliteEventStore } from "../packages/store/dist/index.js";

const [filename, migrationsDir, workerId, holdMsText] = process.argv.slice(2);
if (!filename || !migrationsDir || !workerId || !holdMsText) {
  throw new Error("phase35 lock worker arguments are incomplete");
}

const store = new SqliteEventStore({ filename, migrationsDir });
let root;
try {
  root = new RuntimeCompositionRoot({
    store,
    mode: "daemon",
    actor: { type: "system", id: `phase35-worker-${workerId}` },
    writer: {
      writerId: `phase35-worker-${workerId}`,
      kind: "runtime",
      role: "OWNER",
      authn: "daemon-token",
      scopes: [...permissionScopes],
      policyVersion: 1,
    },
  }).start();
  process.stdout.write(JSON.stringify({ workerId, acquired: true }) + "\n");
  await delay(Number(holdMsText));
  root.close();
} catch (error) {
  try {
    root?.close();
  } catch {
    // Preserve the original lock result.
  }
  if (error?.code !== "WRITER_LOCK_CONFLICT") {
    process.stderr.write(
      JSON.stringify({
        workerId,
        error: error instanceof Error ? error.message : String(error),
      }) + "\n",
    );
    store.close();
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify({ workerId, acquired: false }) + "\n");
  }
}
