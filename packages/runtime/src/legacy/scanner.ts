import type {
  LegacyAnomaly,
  LegacyAnomalyClass,
  LegacyArtifactKind,
  LegacyExclusion,
  LegacyGraphEdge,
  LegacyMigrationCounts,
  LegacyMigrationPlan,
  LegacyPatternRecord,
  LegacyPrivacyRule,
  LegacySignalRecord,
  LegacySourceEntry,
  LegacySourceInventory,
} from "@praxis/contracts";
import { legacyOptionalSignalFields, stableStringify } from "@praxis/contracts";

import {
  asArray,
  asFiniteNumber,
  asInteger,
  asRecord,
  asString,
  canonicalizeDeclaredTimestamp,
  decodeUtf8,
  parseFrontmatter,
  parseJsonDocument,
  parseNdjson,
  sha256Hex,
} from "./parse.js";

/**
 * Read-only Legacy scanner.
 *
 * The scanner answers one question per file: what is this, did it parse, and
 * what does its shape prove about loss? It never writes to the source, never
 * normalises a source file in place, and never fills a gap it did not observe.
 *
 * Two roots may be supplied. In practice the data directory holds the history
 * and a checkout of the first-generation repository holds the manifests, and
 * the version-drift class is only observable when both are present.
 */

export interface LegacySourceFile {
  relativePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  bytes: Uint8Array;
}

export interface LegacyFileSystem {
  readSourceFiles(root: string): LegacySourceFile[];
}

export interface LegacyScanResult {
  inventory: LegacySourceInventory;
  signals: LegacySignalRecord[];
  patterns: LegacyPatternRecord[];
  graphEdges: LegacyGraphEdge[];
  exclusions: LegacyExclusion[];
}

export interface LegacyScanOptions {
  privacyRules?: readonly LegacyPrivacyRule[];
  now?: () => Date;
}

/**
 * Index-level fields that have a usable default. The default keeps a record
 * readable; it never stands in for a declared value, because every field that
 * fell back to it is named in the record's `absentFields`.
 */
const indexFieldDefaults = [
  "type",
  "category",
  "confidence",
  "source",
] as const;

function isDeclared(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

const SIGNAL_BODY_PATTERN = /^signals\/[^/]+\/[^/]+\.md$/;
const PATTERN_BODY_PATTERN = /^patterns\/(?:active|archived)\/[^/]+\.md$/;
const EVENT_RECORD_PATTERN = /^\.events\/[^/]+\.json$/;
const PROFILE_DOCUMENT_PATTERN = /^profile\/[^/]+\.(?:md|json)$/;

export function classifyArtifact(relativePath: string): LegacyArtifactKind {
  if (relativePath === ".signals_index.json") return "signal_index";
  if (relativePath === ".signal_buffer.json") return "signal_buffer";
  if (relativePath === ".graph_state.json") return "graph_state";
  if (relativePath === ".events/event.log") return "event_log";
  if (relativePath === ".events/.subscriptions.json")
    return "subscription_index";
  if (EVENT_RECORD_PATTERN.test(relativePath)) return "event_record";
  if (SIGNAL_BODY_PATTERN.test(relativePath)) return "signal_body";
  if (PATTERN_BODY_PATTERN.test(relativePath)) return "pattern_body";
  if (PROFILE_DOCUMENT_PATTERN.test(relativePath)) return "profile_document";
  if (relativePath === "hub-manifest.json") return "source_manifest";
  if (relativePath === ".codex-plugin/plugin.json") return "source_manifest";
  return "unmapped_path";
}

function withRoot(root: string, relativePath: string): string {
  const trimmed = root.endsWith("/") ? root.slice(0, -1) : root;
  return `${trimmed}/${relativePath}`;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface ScannedFile {
  /** Path relative to the root that produced it, as the field map names it. */
  key: string;
  entry: LegacySourceEntry;
  text: string;
  hadBom: boolean;
  decodable: boolean;
}

/**
 * Anomalies accumulate into a merged map so that a corpus with 45 identical
 * anchor failures reports one row carrying `affectedCount: 45` rather than 45
 * near-identical rows.
 */
class AnomalyCollector {
  readonly #merged = new Map<string, LegacyAnomaly>();

  add(
    anomalyClass: LegacyAnomalyClass,
    reason: string,
    fields: {
      relativePath?: string;
      artifactKind?: LegacyArtifactKind;
      declaredValue?: string;
      affectedCount?: number;
    } = {},
  ): void {
    // Components are digested individually rather than joined by a
    // separator character, so no component can forge a boundary.
    //
    // `artifactKind` is stored on the anomaly but is deliberately not part of
    // the key. Every call site derives it from the same path that is in the
    // key (`classifyArtifact`), and where a kind stands alone it is carried in
    // `declaredValue`, so two anomalies can never differ by kind alone. Adding
    // it would change every anomaly id — and therefore every plan hash — for
    // no change in behaviour.
    const key = [
      anomalyClass,
      reason,
      fields.declaredValue ?? "",
      fields.relativePath ?? "",
    ]
      .map((part) => sha256Hex(part).slice(0, 16))
      .join("-");
    const existing = this.#merged.get(key);
    if (existing !== undefined) {
      existing.affectedCount += fields.affectedCount ?? 1;
      return;
    }
    this.#merged.set(key, {
      // The identifier spans the whole merge key, so anomalies that
      // share a class and a declared value but differ in reason or
      // path stay distinct records.
      id: `${anomalyClass}:${sha256Hex(key).slice(0, 12)}`,
      class: anomalyClass,
      reason,
      affectedCount: fields.affectedCount ?? 1,
      ...(fields.relativePath === undefined
        ? {}
        : { relativePath: fields.relativePath }),
      ...(fields.artifactKind === undefined
        ? {}
        : { artifactKind: fields.artifactKind }),
      ...(fields.declaredValue === undefined
        ? {}
        : { declaredValue: fields.declaredValue }),
    });
  }

  list(): LegacyAnomaly[] {
    return [...this.#merged.values()].sort((left, right) =>
      comparePaths(`${left.class}#${left.id}`, `${right.class}#${right.id}`),
    );
  }

  count(): number {
    let total = 0;
    for (const anomaly of this.#merged.values()) {
      total += anomaly.affectedCount;
    }
    return total;
  }
}

