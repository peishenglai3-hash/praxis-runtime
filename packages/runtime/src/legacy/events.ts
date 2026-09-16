import type {
  ActorRef,
  EventEnvelope,
  EvidenceRef,
  JsonValue,
  LegacyMigrationPlan,
  LegacySourceEntry,
} from "@praxis/contracts";
import { legacyEventId } from "@praxis/contracts";

/**
 * Deterministic conversion of a reviewed plan into ledger events.
 *
 * The conversion is pure: the same plan produces byte-identical events, which
 * is what makes a retry idempotent at the ledger boundary. Nothing here
 * promotes a pattern into an active rule — a first-generation pattern becomes
 * inferred material with low provenance and stops there.
 */

export const LEGACY_EVENT_VERSION = "1";
export const LEGACY_SOURCE_KIND = "legacy-import";

/** Purge scope for imported material. A corpus is one purgeable group. */
export function legacySessionId(sourceFingerprint: string): string {
  return `legacy:${sourceFingerprint.slice(0, 16)}`;
}

export interface LegacyEventBuildInput {
  plan: LegacyMigrationPlan;
  actor: ActorRef;
  recordedAt: string;
  archiveEntryCount: number;
}

interface EvidenceSource {
  artifactHash: string;
  relativePath: string;
}

function artifactHashes(
  inventory: readonly LegacySourceEntry[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of inventory) map.set(entry.relativePath, entry.sha256);
  return map;
}

function firstEntryOfKind(
  inventory: readonly LegacySourceEntry[],
  kind: LegacySourceEntry["artifactKind"],
): EvidenceSource {
  const entry = inventory.find((item) => item.artifactKind === kind);
  if (entry === undefined) {
    // The inventory is the plan's own record of what was read, so this is a
    // programming error rather than a source condition. Refusing is the only
    // honest response: a placeholder digest would be indistinguishable from a
    // real one in the ledger, and the evidence would point at nothing.
    throw new Error(
      `legacy plan carries no ${kind} entry, so an imported record would cite evidence that does not exist`,
    );
  }
  return { artifactHash: entry.sha256, relativePath: entry.relativePath };
}

/**
 * The digest an anomaly's evidence should name.
 *
 * An anomaly about one file names that file's digest. An anomaly about the
 * corpus as a whole — conflicting manifest versions, a privacy rule that
 * matched nothing, an artifact family that was read but not imported — has no
 * single file, and its evidence names the corpus fingerprint, which is a real
 * digest of exactly what was read.
 */
function anomalyEvidenceHash(
  hashes: ReadonlyMap<string, string>,
  relativePath: string | undefined,
  corpusFingerprint: string,
  label: string,
): string {
  if (relativePath === undefined) return corpusFingerprint;
  const digest = hashes.get(relativePath);
  if (digest === undefined) {
    throw new Error(
      `${label} cites ${relativePath}, which is not in the plan inventory`,
    );
  }
  return digest;
}

function evidenceFor(
  hash: string,
  origin: "declared" | "inferred" | "direct",
): EvidenceRef[] {
  return [{ artifactHash: hash, origin }];
}

