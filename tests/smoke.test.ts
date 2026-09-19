import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { permissionScopes } from "../packages/contracts/src/index.js";
import { RuntimeCompositionRoot } from "../packages/runtime/src/index.js";
import { SqliteEventStore } from "../packages/store/src/index.js";

/**
 * The repository smoke path: the core comes up over a real SQLite store and
 * reads back as healthy with no provider adapter present at all.
 *
 * This file previously contained `expect(true).toBe(true)` under the name
 * "Phase 0 repository baseline", while `.github/workflows/provider-smoke.yml`
 * ran it as its step "Run provider-independent adapter smoke". A check that
 * cannot fail is not evidence, and a step named after a guarantee it does not
 * test is worse than no step. See BP-050.
 *
 * The adapter half of that guarantee arrives with EPIC-010. What is asserted
 * here is the half that exists now, and it can fail.
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../migrations", import.meta.url)),
);

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe("repository smoke", () => {
  it("brings the core up over a real store with no provider adapter present", () => {
    directory = mkdtempSync(join(tmpdir(), "praxis-smoke-"));
    const store = new SqliteEventStore({
      filename: join(directory, "events.db"),
      migrationsDir,
    });
    const root = new RuntimeCompositionRoot({
      store,
      mode: "embedded",
      actor: { type: "human", id: "smoke" },
      writer: {
        writerId: "smoke",
        kind: "human",
        role: "OWNER",
        authn: "embedded-local",
        scopes: [...permissionScopes],
        policyVersion: 1,
      },
    }).start();
    try {
      // A freshly migrated ledger has an authoritative cursor at zero and no
      // events. Reading it back is what proves the composition came up rather
      // than merely imported.
      const health = root.getHealth();
      expect(health.lastSeq).toBe(0);
      expect(root.exportEvents({ limit: 1 })).toHaveLength(0);
    } finally {
      root.close();
    }
  });
});
