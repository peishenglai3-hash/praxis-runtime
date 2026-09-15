import { describe, expect, it } from "vitest";

import {
  buildLegacyMigrationPlan,
  classifyArtifact,
  decodeUtf8,
  NodeLegacyFileSystem,
  parseFrontmatter,
  parseJsonDocument,
  parseNdjson,
  scanLegacySources,
  type LegacySourceFile,
} from "../../packages/runtime/src/legacy/index.js";

/**
 * The scanner's contract is that it reports what the bytes say. These tests use
 * a virtual filesystem so every input is explicit, and a separate integration
 * test runs the same scanner over the byte-exact synthetic fixture.
 */

function file(
  relativePath: string,
  content: string | Uint8Array,
  options: { bom?: boolean; modifiedAtMs?: number } = {},
): LegacySourceFile {
  const body =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  const bytes =
    options.bom === true ? Uint8Array.from([0xef, 0xbb, 0xbf, ...body]) : body;
  return {
    relativePath,
    sizeBytes: bytes.byteLength,
    modifiedAtMs: options.modifiedAtMs ?? 1_780_000_000_000,
    bytes,
  };
}

function virtualFileSystem(filesByRoot: Record<string, LegacySourceFile[]>): {
  readSourceFiles(root: string): LegacySourceFile[];
} {
  return {
    readSourceFiles: (root: string) => filesByRoot[root] ?? [],
  };
}

const fixedNow = () => new Date("2026-09-15T12:00:00.000Z");

function fixtureRoot(): string {
  const url = new URL("../../fixtures/legacy", import.meta.url);
  const pathname = decodeURIComponent(url.pathname);
  return process.platform === "win32" && /^\/[A-Za-z]:/.test(pathname)
    ? pathname.slice(1)
    : pathname;
}

describe("legacy parse primitives", () => {
  it("decodes a byte-order mark without losing it", () => {
    const decoded = decodeUtf8(
      Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0x3a, 0x20, 0x62]),
    );
    expect(decoded.hadBom).toBe(true);
    expect(decoded.decodable).toBe(true);
    expect(decoded.text).toBe("a: b");
  });

  it("reproduces the first-generation LF frontmatter anchor", () => {
    const lf = parseFrontmatter("---\nid: x\n---\nbody\n");
    expect(lf.parsed?.fields).toEqual({ id: "x" });
    expect(lf.failure).toBeUndefined();

    const crlf = parseFrontmatter("---\r\nid: x\r\n---\r\nbody\r\n");
    expect(crlf.parsed).toBeUndefined();
    expect(crlf.failure?.reason).toBe("format_anchor_mismatch");

    const none = parseFrontmatter("no frontmatter here\n");
    expect(none.failure?.reason).toBe("no_frontmatter");
  });

  it("attributes a JSON failure to a byte-order mark when one is present", () => {
    const withBom = parseJsonDocument("{not json", true);
    expect(withBom.failure?.reason).toBe("encoding_marker");
    const withoutBom = parseJsonDocument("{not json", false);
    expect(withoutBom.failure?.reason).toBe("parse_error");
  });

  it("isolates a malformed NDJSON line instead of failing the read", () => {
    const result = parseNdjson('{"a":1}\nbroken\n{"b":2}\n');
    expect(result.records).toEqual([{ a: 1 }, { b: 2 }]);
    expect(result.malformedLineCount).toBe(1);
    expect(result.malformedLineIndexes).toEqual([1]);
  });
});

describe("legacy artifact classification", () => {
  it("names the documented first-generation paths and nothing else", () => {
    expect(classifyArtifact(".signals_index.json")).toBe("signal_index");
    expect(classifyArtifact(".graph_state.json")).toBe("graph_state");
    expect(classifyArtifact(".events/event.log")).toBe("event_log");
    expect(classifyArtifact("signals/2026-06/sig_20260601_001.md")).toBe(
      "signal_body",
    );
    expect(classifyArtifact("patterns/active/pat_a_b.md")).toBe("pattern_body");
    expect(classifyArtifact("profile/index.md")).toBe("profile_document");
    expect(classifyArtifact("hub-manifest.json")).toBe("source_manifest");
    expect(classifyArtifact("scripts/whatever.mjs")).toBe("unmapped_path");
  });
});