/**
 * Scan every supplied root and produce a deterministic inventory.
 *
 * Determinism matters twice: the inventory feeds the plan hash that a human
 * confirms, and the corpus fingerprint is part of every imported event's
 * identity. Files are therefore sorted by their qualified path before hashing.
 */
export function scanLegacySources(
  roots: readonly string[],
  fileSystem: LegacyFileSystem,
  options: LegacyScanOptions = {},
): LegacyScanResult {
  const now = options.now ?? (() => new Date());
  const privacyRules = options.privacyRules ?? [];
  const anomalies = new AnomalyCollector();

  const rawFiles: Array<{ root: string; file: LegacySourceFile }> = [];
  for (const root of roots) {
    for (const file of fileSystem.readSourceFiles(root)) {
      rawFiles.push({ root, file });
    }
  }
  rawFiles.sort((left, right) =>
    comparePaths(
      withRoot(left.root, left.file.relativePath),
      withRoot(right.root, right.file.relativePath),
    ),
  );

  const scanned: ScannedFile[] = [];
  const exclusions: LegacyExclusion[] = [];
  const excludedPaths = new Set<string>();
  const excludedKeys = new Set<string>();
  const matchedRuleIds = new Set<string>();

  for (const { root, file } of rawFiles) {
    const relativePath = file.relativePath;
    const artifactKind = classifyArtifact(relativePath);
    const digest = sha256Hex(file.bytes);
    const decoded = decodeUtf8(file.bytes);
    const anomalyClasses: LegacyAnomalyClass[] = [];
    let parseStatus: LegacySourceEntry["parseStatus"] = "parsed";

    if (decoded.hadBom) {
      anomalyClasses.push("encoding_marker");
      anomalies.add(
        "encoding_marker",
        "file begins with a UTF-8 byte-order mark",
        {
          relativePath: withRoot(root, relativePath),
          artifactKind,
          declaredValue: "utf8-bom",
        },
      );
    }
    if (!decoded.decodable) {
      anomalyClasses.push("parse_error");
      parseStatus = "failed";
      anomalies.add("parse_error", "file is not valid UTF-8", {
        relativePath: withRoot(root, relativePath),
        artifactKind,
      });
    }
    if (artifactKind === "unmapped_path") {
      anomalyClasses.push("unmapped_path");
      anomalies.add(
        "unmapped_path",
        "path is not described by the legacy field map",
        {
          relativePath: withRoot(root, relativePath),
          artifactKind,
        },
      );
    }

    // A rule may be written against the absolute source path or against the
    // path as the field map names it. Matching only the absolute form would
    // make the more natural spelling silently match nothing.
    const matchedRule = privacyRules.find(
      (rule) =>
        withRoot(root, relativePath).startsWith(rule.pathPrefix) ||
        relativePath.startsWith(rule.pathPrefix),
    );
    if (matchedRule !== undefined) {
      anomalyClasses.push("privacy_sensitive");
      matchedRuleIds.add(matchedRule.ruleId);
      exclusions.push({
        ruleId: matchedRule.ruleId,
        relativePath: withRoot(root, relativePath),
        reason: matchedRule.reason,
      });
      anomalies.add("privacy_sensitive", matchedRule.reason, {
        relativePath: withRoot(root, relativePath),
        artifactKind,
        declaredValue: matchedRule.ruleId,
      });
      excludedPaths.add(withRoot(root, relativePath));
      excludedKeys.add(relativePath);
    }

    scanned.push({
      key: relativePath,
      entry: {
        relativePath: withRoot(root, relativePath),
        artifactKind,
        sizeBytes: file.sizeBytes,
        modifiedAtMs: file.modifiedAtMs,
        sha256: digest,
        parseStatus,
        anomalyClasses,
      },
      text: decoded.text,
      hadBom: decoded.hadBom,
      decodable: decoded.decodable,
    });
  }

  const signals = collectSignals(scanned, anomalies, excludedKeys);
  const patterns = collectPatterns(scanned, anomalies, excludedKeys);
  const graphEdges = collectGraphEdges(scanned, anomalies, excludedKeys);
  collectEventLog(scanned, anomalies);
  collectVersionDeclarations(scanned, anomalies);
  collectUnsupportedFamilies(scanned, anomalies);

  for (const rule of privacyRules) {
    if (matchedRuleIds.has(rule.ruleId)) continue;
    anomalies.add(
      "privacy_sensitive",
      "a declared privacy rule matched nothing under this source root",
      { declaredValue: rule.ruleId },
    );
  }

  const countsByArtifactKind: Record<string, number> = {};
  for (const file of scanned) {
    countsByArtifactKind[file.entry.artifactKind] =
      (countsByArtifactKind[file.entry.artifactKind] ?? 0) + 1;
  }
  const anomalyList = anomalies.list();
  const countsByAnomalyClass: Record<string, number> = {};
  for (const anomaly of anomalyList) {
    countsByAnomalyClass[anomaly.class] =
      (countsByAnomalyClass[anomaly.class] ?? 0) + anomaly.affectedCount;
  }

  // The fingerprint identifies the corpus by content and layout, not by where
  // it currently lives. Including the root would make the same corpus at a new
  // path a different corpus, so a move would re-import every record instead of
  // being recognised as the same material.
  const fingerprint = sha256Hex(
    stableStringify(
      scanned.map((file) => ({
        path: file.key,
        sha256: file.entry.sha256,
      })) as never,
    ),
  );

  return {
    inventory: {
      root: roots.join(","),
      fingerprint,
      scannedAt: now().toISOString(),
      fileCount: scanned.length,
      totalBytes: scanned.reduce(
        (total, file) => total + file.entry.sizeBytes,
        0,
      ),
      entries: scanned.map((file) => file.entry),
      anomalies: anomalyList,
      countsByArtifactKind,
      countsByAnomalyClass,
    },
    signals,
    patterns,
    graphEdges,
    exclusions,
  };
}