export function buildLegacyImportEvents(
  input: LegacyEventBuildInput,
): EventEnvelope[] {
  const { plan, actor, recordedAt, archiveEntryCount } = input;
  const hashes = artifactHashes(plan.inventory.entries);
  const indexHash = firstEntryOfKind(plan.inventory.entries, "signal_index");
  const graphHash = firstEntryOfKind(plan.inventory.entries, "graph_state");
  const sessionId = legacySessionId(plan.sourceFingerprint);
  const source = { kind: LEGACY_SOURCE_KIND, ref: plan.sourceFingerprint };

  const events: EventEnvelope[] = [];

  for (const signal of plan.signals) {
    events.push(
      buildEvent({
        type: "legacy.signal.imported",
        payload: {
          materialClassification: "declared",
          sourceFingerprint: plan.sourceFingerprint,
          sourcePath: signal.sourcePath ?? plan.inventory.root,
          recordId: signal.recordId,
          signalKind: signal.signalKind,
          category: signal.category,
          value: signal.value,
          declaredTimestamp: signal.declaredTimestamp,
          confidence: signal.confidence,
          source: signal.source,
          declaredFields: signal.declaredFields,
          absentFields: signal.absentFields,
        },
        occurredAt: signal.occurredAt,
        observedAt: signal.occurredAt,
        recordedAt,
        sessionId,
        actor,
        source,
        evidence: evidenceFor(indexHash.artifactHash, "declared"),
        provenance: { origin: "declared", confidence: signal.confidence },
      }),
    );
  }

  for (const pattern of plan.patterns) {
    const hash =
      hashes.get(pattern.sourcePaths[0] ?? "") ?? graphHash.artifactHash;
    events.push(
      buildEvent({
        type: "legacy.pattern.imported",
        payload: {
          materialClassification: "inferred",
          sourceFingerprint: plan.sourceFingerprint,
          sourcePath: pattern.sourcePaths[0] ?? plan.inventory.root,
          patternId: pattern.patternId,
          trigger: pattern.trigger,
          action: pattern.action,
          confidence: pattern.confidence,
          frequency: pattern.frequency,
          collisionCount: pattern.collisionCount,
        },
        occurredAt: pattern.createdAt,
        observedAt: pattern.lastSeen,
        recordedAt,
        sessionId,
        actor,
        source,
        evidence: evidenceFor(hash, "inferred"),
        // A derived pattern is inferred material, so its confidence is capped
        // below certainty even when the source declared a high value.
        provenance: {
          origin: "inferred",
          confidence: Math.min(0.5, pattern.confidence),
        },
      }),
    );
  }

  for (const edge of plan.graphEdges) {
    events.push(
      buildEvent({
        type: "legacy.graph-edge.imported",
        payload: {
          materialClassification: "inferred",
          sourceFingerprint: plan.sourceFingerprint,
          sourcePath: graphHash.relativePath,
          from: edge.from,
          to: edge.to,
          strength: edge.strength,
          frequency: edge.frequency,
          relationClass: edge.relationClass,
        },
        // The source declares one build time for the whole association set.
        // When it declares none, the association is imported without a claimed
        // instant rather than with the importing host's clock read.
        occurredAt: edge.declaredBuiltAt ?? recordedAt,
        observedAt: edge.declaredBuiltAt ?? recordedAt,
        recordedAt,
        sessionId,
        actor,
        source,
        evidence: evidenceFor(graphHash.artifactHash, "inferred"),
        provenance: { origin: "inferred", confidence: 0.3 },
      }),
    );
  }

  for (const anomaly of plan.inventory.anomalies) {
    events.push(
      buildEvent({
        type: "legacy.anomaly",
        payload: {
          materialClassification: "direct",
          sourceFingerprint: plan.sourceFingerprint,
          anomalyId: anomaly.id,
          anomalyClass: anomaly.class,
          reason: anomaly.reason,
          affectedCount: anomaly.affectedCount,
          ...(anomaly.relativePath === undefined
            ? {}
            : { relativePath: anomaly.relativePath }),
          ...(anomaly.declaredValue === undefined
            ? {}
            : { declaredValue: anomaly.declaredValue }),
        },
        occurredAt: recordedAt,
        observedAt: recordedAt,
        recordedAt,
        sessionId,
        actor,
        source,
        evidence: evidenceFor(
          anomalyEvidenceHash(
            hashes,
            anomaly.relativePath,
            plan.sourceFingerprint,
            "legacy anomaly",
          ),
          "direct",
        ),
        provenance: { origin: "direct", confidence: 1 },
      }),
    );
  }

  events.push(
    buildEvent({
      type: "legacy.import.completed",
      payload: {
        materialClassification: "direct",
        sourceFingerprint: plan.sourceFingerprint,
        root: plan.root,
        planHash: plan.planHash,
        status: "applied",
        counts: plan.counts,
        archiveEntryCount,
      },
      occurredAt: recordedAt,
      observedAt: recordedAt,
      recordedAt,
      sessionId,
      actor,
      source,
      evidence: evidenceFor(indexHash.artifactHash, "direct"),
      provenance: { origin: "direct", confidence: 1 },
    }),
  );

  return events;
}

interface BuildEventInput {
  type:
    | "legacy.signal.imported"
    | "legacy.pattern.imported"
    | "legacy.graph-edge.imported"
    | "legacy.anomaly"
    | "legacy.import.completed";
  payload: Record<string, unknown>;
  occurredAt: string;
  observedAt: string;
  recordedAt: string;
  sessionId: string;
  actor: ActorRef;
  source: { kind: string; ref: string };
  evidence: EvidenceRef[];
  provenance: EventEnvelope["provenance"];
}

function buildEvent(input: BuildEventInput): EventEnvelope {
  const payload = input.payload as unknown as JsonValue;
  const id = legacyEventId(input.type, payload as never);
  return {
    schemaVersion: "1",
    eventVersion: LEGACY_EVENT_VERSION,
    id,
    type: input.type,
    occurredAt: input.occurredAt,
    observedAt: input.observedAt,
    recordedAt: input.recordedAt,
    actor: input.actor,
    sessionId: input.sessionId,
    operationId: id,
    source: input.source,
    payload,
    evidence: input.evidence,
    provenance: input.provenance,
  };
}