describe("legacy scanner anomaly detection", () => {
  it("reports unused identifier ordinals as possible overwrite", () => {
    const index = JSON.stringify({
      signals: [
        {
          id: "sig_20260601_001",
          type: "preference",
          category: "a",
          value: "v",
          timestamp: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "sig_20260601_004",
          type: "preference",
          category: "b",
          value: "v",
          timestamp: "2026-06-01T00:00:01.000Z",
        },
      ],
      patterns: [],
    });
    const result = scanLegacySources(
      ["/legacy"],
      virtualFileSystem({
        "/legacy": [file(".signals_index.json", index)],
      }),
      { now: fixedNow },
    );
    const anomaly = result.inventory.anomalies.find(
      (item) => item.class === "possible_overwrite",
    );
    // Ordinals 1 and 4 occupy the range 1..4, so 2 values are unused.
    expect(anomaly?.affectedCount).toBe(2);
    expect(anomaly?.declaredValue).toBe("sig_20260601");
  });

  it("does not report a bucket whose ordinals simply start above one", () => {
    const index = JSON.stringify({
      signals: [
        {
          id: "sig_20260614_031",
          type: "preference",
          category: "a",
          value: "v",
          timestamp: "2026-06-14T00:00:00.000Z",
        },
        {
          id: "sig_20260614_032",
          type: "preference",
          category: "b",
          value: "v",
          timestamp: "2026-06-14T00:00:01.000Z",
        },
      ],
      patterns: [],
    });
    const result = scanLegacySources(
      ["/legacy"],
      virtualFileSystem({
        "/legacy": [file(".signals_index.json", index)],
      }),
      { now: fixedNow },
    );
    expect(
      result.inventory.anomalies.some(
        (item) => item.class === "possible_overwrite",
      ),
    ).toBe(false);
  });

  it("counts destroyed pattern instances from the category-pair mapping", () => {
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
    const result = scanLegacySources(
      ["/legacy"],
      virtualFileSystem({
        "/legacy": [
          file(".graph_state.json", JSON.stringify({ associations })),
          file(
            "patterns/active/pat_alpha_beta.md",
            "---\nid: pat_alpha_beta\ntrigger: t\naction: a\nconfidence: 0.4\nfrequency: 4\ncreatedAt: 2026-06-01T00:00:00.000Z\nlastSeen: 2026-06-02T00:00:00.000Z\n---\n",
          ),
        ],
      }),
      { now: fixedNow },
    );
    const collision = result.inventory.anomalies.find(
      (item) => item.class === "ambiguous_pattern",
    );
    // Six value-level associations collapse onto three category-pair names,
    // so three instances have no surviving file of their own.
    expect(collision?.affectedCount).toBe(3);
    expect(result.patterns).toHaveLength(1);
  });

  it("flags a complete pairwise association set as a cartesian relation", () => {
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
    const result = scanLegacySources(
      ["/legacy"],
      virtualFileSystem({
        "/legacy": [
          file(".graph_state.json", JSON.stringify({ associations })),
        ],
      }),
      { now: fixedNow },
    );
    const cartesian = result.inventory.anomalies.find(
      (item) =>
        item.class === "cartesian_relation" &&
        item.affectedCount === associations.length,
    );
    expect(cartesian?.declaredValue).toBe("6=4*(4-1)/2");
  });

  it("reports a field the writer declared but never persisted", () => {
    const index = JSON.stringify({
      signals: [
        {
          id: "sig_20260601_001",
          type: "preference",
          category: "a",
          value: "v",
          timestamp: "2026-06-01T00:00:00.000Z",
          confidence: 0.5,
          source: "s",
        },
      ],
      patterns: [],
    });
    const result = scanLegacySources(
      ["/legacy"],
      virtualFileSystem({
        "/legacy": [
          file(".signals_index.json", index),
          file("signals/2026-06/sig_20260601_001.md", "---\nid: x\n---\n"),
        ],
      }),
      { now: fixedNow },
    );
    const unrecoverable = result.inventory.anomalies.filter(
      (item) => item.class === "unrecoverable_field",
    );
    const declared = unrecoverable.map((item) => item.declaredValue).join("|");
    expect(declared).toContain("order_of_worth");
    expect(declared).toContain("test_survival_rate");
    expect(declared).toContain("context");
    expect(declared).toContain("evidence");
    // The absent fields are listed on the record too, so a reader never has to
    // infer them from a null default.
    expect(result.signals[0]?.absentFields).toContain("order_of_worth");
  });

  it("reports conflicting manifest versions without electing a winner", () => {
    const result = scanLegacySources(
      ["/source"],
      virtualFileSystem({
        "/source": [
          file("hub-manifest.json", JSON.stringify({ version: "0.3.0" }), {
            bom: true,
          }),
          file(
            ".codex-plugin/plugin.json",
            JSON.stringify({ version: "0.1.0" }),
          ),
        ],
      }),
      { now: fixedNow },
    );
    const conflict = result.inventory.anomalies.find(
      (item) => item.class === "source_metadata_conflict",
    );
    expect(conflict?.declaredValue).toContain("hub-manifest.json=0.3.0");
    expect(conflict?.declaredValue).toContain("plugin.json=0.1.0");
  });

  it("excludes a path matched by a privacy rule and counts it", () => {
    const result = scanLegacySources(
      ["/legacy"],
      virtualFileSystem({
        "/legacy": [
          file(
            ".signals_index.json",
            JSON.stringify({
              signals: [
                {
                  id: "sig_20260601_001",
                  type: "preference",
                  category: "a",
                  value: "v",
                  timestamp: "2026-06-01T00:00:00.000Z",
                },
              ],
              patterns: [],
            }),
          ),
          file("profile/index.md", "---\nid: p\n---\n"),
        ],
      }),
      {
        now: fixedNow,
        privacyRules: [
          {
            ruleId: "profile-free-text",
            pathPrefix: "/legacy/profile",
            reason: "free-text profile material is excluded by default",
          },
        ],
      },
    );
    expect(result.exclusions).toHaveLength(1);
    expect(result.exclusions[0]?.ruleId).toBe("profile-free-text");
    expect(
      result.inventory.anomalies.some(
        (item) => item.class === "privacy_sensitive",
      ),
    ).toBe(true);
  });

  it("excludes a record with no usable instant instead of guessing one", () => {
    const index = JSON.stringify({
      signals: [
        {
          id: "sig_20260601_001",
          type: "preference",
          category: "a",
          value: "v",
          timestamp: "not-a-date",
        },
        {
          id: "sig_20260601_002",
          type: "preference",
          category: "b",
          value: "v",
          timestamp: "2026-06-01T00:00:00.000Z",
        },
      ],
      patterns: [],
    });
    const result = scanLegacySources(
      ["/legacy"],
      virtualFileSystem({ "/legacy": [file(".signals_index.json", index)] }),
      { now: fixedNow },
    );
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.recordId).toBe("sig_20260601_002");
    expect(
      result.inventory.anomalies.some(
        (item) =>
          item.class === "parse_error" &&
          item.declaredValue === "excluded-entries",
      ),
    ).toBe(true);
  });
});