function findFile(
  scanned: readonly ScannedFile[],
  relativePath: string,
): ScannedFile | undefined {
  return scanned.find((file) => file.key === relativePath);
}

function markFailure(
  file: ScannedFile,
  anomalyClass: LegacyAnomalyClass,
): void {
  if (file.entry.parseStatus !== "failed") {
    file.entry.parseStatus = "partially_parsed";
  }
  if (!file.entry.anomalyClasses.includes(anomalyClass)) {
    file.entry.anomalyClasses.push(anomalyClass);
  }
}

function collectSignals(
  scanned: readonly ScannedFile[],
  anomalies: AnomalyCollector,
  excludedKeys: ReadonlySet<string>,
): LegacySignalRecord[] {
  const bodyFieldCounts = new Map<string, number>();
  let bodyCount = 0;

  for (const file of scanned) {
    if (file.entry.artifactKind !== "signal_body") continue;
    bodyCount += 1;
    const result = parseFrontmatter(file.text);
    if (result.parsed === undefined) {
      file.entry.parseStatus = "failed";
      markFailure(file, "parse_error");
      anomalies.add(
        "parse_error",
        result.failure?.detail ?? "unparsable signal body",
        {
          relativePath: file.entry.relativePath,
          artifactKind: "signal_body",
          ...(result.failure === undefined
            ? {}
            : { declaredValue: result.failure.reason }),
        },
      );
      continue;
    }
    for (const key of result.parsed.fieldOrder) {
      bodyFieldCounts.set(key, (bodyFieldCounts.get(key) ?? 0) + 1);
    }
  }

  if (bodyCount > 0) {
    const declaredOptional = [
      "evidence",
      "context",
      ...legacyOptionalSignalFields,
    ];
    const absent = declaredOptional.filter(
      (field) => (bodyFieldCounts.get(field) ?? 0) === 0,
    );
    if (absent.length > 0) {
      anomalies.add(
        "unrecoverable_field",
        "field is declared by the first-generation writer but absent from every observed signal body",
        {
          artifactKind: "signal_body",
          declaredValue: absent.join(","),
          affectedCount: bodyCount,
        },
      );
    }
  }

  const indexFile = findFile(scanned, ".signals_index.json");
  if (indexFile === undefined) return [];
  // A privacy rule that matches the index excludes the material it carries,
  // rather than only reporting that it matched.
  if (excludedKeys.has(indexFile.key)) return [];
  const parsed = parseJsonDocument(indexFile.text, indexFile.hadBom);
  if (parsed.failure !== undefined) {
    indexFile.entry.parseStatus = "failed";
    markFailure(indexFile, "parse_error");
    anomalies.add("parse_error", parsed.failure.detail, {
      relativePath: indexFile.entry.relativePath,
      artifactKind: "signal_index",
      declaredValue: parsed.failure.reason,
    });
    return [];
  }

  const indexRecord = asRecord(parsed.value);
  if (indexRecord === undefined || !Array.isArray(indexRecord["signals"])) {
    // A file classified as the signal index that parses but carries no
    // signal array is a shape the field map does not describe. Reporting
    // zero signals and zero anomalies would drop a whole artifact family.
    markFailure(indexFile, "parse_error");
    anomalies.add(
      "parse_error",
      "the signal index parsed but declares no signal array, so no record in it could be read",
      {
        relativePath: indexFile.entry.relativePath,
        artifactKind: "signal_index",
        declaredValue: "signals-array-absent",
      },
    );
    return [];
  }
  const rawSignals = asArray(indexRecord["signals"]);
  const observedFields = new Set<string>();
  const sequenceByBucket = new Map<string, number[]>();
  const records: LegacySignalRecord[] = [];
  let excludedCount = 0;

  for (const raw of rawSignals) {
    const record = asRecord(raw);
    if (record === undefined) continue;
    for (const key of Object.keys(record)) observedFields.add(key);

    const recordId = asString(record["id"]);
    const timestamp = canonicalizeDeclaredTimestamp(record["timestamp"]);
    if (recordId.length === 0 || timestamp === undefined) {
      excludedCount += 1;
      continue;
    }

    const match = /^(sig_\d{8})_(\d+)$/.exec(recordId);
    if (match !== null) {
      const bucket = match[1] ?? "";
      const ordinal = Number.parseInt(match[2] ?? "0", 10);
      const ordinals = sequenceByBucket.get(bucket) ?? [];
      ordinals.push(ordinal);
      sequenceByBucket.set(bucket, ordinals);
    }

    // Four index-level fields fall back to a default so the record stays
    // readable. Every field that did is named in `absentFields`, so a reader
    // never mistakes a default for something the source declared, and the
    // producer is not given a name it never claimed.
    const defaulted = indexFieldDefaults.filter(
      (field) => !isDeclared(record[field]),
    );
    records.push({
      recordId,
      signalKind: asString(record["type"], "undeclared"),
      category: asString(record["category"], "uncategorized"),
      value: asString(record["value"]),
      occurredAt: timestamp.value,
      declaredTimestamp: asString(record["timestamp"]),
      confidence: Math.min(
        1,
        Math.max(0, asFiniteNumber(record["confidence"], 0.5)),
      ),
      source: asString(record["source"], "undeclared"),
      sourcePath: indexFile.entry.relativePath,
      declaredFields: Object.keys(record).sort(comparePaths),
      absentFields: [
        ...defaulted,
        ...legacyOptionalSignalFields.filter((field) => !(field in record)),
      ].sort(comparePaths),
    });
  }

  if (excludedCount > 0) {
    anomalies.add(
      "parse_error",
      "index entry carries no usable identifier, or its declared instant has no time-zone designator and cannot be read from the declaration alone; the entry was excluded from import rather than given an instant this host chose",
      {
        artifactKind: "signal_index",
        affectedCount: excludedCount,
        declaredValue: "excluded-entries",
      },
    );
  }

  const absentTheoryFields = legacyOptionalSignalFields.filter(
    (field) => !observedFields.has(field),
  );
  if (absentTheoryFields.length > 0) {
    anomalies.add(
      "unrecoverable_field",
      "theory field is declared optional by the first-generation writer and present in no index entry",
      {
        artifactKind: "signal_index",
        declaredValue: absentTheoryFields.join(","),
        affectedCount: Math.max(rawSignals.length, 1),
      },
    );
  }

  detectOrdinalGaps(sequenceByBucket, anomalies);
  return records;
}

