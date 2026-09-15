#!/usr/bin/env node
/**
 * Generate the byte-exact synthetic Legacy fixture.
 *
 * The fixture is *synthetic*: no first-generation record value is copied into
 * it. What it reproduces is the *structure* — the file layout, the frontmatter
 * and JSON shapes, the identifier formats, and above all the anomaly classes —
 * of the corpus documented in `docs/migration/LEGACY-FIELD-MAP.md`.
 *
 * It is generated rather than hand-written because several anomaly classes are
 * encoding facts: a UTF-8 byte-order mark, a CRLF frontmatter anchor, a
 * truncated NDJSON line. Those bytes must survive Git, which is why
 * `.gitattributes` marks `fixtures/legacy/**` as `-text`.
 *
 * Usage: node scripts/generate-legacy-fixture.mjs
 */

import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "fixtures", "legacy");
const BOM = "﻿";
const LF = "\n";
const CRLF = "\r\n";

function write(relativePath, content, { bom = false, crlf = false } = {}) {
  const target = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  const body = crlf ? content.split(LF).join(CRLF) : content;
  writeFileSync(target, `${bom ? BOM : ""}${body}`);
}

rmSync(root, { recursive: true, force: true });

// --- Source-distribution root -------------------------------------------------
// Two manifests declare different versions of the same component, and both
// carry a byte-order mark, which is what the first-generation PowerShell
// installer wrote.

write(
  "source/hub-manifest.json",
  `${JSON.stringify({ name: "fixture-hub", version: "0.3.0", interfaces: {} }, null, 2)}${LF}`,
  { bom: true },
);
write(
  "source/.codex-plugin/plugin.json",
  `${JSON.stringify({ name: "fixture-plugin", version: "0.1.0" }, null, 2)}${LF}`,
  { bom: true },
);

// --- Data root -----------------------------------------------------------------

// Signal ordinals leave 3 and 4 unused inside the observed range 1..6, which is
// the evidence that an earlier flush was overwritten. The second bucket is
// contiguous and must not be reported.
const signals = [
  ["sig_20260601_001", "preference", "alpha", "one"],
  ["sig_20260601_002", "preference", "beta", "two"],
  ["sig_20260601_005", "rejection", "gamma", "three"],
  ["sig_20260601_006", "workflow", "delta", "four"],
  ["sig_20260602_001", "self_reflection", "epsilon", "five"],
].map(([id, type, category, value], index) => ({
  id,
  type,
  category,
  value,
  timestamp: new Date(
    Date.UTC(2026, 5, 1 + (index < 4 ? 0 : 1), 9, index, 0),
  ).toISOString(),
  confidence: 0.5,
  source: "fixture-skill",
}));

write(
  "data/.signals_index.json",
  `${JSON.stringify({ signals, patterns: [] }, null, 2)}${LF}`,
);
write("data/.signal_buffer.json", `${JSON.stringify({ signals: [] })}${LF}`);

// Signal bodies are CRLF-delimited. Every first-generation reader anchors its
// frontmatter match on LF, so these bodies are unreadable to the tool that
// wrote them; the importer reports that rather than silently normalising it.
for (const signal of signals.slice(0, 3)) {
  write(
    `data/signals/2026-06/${signal.id}.md`,
    [
      "---",
      `category: ${signal.category}`,
      "confidence: 0.5",
      `id: ${signal.id}`,
      `timestamp: ${signal.timestamp}`,
      `type: ${signal.type}`,
      `value: ${signal.value}`,
      "---",
      "",
      "Evidence: (auto)",
    ].join(LF) + LF,
    { crlf: true },
  );
}

// Three pattern files share the three identifiers the category-pair mapping
// produces, while six value-level associations exist. Three pattern instances
// were therefore destroyed by the identifier collision.
const patternBodies = [
  ["pat_alpha_beta", "alpha", "beta"],
  ["pat_alpha_alpha", "alpha", "alpha"],
  ["pat_beta_beta", "beta", "beta"],
];
for (const [id, from, to] of patternBodies) {
  write(
    `data/patterns/active/${id}.md`,
    [
      "---",
      `id: ${id}`,
      `trigger: ${from} trigger`,
      `action: ${to} action`,
      "confidence: 0.4",
      "frequency: 4",
      "createdAt: 2026-06-01T00:00:00.000Z",
      "lastSeen: 2026-06-02T00:00:00.000Z",
      "---",
      "",
      `# Pattern: ${from} trigger`,
    ].join(LF) + LF,
  );
}

// The association set is the complete pairwise product of four grouping keys
// with a single uniform strength: a category-level projection, not a count of
// observed co-occurrences.
const keys = ["alpha:x", "alpha:y", "beta:p", "beta:q"];
const associations = [];
for (let i = 0; i < keys.length; i += 1) {
  for (let j = i + 1; j < keys.length; j += 1) {
    associations.push({
      from: keys[i],
      to: keys[j],
      strength: 0.4,
      frequency: 2,
    });
  }
}
write(
  "data/.graph_state.json",
  `${JSON.stringify(
    {
      associations,
      lastBuilt: "2026-06-02T00:00:00.000Z",
      patternCount: associations.length,
      adaptiveThreshold: {
        value: 0.1146,
        cv: 0.75,
        baseRate: 0.3,
        numCategories: 2,
      },
    },
    null,
    2,
  )}${LF}`,
);

// The event log carries a truncated line and two records that share a
// millisecond identifier, so the mirror file was overwritten.
const eventLog = [
  JSON.stringify({
    type: "order_of_worth_shift",
    source: "fixture-skill",
    data: { order: "alpha" },
    timestamp: "2026-06-01T00:00:00.000Z",
    id: "evt_1",
  }),
  JSON.stringify({
    type: "pattern_matured",
    source: "fixture-skill",
    data: { patternId: "pat_alpha_beta" },
    timestamp: "2026-06-01T00:00:01.000Z",
    id: "evt_1",
  }),
  '{"type":"user_preference_detected","source":"fixture-skill"',
];
write("data/.events/event.log", `${eventLog.join(LF)}${LF}`);
write(
  "data/.events/.subscriptions.json",
  `${JSON.stringify({ subscribers: [] })}${LF}`,
);
write(
  "data/.events/evt_1.json",
  `${JSON.stringify({ type: "pattern_matured", id: "evt_1" }, null, 2)}${LF}`,
);

// A profile document that parses, one that carries a byte-order mark, and one
// that has no frontmatter at all.
write(
  "data/profile/index.md",
  [
    "---",
    "id: profile_fixture",
    "created: 2026-06-01T00:00:00.000Z",
    "status: active",
    "session_count: 3",
    "---",
    "",
    "# Profile",
  ].join(LF) + LF,
);
write("data/profile/timeline.md", `# Timeline${LF}${LF}- entry${LF}`, {
  bom: true,
});
write(
  "data/profile/foresights.md",
  ["# Foresights", "", "## Alpha Order", "- **a** -> b (conf: 40%)", ""].join(
    LF,
  ),
);

// A path the field map does not describe. It must be reported, not guessed at.
write("data/notes/scratch.txt", `unmapped material${LF}`);

process.stdout.write(
  `${JSON.stringify({ generated: true, root, files: countFiles() })}\n`,
);

function countFiles() {
  const visit = (directory) => {
    let total = 0;
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      total += statSync(absolute).isDirectory() ? visit(absolute) : 1;
    }
    return total;
  };
  return visit(root);
}