describe("legacy migration plan", () => {
  it("is deterministic for one corpus and changes with the corpus", () => {
    const files = {
      "/legacy": [
        file(
          ".signals_index.json",
          JSON.stringify({
            signals: [
              {
                id: "sig_20260601_001",
                type: "preference",
                category: "a",
                value: "v",
                timestamp: "2026-06-01T00:00:00.000Z",
              },
            ],
            patterns: [],
          }),
        ),
      ],
    };
    const first = buildLegacyMigrationPlan({
      roots: ["/legacy"],
      fileSystem: virtualFileSystem(files),
      now: fixedNow,
    });
    const second = buildLegacyMigrationPlan({
      roots: ["/legacy"],
      fileSystem: virtualFileSystem(files),
      now: () => new Date("2026-09-16T00:00:00.000Z"),
    });
    // The plan hash covers the corpus and the derived material, not the clock.
    expect(second.planHash).toBe(first.planHash);

    const changed = buildLegacyMigrationPlan({
      roots: ["/legacy"],
      fileSystem: virtualFileSystem({
        "/legacy": [...files["/legacy"], file("notes/extra.txt", "extra")],
      }),
      now: fixedNow,
    });
    expect(changed.planHash).not.toBe(first.planHash);
  });
});

describe("node legacy filesystem adapter", () => {
  it("walks the generated fixture without leaving the root", () => {
    const adapter = new NodeLegacyFileSystem();
    const files = adapter.readSourceFiles(fixtureRoot());
    expect(files.length).toBeGreaterThan(10);
    for (const entry of files) {
      expect(entry.relativePath.startsWith("/")).toBe(false);
      expect(entry.relativePath).not.toContain("..");
      expect(entry.relativePath).not.toContain("\\");
    }
  });
});