/**
 * The first-generation writer builds `sig_<date>_<nnn>` from a counter that
 * restarts on every flush, and writes each record to `<identifier>.md` with no
 * collision check. A bucket whose ordinal range contains numbers no surviving
 * record uses is therefore direct evidence that an earlier write was
 * overwritten by a later one with the same identifier.
 *
 * Only the provable fact is reported: how many ordinal values inside the
 * observed range are unused. A bucket whose ordinals simply start above one is
 * *not* reported, because that is also consistent with a counter that carried
 * across a boundary and proves no loss on its own.
 */
function detectOrdinalGaps(
  sequenceByBucket: Map<string, number[]>,
  anomalies: AnomalyCollector,
): void {
  for (const [bucket, ordinals] of sequenceByBucket) {
    const unique = [...new Set(ordinals)].sort((left, right) => left - right);
    const duplicates = ordinals.length - unique.length;
    if (duplicates > 0) {
      anomalies.add(
        "possible_overwrite",
        "signal identifier ordinals repeat within one date bucket, so the later write replaced the earlier file",
        {
          artifactKind: "signal_index",
          declaredValue: bucket,
          affectedCount: duplicates,
        },
      );
    }
    const lowest = unique[0];
    const highest = unique[unique.length - 1];
    if (lowest === undefined || highest === undefined) continue;
    const missing = highest - lowest + 1 - unique.length;
    if (missing > 0) {
      anomalies.add(
        "possible_overwrite",
        "signal identifier ordinals leave unused values inside the observed range; an earlier flush wrote over an existing file",
        {
          artifactKind: "signal_index",
          declaredValue: bucket,
          affectedCount: missing,
        },
      );
    }
  }
}

