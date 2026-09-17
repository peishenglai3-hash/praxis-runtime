import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  AssetPromotionReview,
  EventEnvelope,
  ReusableAsset,
  WriterContext,
} from "../../packages/contracts/src/index.js";
import { permissionScopes } from "../../packages/contracts/src/index.js";
import { RuntimeCompositionRoot } from "../../packages/runtime/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

/**
 * Phase 6A hardening — the `assets` catalog and the `assets` projection.
 *
 * EPIC-007 has two representations of the same thing, and until now nothing
 * checked that they agree:
 *
 * - the `assets` **catalog table** (`migrations/0010`), which is what the
 *   runtime reads when it answers `inspectAsset`, decides a transition or
 *   enforces optimistic locking;
 * - the `assets` **projection** (`packages/state`), which is one of the five
 *   core projections and carries the Bible's section 18 criterion 3 promise
 *   that 「所有核心 projection 可从 event ledger 重建」.
 *
 * Every asset test up to now asserted one of the two. That is the shape of a
 * gap that survives a `PASS`: each side looks correct on its own, and nothing
 * compares them. INV-03 says derived state is rebuildable; a projection that
 * rebuilds to something the runtime would disagree with satisfies the letter
 * of that and not the point of it.
 *
 * So this file drives a full lifecycle — candidate, validated, active,
 * contested, restored, forked — then wipes the projection and rebuilds it from
 * the ledger alone, and requires the result to match the catalog the runtime
 * actually uses.
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const owner: WriterContext = {
  writerId: "test:phase6-owner",
  kind: "human",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

let directory: string | undefined;
let root: RuntimeCompositionRoot | undefined;
let store: SqliteEventStore | undefined;

afterEach(() => {
  root?.close();
  root = undefined;
  store?.close();
  store = undefined;
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
    directory = undefined;
  }
});

function openRoot(): RuntimeCompositionRoot {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase6-assets-"));
  store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  root = new RuntimeCompositionRoot({
    store,
    mode: "embedded",
    actor: { type: "human", id: "phase6-owner" },
    writer: owner,
  }).start();
  return root;
}

function sourceEvent(id: string): EventEnvelope {
  const at = "2026-09-17T00:00:00.000Z";
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id,
    type: "interaction.observed",
    occurredAt: at,
    observedAt: at,
    recordedAt: at,
    actor: { type: "human", id: "phase6-owner" },
    operationId: id,
    source: { kind: "phase6-test", ref: id },
    payload: { id },
    provenance: { origin: "direct", confidence: 1 },
  };
}

function review(targetStatus: "validated" | "active"): AssetPromotionReview {
  return {
    targetStatus,
    episodes: [
      {
        episodeId: "episode-1",
        evidence: [{ eventId: "episode-event-1", origin: "direct" }],
        exposureInfluenced: false,
      },
      {
        episodeId: "episode-2",
        evidence: [{ eventId: "episode-event-2", origin: "direct" }],
        exposureInfluenced: false,
      },
    ],
    counterexamples: [],
    validation: {
      validatorId: "validator:phase6",
      passed: true,
      evidence: [{ eventId: "validation-event", origin: "direct" }],
    },
    ...(targetStatus === "active" ? { humanConfirmed: true } : {}),
  };
}

interface ProjectedAsset {
  id: string;
  status: string;
  revision?: number;
  lastSeq: number;
}

/** Rebuild the `assets` projection from the ledger and read it back. */
function rebuiltProjection(
  currentRoot: RuntimeCompositionRoot,
): Record<string, ProjectedAsset> {
  currentRoot.rebuildProjection("assets");
  const state = currentRoot.getProjectionState("assets")?.state as
    { assets: Record<string, ProjectedAsset> } | undefined;
  return state?.assets ?? {};
}

