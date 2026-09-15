import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type {
  AssetPromotionReview,
  EventEnvelope,
  JsonValue,
  ReusableAsset,
  WriterContext,
} from "../../packages/contracts/src/index.js";
import { permissionScopes } from "../../packages/contracts/src/index.js";
import { RuntimeCompositionRoot } from "../../packages/runtime/src/index.js";
import { transitionAsset } from "../../packages/assets/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (filename: string) => {
    prepare(sql: string): { run(...parameters: string[]): unknown };
    close(): void;
  };
};

const owner: WriterContext = {
  writerId: "test:phase4-owner",
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
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function openRoot(): RuntimeCompositionRoot {
  directory = mkdtempSync(join(tmpdir(), "praxis-phase4-assets-"));
  store = new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
  root = new RuntimeCompositionRoot({
    store,
    mode: "embedded",
    actor: { type: "human", id: "phase4-owner" },
    writer: owner,
  }).start();
  return root;
}

function event(id: string, sessionId?: string): EventEnvelope {
  return {
    schemaVersion: "1",
    eventVersion: "1",
    id,
    type: "interaction.observed",
    occurredAt: "2026-09-15T00:00:00.000Z",
    observedAt: "2026-09-15T00:00:00.000Z",
    recordedAt: "2026-09-15T00:00:00.000Z",
    actor: { type: "human", id: "phase4-owner" },
    ...(sessionId === undefined ? {} : { sessionId }),
    operationId: id,
    source: { kind: "phase4-test", ref: id },
    payload: { id },
    provenance: { origin: "direct", confidence: 1 },
  };
}

function review(
  targetStatus: "validated" | "active" = "validated",
): AssetPromotionReview {
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
      validatorId: "validator:phase4",
      passed: true,
      evidence: [{ eventId: "validation-event", origin: "direct" }],
    },
    ...(targetStatus === "active" ? { humanConfirmed: true } : {}),
  };
}

function seedReviewEvents(currentRoot: RuntimeCompositionRoot): void {
  for (const id of [
    "asset-provenance",
    "episode-event-1",
    "episode-event-2",
    "validation-event",
  ]) {
    currentRoot.runtime.appendEvent(event(id));
  }
}