function collectPatterns(
  scanned: readonly ScannedFile[],
  anomalies: AnomalyCollector,
  excludedKeys: ReadonlySet<string>,
): LegacyPatternRecord[] {
  const byId = new Map<string, LegacyPatternRecord>();

  for (const file of scanned) {
    if (file.entry.artifactKind !== "pattern_body") continue;
    if (excludedKeys.has(file.key)) continue;
    const result = parseFrontmatter(file.text);
    if (result.parsed === undefined) {
      file.entry.parseStatus = "failed";
      markFailure(file, "parse_error");
      anomalies.add(
        "parse_error",
        result.failure?.detail ?? "unparsable pattern body",
        {
          relativePath: file.entry.relativePath,
          artifactKind: "pattern_body",
          ...(result.failure === undefined
            ? {}
            : { declaredValue: result.failure.reason }),
        },
      );
      continue;
    }
    const fields = result.parsed.fields;
    const patternId =
      fields["id"] ??
      (file.entry.relativePath.split("/").pop() ?? "").replace(/\.md$/, "");
    if (patternId.length === 0) continue;

    const createdAt = canonicalizeDeclaredTimestamp(fields["createdAt"]);
    const lastSeen = canonicalizeDeclaredTimestamp(fields["lastSeen"]);
    if (createdAt === undefined || lastSeen === undefined) {
      markFailure(file, "unrecoverable_field");
      anomalies.add(
        "unrecoverable_field",
        "pattern body declares no usable createdAt/lastSeen instant and was excluded from import",
        {
          relativePath: file.entry.relativePath,
          artifactKind: "pattern_body",
          declaredValue: patternId,
        },
      );
      continue;
    }

    const existing = byId.get(patternId);
    if (existing !== undefined) {
      existing.collisionCount += 1;
      existing.sourcePaths.push(file.entry.relativePath);
      continue;
    }
    byId.set(patternId, {
      patternId,
      trigger: fields["trigger"] ?? "",
      action: fields["action"] ?? "",
      confidence: Math.min(
        1,
        Math.max(0, asFiniteNumber(Number(fields["confidence"]), 0)),
      ),
      frequency: Math.max(0, asInteger(Number(fields["frequency"]), 0)),
      createdAt: createdAt.value,
      lastSeen: lastSeen.value,
      sourcePaths: [file.entry.relativePath],
      collisionCount: 1,
    });
  }

  return [...byId.values()].sort((left, right) =>
    comparePaths(left.patternId, right.patternId),
  );
}