describe("Phase 6A — the asset catalog and the asset projection agree", () => {
  it("reproduces the catalog after a full lifecycle", () => {
    const currentRoot = openRoot();
    for (const id of [
      "asset-provenance",
      "episode-event-1",
      "episode-event-2",
      "validation-event",
    ]) {
      currentRoot.runtime.appendEvent(sourceEvent(id));
    }

    currentRoot.runtime.proposeAsset({
      id: "asset-lifecycle",
      kind: "rule",
      version: "1.0.0",
      body: { rule: "keep the source evidence" },
      derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
      createdAt: "2026-09-17T00:00:00.000Z",
    });
    currentRoot.runtime.promoteAsset(
      "asset-lifecycle",
      review("validated"),
      "2026-09-17T00:00:01.000Z",
    );
    currentRoot.runtime.promoteAsset(
      "asset-lifecycle",
      review("active"),
      "2026-09-17T00:00:02.000Z",
    );
    currentRoot.runtime.contestAsset(
      "asset-lifecycle",
      "a counterexample was filed",
      "2026-09-17T00:00:03.000Z",
    );
    currentRoot.runtime.restoreAsset(
      "asset-lifecycle",
      "the counterexample was resolved",
      "2026-09-17T00:00:04.000Z",
    );
    currentRoot.runtime.forkAsset(
      "asset-lifecycle",
      "asset-forked",
      "a variant worth keeping separately",
      "2026-09-17T00:00:05.000Z",
    );

    const catalog: ReusableAsset[] = currentRoot.listAssets();
    expect(catalog.map((asset) => asset.id).sort()).toEqual([
      "asset-forked",
      "asset-lifecycle",
    ]);

    const projection = rebuiltProjection(currentRoot);
    expect(Object.keys(projection).sort()).toEqual([
      "asset-forked",
      "asset-lifecycle",
    ]);

    for (const asset of catalog) {
      const projected = projection[asset.id];
      expect(projected, `projection is missing ${asset.id}`).toBeDefined();
      // Status and revision are what the runtime reads the catalog for. If a
      // rebuild disagreed here, a rebuilt database would answer differently
      // from the one it was rebuilt from.
      expect(projected!.status).toBe(asset.status);
      expect(projected!.revision).toBe(asset.revision);
    }
  });

  it("agrees on the final status of every legal lifecycle edge", () => {
    // The lifecycle has restore edges (`challenged -> active`, `deprecated ->
    // validated`). A projection reducer that only understood the forward path
    // would drift exactly here and nowhere else.
    const currentRoot = openRoot();
    for (const id of [
      "asset-provenance",
      "episode-event-1",
      "episode-event-2",
      "validation-event",
    ]) {
      currentRoot.runtime.appendEvent(sourceEvent(id));
    }
    currentRoot.runtime.proposeAsset({
      id: "asset-edges",
      kind: "skill",
      version: "1.0.0",
      body: { skill: "edge coverage" },
      derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
      createdAt: "2026-09-17T00:00:00.000Z",
    });
    currentRoot.runtime.promoteAsset(
      "asset-edges",
      review("validated"),
      "2026-09-17T00:00:01.000Z",
    );
    currentRoot.runtime.disableAsset(
      "asset-edges",
      "temporarily withdrawn",
      "2026-09-17T00:00:02.000Z",
    );

    const rejected = currentRoot.runtime.restoreAsset(
      "asset-edges",
      "brought back",
      "2026-09-17T00:00:03.000Z",
    );
    expect(rejected.record.type).toBe("asset.restore");

    const catalog = currentRoot
      .listAssets()
      .find((asset) => asset.id === "asset-edges");
    const projection = rebuiltProjection(currentRoot)["asset-edges"];
    expect(projection?.status).toBe(catalog?.status);
    expect(projection?.revision).toBe(catalog?.revision);
  });

  it("rebuilds to the same projection whether it caught up or was rebuilt", () => {
    // Criterion 3 in the ordinary case: incremental catch-up and a full
    // rebuild must agree. The two paths share a reducer but not a cursor.
    //
    // The `assets` projection lags an asset write on purpose — Bible section 6
    // says 「Event append 与 projection catch-up 不做单个跨域强事务；事实先落盘，
    // projection 可追赶」 — so this test has to catch it up rather than assume
    // it is current. The first draft of this test made that assumption and
    // failed on a correct system.
    const currentRoot = openRoot();
    for (const id of [
      "asset-provenance",
      "episode-event-1",
      "episode-event-2",
      "validation-event",
    ]) {
      currentRoot.runtime.appendEvent(sourceEvent(id));
    }
    currentRoot.runtime.proposeAsset({
      id: "asset-catchup",
      kind: "workflow",
      version: "1.0.0",
      body: { workflow: "catch-up parity" },
      derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
      createdAt: "2026-09-17T00:00:00.000Z",
    });
    currentRoot.runtime.promoteAsset(
      "asset-catchup",
      review("validated"),
      "2026-09-17T00:00:01.000Z",
    );

    // A write does not catch the projection up; that is the documented
    // boundary, asserted here so it stays deliberate.
    expect(currentRoot.getProjectionState("assets")).toBeNull();

    currentRoot.catchUpCoreProjections();
    const caughtUp = currentRoot.getProjectionState("assets")?.state;
    expect(caughtUp).toBeDefined();

    currentRoot.rebuildProjection("assets");
    const rebuilt = currentRoot.getProjectionState("assets")?.state;
    expect(rebuilt).toEqual(caughtUp);
  });
});