function candidateAsset(): ReusableAsset {
  return {
    id: "asset-cas",
    kind: "rule",
    version: "1.0.0",
    revision: 1,
    status: "candidate",
    body: { rule: "retain source evidence" },
    derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}

describe("Phase 4 reusable assets", () => {
  it("records a provenance-bound candidate, promotes it, and rebuilds its projection", () => {
    const currentRoot = openRoot();
    seedReviewEvents(currentRoot);
    const proposed = currentRoot.runtime.proposeAsset({
      id: "asset-1",
      kind: "skill",
      version: "1.0.0",
      body: { instruction: "show the source chain" },
      derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    expect(proposed.record.type).toBe("asset.candidate");
    expect(currentRoot.inspectAsset("asset-1")).toMatchObject({
      status: "candidate",
      revision: 1,
    });

    const validated = currentRoot.runtime.promoteAsset(
      "asset-1",
      review(),
      "2026-09-15T00:00:01.000Z",
    );
    expect(validated.record.type).toBe("asset.validated");
    expect(currentRoot.inspectAsset("asset-1")).toMatchObject({
      status: "validated",
      revision: 2,
    });

    const active = currentRoot.runtime.promoteAsset(
      "asset-1",
      review("active"),
      "2026-09-15T00:00:02.000Z",
    );
    expect(active.record.type).toBe("asset.activate");
    expect(currentRoot.inspectAsset("asset-1")).toMatchObject({
      status: "active",
      revision: 3,
    });

    expect(
      currentRoot
        .catchUpCoreProjections()
        .every((item) => item.status === "caught_up"),
    ).toBe(true);
    const projection = currentRoot.inspectEvent(active.record.id);
    expect(projection?.payload).toMatchObject({
      assetId: "asset-1",
      asset: { status: "active", revision: 3 },
    });
    expect(currentRoot.doctor().status).toBe("pass");
  });

  it("denies promotion without independent evidence or explicit human confirmation", () => {
    const currentRoot = openRoot();
    seedReviewEvents(currentRoot);
    currentRoot.runtime.proposeAsset({
      id: "asset-2",
      kind: "workflow",
      version: "1.0.0",
      body: { step: "verify" },
      derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    expect(() =>
      currentRoot.runtime.promoteAsset("asset-2", {
        ...review(),
        episodes: [
          {
            episodeId: "episode-1",
            evidence: [{ eventId: "episode-event-1", origin: "direct" }],
            exposureInfluenced: true,
          },
          {
            episodeId: "episode-2",
            evidence: [{ eventId: "episode-event-2", origin: "direct" }],
            exposureInfluenced: true,
          },
        ],
      }),
    ).toThrowError("asset promotion denied by policy");

    expect(() =>
      currentRoot.runtime.promoteAsset("asset-2", {
        ...review(),
        targetStatus: "active",
        humanConfirmed: false,
      }),
    ).toThrowError("asset promotion denied by policy");
    expect(currentRoot.listAssets()).toHaveLength(1);
    expect(currentRoot.exportEvents({ type: "asset.activate" })).toEqual([]);
  });

  it("rejects provenance origin mismatches before creating a catalog row", () => {
    const currentRoot = openRoot();
    currentRoot.runtime.appendEvent(event("asset-provenance"));

    expect(() =>
      currentRoot.runtime.proposeAsset({
        id: "asset-bad-origin",
        kind: "rule",
        version: "1.0.0",
        body: { rule: "do not trust relabeled evidence" },
        derivedFrom: [{ eventId: "asset-provenance", origin: "inferred" }],
        createdAt: "2026-09-15T00:00:00.000Z",
      }),
    ).toThrowError("evidence origin does not match ledger provenance");
    expect(currentRoot.inspectAsset("asset-bad-origin")).toBeNull();
  });

  it("uses human controls for challenge, restore, deprecation, and fork", () => {
    const currentRoot = openRoot();
    seedReviewEvents(currentRoot);
    currentRoot.runtime.proposeAsset({
      id: "asset-3",
      kind: "pattern",
      version: "1.0.0",
      body: { pattern: "bounded" },
      derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
      createdAt: "2026-09-15T00:00:00.000Z",
    });

    const challenged = currentRoot.runtime.contestAsset(
      "asset-3",
      "review requested",
      "2026-09-15T00:00:01.000Z",
    );
    expect(challenged.record.type).toBe("asset.contest");
    expect(currentRoot.inspectAsset("asset-3")?.status).toBe("challenged");
    const restored = currentRoot.runtime.restoreAsset(
      "asset-3",
      "evidence rechecked",
      "2026-09-15T00:00:02.000Z",
    );
    expect(restored.record.type).toBe("asset.restore");
    expect(currentRoot.inspectAsset("asset-3")?.status).toBe("validated");
    const forked = currentRoot.runtime.forkAsset(
      "asset-3",
      "asset-3-fork",
      "separate interpretation",
      "2026-09-15T00:00:03.000Z",
    );
    expect(forked.record.type).toBe("asset.fork");
    expect(currentRoot.inspectAsset("asset-3-fork")).toMatchObject({
      status: "candidate",
      revision: 1,
      forkedFrom: { id: "asset-3", revision: 3 },
    });
    const disabled = currentRoot.runtime.disableAsset(
      "asset-3-fork",
      "do not expose",
      "2026-09-15T00:00:04.000Z",
    );
    expect(disabled.record.type).toBe("asset.disable");
    expect(currentRoot.inspectAsset("asset-3-fork")?.status).toBe("deprecated");
  });

  it("rejects low-level activation and preserves optimistic-lock conflicts", () => {
    const currentRoot = openRoot();
    seedReviewEvents(currentRoot);
    const candidate = currentRoot.runtime.proposeAsset({
      id: "asset-cas",
      kind: "rule",
      version: "1.0.0",
      body: { rule: "retain source evidence" },
      derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    expect(candidate.inserted).toBe(true);
    const current = currentRoot.inspectAsset("asset-cas");
    expect(current).toEqual(candidateAsset());

    const next = transitionAsset(
      current!,
      "validated",
      "2026-09-15T00:00:01.000Z",
    );
    const lowLevelEvent: EventEnvelope = {
      schemaVersion: "1",
      eventVersion: "1",
      id: "low-level-asset-validated",
      type: "asset.validated",
      occurredAt: "2026-09-15T00:00:01.000Z",
      observedAt: "2026-09-15T00:00:01.000Z",
      recordedAt: "2026-09-15T00:00:01.000Z",
      actor: { type: "human", id: "phase4-owner" },
      operationId: "low-level-asset-validated",
      source: { kind: "phase4-test", ref: "asset-cas" },
      payload: {
        materialClassification: "declared",
        id: next.id,
        assetId: next.id,
        asset: next as unknown as Record<string, unknown>,
        action: "validated",
      } as unknown as JsonValue,
      evidence: [{ eventId: "asset-provenance", origin: "direct" }],
      links: { derivedFrom: ["asset-provenance"] },
      provenance: { origin: "declared", confidence: 1 },
    };
    expect(() => store!.append(lowLevelEvent, owner)).toThrowError(
      expect.objectContaining({ code: "ASSET_WRITE_REQUIRED" }),
    );

    expect(() =>
      store!.appendAssetEvent(lowLevelEvent, owner, next, 1),
    ).toThrowError(expect.objectContaining({ code: "ASSET_WRITE_REQUIRED" }));

    const managedLowLevelEvent: EventEnvelope = {
      ...lowLevelEvent,
      id: "atomic-asset-validated",
      operationId: "atomic-asset-validated",
      source: { kind: "asset-promotion", ref: "asset-cas" },
      payload: {
        ...(lowLevelEvent.payload as Record<string, unknown>),
        review: {
          targetStatus: "validated",
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
            validatorId: "validator:phase4",
            passed: true,
            evidence: [{ eventId: "validation-event", origin: "direct" }],
          },
        },
        decision: {
          allowed: true,
          targetStatus: "validated",
          reasons: [],
          evidenceCount: 2,
          independentEpisodeCount: 2,
          exposureInfluencedEvidenceCount: 0,
        },
      } as unknown as JsonValue,
    };

    const atomic = store!.appendAssetEvent(
      managedLowLevelEvent,
      owner,
      next,
      1,
    );
    expect(atomic.inserted).toBe(true);
    expect(() =>
      store!.appendAssetEvent(
        {
          ...managedLowLevelEvent,
          id: "stale-asset-validated",
          operationId: "stale-asset-validated",
        },
        owner,
        next,
        1,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "ASSET_REVISION_CONFLICT" }),
    );
  });

  it("invalidates catalog rows when an authorized privacy purge removes their source chain", () => {
    const currentRoot = openRoot();
    currentRoot.runtime.appendEvent(
      event("purge-provenance", "private-session"),
    );
    currentRoot.runtime.proposeAsset({
      id: "asset-purge",
      kind: "summary",
      version: "1.0.0",
      body: { private: "source-bound" },
      derivedFrom: [{ eventId: "purge-provenance", origin: "direct" }],
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    expect(currentRoot.inspectAsset("asset-purge")).not.toBeNull();

    const dryRun = currentRoot.privacyPurge("private-session");
    expect(dryRun.plan.affectedAssetIds).toEqual(["asset-purge"]);
    const result = currentRoot.privacyPurge("private-session", {
      confirm: true,
      planHash: dryRun.plan.planHash,
      executedAt: Date.parse("2026-09-15T00:00:01.000Z"),
    });
    expect(result.receipt?.invalidatedAssetIds).toEqual(["asset-purge"]);
    expect(currentRoot.inspectAsset("asset-purge")).toBeNull();
    expect(currentRoot.exportEvents({ type: "asset.candidate" })).toEqual([]);
    expect(currentRoot.doctor().status).toBe("pass");
  });

  it("makes catalog drift visible through the doctor gate", () => {
    const currentRoot = openRoot();
    currentRoot.runtime.appendEvent(event("asset-provenance"));
    currentRoot.runtime.proposeAsset({
      id: "asset-drift",
      kind: "rule",
      version: "1.0.0",
      body: { rule: "retain source evidence" },
      derivedFrom: [{ eventId: "asset-provenance", origin: "direct" }],
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    currentRoot.catchUpCoreProjections();

    const tamper = new DatabaseSync(join(directory!, "events.db"));
    try {
      tamper
        .prepare("UPDATE assets SET body_json = ? WHERE id = ?")
        .run("{}", "asset-drift");
    } finally {
      tamper.close();
    }

    const report = currentRoot.doctor();
    expect(report.status).toBe("fail");
    expect(
      report.checks.find((check) => check.name === "asset-provenance"),
    ).toMatchObject({
      status: "fail",
      details: {
        issues: expect.arrayContaining([
          "asset-drift:catalog-snapshot-mismatch",
        ]),
      },
    });
  });
});