function collectGraphEdges(
  scanned: readonly ScannedFile[],
  anomalies: AnomalyCollector,
  excludedKeys: ReadonlySet<string>,
): LegacyGraphEdge[] {
  const graphFile = findFile(scanned, ".graph_state.json");
  if (graphFile === undefined) return [];
  if (excludedKeys.has(graphFile.key)) return [];
  const parsed = parseJsonDocument(graphFile.text, graphFile.hadBom);
  if (parsed.failure !== undefined) {
    graphFile.entry.parseStatus = "failed";
    markFailure(graphFile, "parse_error");
    anomalies.add("parse_error", parsed.failure.detail, {
      relativePath: graphFile.entry.relativePath,
      artifactKind: "graph_state",
      declaredValue: parsed.failure.reason,
    });
    return [];
  }

  const graph = asRecord(parsed.value);
  // One build time is declared for the whole association set. It is carried on
  // each edge so an imported association is not stamped with the import clock.
  const declaredBuiltAt = canonicalizeDeclaredTimestamp(graph?.["lastBuilt"]);
  const edges: LegacyGraphEdge[] = [];
  const strengths = new Set<number>();
  const groupingKeys = new Set<string>();

  for (const raw of asArray(graph?.["associations"])) {
    const association = asRecord(raw);
    if (association === undefined) continue;
    const from = asString(association["from"]);
    const to = asString(association["to"]);
    if (from.length === 0 || to.length === 0) continue;
    groupingKeys.add(from);
    groupingKeys.add(to);
    const strength = asFiniteNumber(association["strength"], 0);
    strengths.add(strength);
    edges.push({
      from,
      to,
      strength,
      frequency: Math.max(0, asInteger(association["frequency"], 0)),
      relationClass: "value_pair",
      ...(declaredBuiltAt === undefined
        ? {}
        : { declaredBuiltAt: declaredBuiltAt.value }),
    });
  }

  const pairCounts = new Map<string, number>();
  for (const edge of edges) {
    const pair = `${edge.from}\u0000${edge.to}`;
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }
  const duplicatePairs = [...pairCounts.entries()].filter(
    ([, count]) => count > 1,
  );
  if (duplicatePairs.length > 0) {
    // An association pair is the edge's event identity, so the source emitting
    // the same pair twice with different strengths cannot become two records.
    // The condition is reported here, before anything is written, rather than
    // surfacing later as a generic identity conflict.
    anomalies.add(
      "parse_error",
      "the association set declares the same from/to pair more than once with differing quantities; the pair is one event identity and only its first reading is imported",
      {
        artifactKind: "graph_state",
        affectedCount: duplicatePairs.length,
        declaredValue: `${duplicatePairs.length} repeated pair(s)`,
      },
    );
  }

  if (edges.length > 0) {
    const groupCount = groupingKeys.size;
    const pairwise = (groupCount * (groupCount - 1)) / 2;
    if (pairwise > 0 && edges.length === pairwise && strengths.size <= 1) {
      anomalies.add(
        "cartesian_relation",
        "association set is the complete pairwise product of its grouping keys with a single uniform strength, so it is a category-level projection rather than an observed co-occurrence count",
        {
          artifactKind: "graph_state",
          affectedCount: edges.length,
          declaredValue: `${edges.length}=${groupCount}*(${groupCount}-1)/2`,
        },
      );
    }
    const categoryPairs = new Set(
      edges.map(
        (edge) => `${edge.from.split(":")[0]}>${edge.to.split(":")[0]}`,
      ),
    );
    if (categoryPairs.size < edges.length) {
      anomalies.add(
        "cartesian_relation",
        "the first-generation visualiser collapses value-level associations to category pairs, so distinct value relations share one displayed category relation",
        {
          artifactKind: "graph_state",
          affectedCount: edges.length - categoryPairs.size,
          declaredValue: `${categoryPairs.size} distinct category pairs`,
        },
      );
    }
    detectPatternCollision(edges, scanned, anomalies);
  }

  return edges;
}

