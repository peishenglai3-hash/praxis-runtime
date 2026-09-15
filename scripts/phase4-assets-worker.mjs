/* global process */

import { SqliteEventStore } from "../packages/store/dist/index.js";

const [, , filename, migrationsDir, workerId] = process.argv;
if (!filename || !migrationsDir || !workerId) {
  throw new Error(
    "phase4 worker requires filename, migrationsDir, and workerId",
  );
}

const store = new SqliteEventStore({ filename, migrationsDir });
try {
  const current = store.getAsset("asset-cas");
  if (current === null) throw new Error("phase4 CAS fixture is missing");
  const next = {
    ...current,
    revision: 2,
    status: "validated",
    updatedAt: "2026-09-15T00:00:01.000Z",
  };
  const event = {
    schemaVersion: "1",
    eventVersion: "1",
    id: `phase4-cas-worker-${workerId}`,
    type: "asset.validated",
    occurredAt: "2026-09-15T00:00:01.000Z",
    observedAt: "2026-09-15T00:00:01.000Z",
    recordedAt: "2026-09-15T00:00:01.000Z",
    actor: { type: "human", id: "phase4-owner" },
    operationId: `phase4-cas-worker-${workerId}`,
    source: { kind: "asset-promotion", ref: workerId },
    payload: {
      materialClassification: "declared",
      id: next.id,
      assetId: next.id,
      asset: next,
      action: "validated",
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
    },
    evidence: [{ eventId: "asset-provenance", origin: "direct" }],
    links: { derivedFrom: ["asset-provenance"] },
    provenance: { origin: "declared", confidence: 1 },
  };
  const writer = {
    writerId: "test:phase4-owner",
    kind: "human",
    role: "OWNER",
    authn: "embedded-local",
    scopes: [
      "event.read",
      "event.append",
      "state.read",
      "residual.propose",
      "tool.execute",
      "asset.propose",
      "asset.activate",
      "asset.contest",
      "asset.disable",
      "asset.fork",
      "history.export",
      "history.purge",
      "system.migrate",
    ],
    policyVersion: 1,
  };
  try {
    const result = store.appendAssetEvent(event, writer, next, 1);
    process.stdout.write(
      JSON.stringify({ workerId, status: "inserted", seq: result.record.seq }),
    );
  } catch (error) {
    const code = error?.code;
    if (code !== "ASSET_REVISION_CONFLICT") throw error;
    process.stdout.write(JSON.stringify({ workerId, status: "conflict" }));
  }
} finally {
  store.close();
}