/**
 * The first-generation pattern identifier uses only the category segment of the
 * association key, so every distinct value pair inside one category pair maps
 * to the same file name. The collision count is the number of pattern
 * instances that the mapping destroyed.
 */
function detectPatternCollision(
  edges: readonly LegacyGraphEdge[],
  scanned: readonly ScannedFile[],
  anomalies: AnomalyCollector,
): void {
  const simulated = new Set<string>();
  let collisions = 0;
  for (const edge of edges) {
    const id = `pat_${edge.from.split(":")[0]}_${edge.to.split(":")[0]}`;
    if (simulated.has(id)) collisions += 1;
    simulated.add(id);
  }
  if (collisions === 0) return;

  const observedIds = new Set(
    scanned
      .filter((file) => file.entry.artifactKind === "pattern_body")
      .map((file) =>
        (file.entry.relativePath.split("/").pop() ?? "").replace(/\.md$/, ""),
      ),
  );
  const survivors = [...simulated].filter((id) => observedIds.has(id)).length;
  anomalies.add(
    "ambiguous_pattern",
    "pattern identifiers derived from category pairs collide; only the last writer for each identifier survives on disk",
    {
      artifactKind: "pattern_body",
      affectedCount: collisions,
      declaredValue: `${simulated.size} distinct identifiers, ${survivors} present on disk`,
    },
  );
}

/**
 * The first-generation event log is newline-delimited JSON read without a
 * per-line guard, so one truncated line breaks every read of the whole file.
 * The scanner counts the damaged lines and reports them as material rather
 * than repairing the log.
 */
function collectEventLog(
  scanned: readonly ScannedFile[],
  anomalies: AnomalyCollector,
): void {
  const logFile = findFile(scanned, ".events/event.log");
  if (logFile === undefined) return;
  const result = parseNdjson(logFile.text);
  if (result.malformedLineCount > 0) {
    markFailure(logFile, "parse_error");
    anomalies.add(
      "parse_error",
      "event log contains lines that are not valid JSON; the first-generation reader fails the whole read on the first damaged line",
      {
        relativePath: logFile.entry.relativePath,
        artifactKind: "event_log",
        affectedCount: result.malformedLineCount,
        declaredValue: result.malformedLineIndexes.slice(0, 5).join(","),
      },
    );
  }
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const record of result.records) {
    const id = asString(asRecord(record)?.["id"]);
    if (id.length === 0) continue;
    if (seenIds.has(id)) duplicateIds.add(id);
    seenIds.add(id);
  }
  if (duplicateIds.size > 0) {
    anomalies.add(
      "possible_overwrite",
      "event identifiers derive from a millisecond clock and repeat, so the per-event mirror file was overwritten",
      {
        relativePath: logFile.entry.relativePath,
        artifactKind: "event_log",
        affectedCount: duplicateIds.size,
        declaredValue: [...duplicateIds]
          .sort(comparePaths)
          .slice(0, 5)
          .join(","),
      },
    );
  }
}

/**
 * Artifact families the scanner classifies and hashes but does not import.
 *
 * The field map names these paths, so they are not `unmapped_path`; but no
 * collector reads them either. Reporting only a count in
 * `countsByArtifactKind` leaves an operator unable to tell "read and imported"
 * from "read and set aside", so each such family is disclosed as an anomaly.
 */
const classifiedNotImported: readonly LegacyArtifactKind[] = [
  "signal_buffer",
  "event_record",
  "subscription_index",
  "profile_document",
];

function collectUnsupportedFamilies(
  scanned: readonly ScannedFile[],
  anomalies: AnomalyCollector,
): void {
  for (const kind of classifiedNotImported) {
    const count = scanned.filter(
      (file) => file.entry.artifactKind === kind,
    ).length;
    if (count === 0) continue;
    anomalies.add(
      "unmapped_path",
      `artifact family is classified but not imported by this importer; the files were read and hashed and no record was taken from them`,
      { artifactKind: kind, affectedCount: count, declaredValue: kind },
    );
  }
}

function collectVersionDeclarations(
  scanned: readonly ScannedFile[],
  anomalies: AnomalyCollector,
): void {
  const declarations: Array<{ source: string; declared: string }> = [];
  for (const file of scanned) {
    if (file.entry.artifactKind !== "source_manifest") continue;
    const record = asRecord(parseJsonDocument(file.text, file.hadBom).value);
    const version = record?.["version"];
    if (typeof version === "string" && version.length > 0) {
      // The root-relative path is recorded rather than the absolute one, so a
      // report stays portable and does not carry the operator's directory
      // layout into an event payload.
      declarations.push({ source: file.key, declared: version });
    }
  }
  const distinct = new Set(declarations.map((item) => item.declared));
  if (distinct.size <= 1) return;
  anomalies.add(
    "source_metadata_conflict",
    "first-generation source manifests declare different versions of the same component",
    {
      artifactKind: "source_manifest",
      affectedCount: declarations.length,
      declaredValue: declarations
        .map((item) => `${item.source}=${item.declared}`)
        .sort(comparePaths)
        .join("; "),
    },
  );
}

export interface LegacyPlanInput {
  roots: readonly string[];
  fileSystem: LegacyFileSystem;
  privacyRules?: readonly LegacyPrivacyRule[];
  now?: () => Date;
}

/**
 * Build the dry-run plan. The plan hash is the confirmation token: committing
 * an import requires presenting the hash of the plan that was actually
 * reviewed, so a changed corpus or a changed rule set invalidates it.
 */
export function buildLegacyMigrationPlan(
  input: LegacyPlanInput,
): LegacyMigrationPlan {
  const now = input.now ?? (() => new Date());
  const scan = scanLegacySources(input.roots, input.fileSystem, {
    ...(input.privacyRules === undefined
      ? {}
      : { privacyRules: input.privacyRules }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  // The scanner withholds excluded material from every family it extracts, so
  // the plan takes the scan's output directly rather than re-applying the
  // rule set and risking a second, different interpretation of it.
  const signals = scan.signals;

  const counts: LegacyMigrationCounts = {
    scannedFiles: scan.inventory.fileCount,
    signals: signals.length,
    patterns: scan.patterns.length,
    graphEdges: scan.graphEdges.length,
    anomalies: scan.inventory.anomalies.reduce(
      (total, anomaly) => total + anomaly.affectedCount,
      0,
    ),
    exclusions: scan.exclusions.length,
  };

  const planHash = sha256Hex(
    stableStringify({
      sourceFingerprint: scan.inventory.fingerprint,
      root: scan.inventory.root,
      counts,
      signals,
      patterns: scan.patterns,
      graphEdges: scan.graphEdges,
      anomalies: scan.inventory.anomalies,
      exclusions: scan.exclusions,
    } as never),
  );

  return {
    planHash,
    sourceFingerprint: scan.inventory.fingerprint,
    root: scan.inventory.root,
    createdAt: now().toISOString(),
    inventory: scan.inventory,
    signals,
    patterns: scan.patterns,
    graphEdges: scan.graphEdges,
    exclusions: scan.exclusions,
    counts,
  };
}
