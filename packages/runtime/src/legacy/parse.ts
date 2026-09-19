import { createHash } from "node:crypto";

/**
 * Parsing primitives for first-generation material.
 *
 * Every parser here is intentionally literal. It reports exactly what the
 * bytes say and never repairs, normalises or infers a value. Where the source
 * is unreadable the result is an explicit failure carrying the reason, because
 * the migration's job is to preserve the break, not to close it.
 */

export const UTF8_BOM = "﻿";

export interface ParsedFrontmatter {
  fields: Record<string, string>;
  fieldOrder: string[];
  body: string;
}

export interface FrontmatterFailure {
  reason: "encoding_marker" | "format_anchor_mismatch" | "no_frontmatter";
  detail: string;
}

export interface FrontmatterResult {
  parsed?: ParsedFrontmatter;
  failure?: FrontmatterFailure;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  );
}

/**
 * Decode as UTF-8 without silently dropping a byte-order mark. The caller is
 * told whether a mark was present so that the mark can be reported as the
 * reason a downstream parser anchored at byte zero failed.
 */
export function decodeUtf8(bytes: Uint8Array): {
  text: string;
  hadBom: boolean;
  decodable: boolean;
} {
  const hadBom = hasUtf8Bom(bytes);
  const slice = hadBom ? bytes.subarray(3) : bytes;
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(slice),
      hadBom,
      decodable: true,
    };
  } catch {
    return {
      text: new TextDecoder("utf-8").decode(slice),
      hadBom,
      decodable: false,
    };
  }
}

/**
 * The first-generation readers anchor their frontmatter match on the two-byte
 * sequence `---` followed by a line feed:
 *
 *     text.match(/^---\n([\s\S]*?)\n--- /)
 *
 * A body written with CRLF separators therefore fails that anchor even though
 * it is a perfectly well-formed file. The parser reproduces the anchor
 * faithfully and reports the mismatch rather than papering over it, because
 * the mismatch is the finding.
 */
export function parseFrontmatter(text: string): FrontmatterResult {
  const lfMatch = /^---\n([\s\S]*?)\n---/.exec(text);
  if (lfMatch === null) {
    if (/^---\r\n/.test(text)) {
      return {
        failure: {
          reason: "format_anchor_mismatch",
          detail:
            "frontmatter block is CRLF-delimited; the first-generation anchor expects LF",
        },
      };
    }
    return {
      failure: {
        reason: "no_frontmatter",
        detail: "no leading frontmatter block",
      },
    };
  }

  const fields: Record<string, string> = {};
  const fieldOrder: string[] = [];
  const header = lfMatch[1] ?? "";
  for (const line of header.split("\n")) {
    const separator = line.indexOf(": ");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 2).trim();
    if (key.length === 0) continue;
    if (!(key in fields)) fieldOrder.push(key);
    fields[key] = value;
  }
  return {
    parsed: { fields, fieldOrder, body: text.slice(lfMatch[0].length) },
  };
}

export interface JsonParseResult {
  value?: unknown;
  failure?: { reason: "encoding_marker" | "parse_error"; detail: string };
}

/**
 * Parse a JSON document. A leading byte-order mark makes `JSON.parse` fail,
 * which the first-generation readers swallow into a silent `{}` fallback; here
 * it is reported as its own reason so that the loss is visible.
 */
export function parseJsonDocument(
  text: string,
  hadBom: boolean,
): JsonParseResult {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      failure: {
        reason: hadBom ? "encoding_marker" : "parse_error",
        detail: hadBom
          ? `document begins with a UTF-8 byte-order mark and does not parse: ${
              error instanceof Error ? error.message : String(error)
            }`
          : error instanceof Error
            ? error.message
            : String(error),
      },
    };
  }
}

export interface NdjsonParseResult {
  records: unknown[];
  malformedLineCount: number;
  malformedLineIndexes: number[];
}

/**
 * Parse newline-delimited JSON with per-line isolation. The first-generation
 * reader parses each line without a guard, so a single truncated line breaks
 * every read of the whole file; here a bad line is counted and skipped so the
 * surviving records can still be reported.
 */
export function parseNdjson(text: string): NdjsonParseResult {
  const records: unknown[] = [];
  const malformedLineIndexes: number[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line) as unknown);
    } catch {
      malformedLineIndexes.push(index);
    }
  }
  return {
    records,
    malformedLineCount: malformedLineIndexes.length,
    malformedLineIndexes,
  };
}

/**
 * A declaration must carry its own zone designator.
 *
 * Without one, `Date.parse` resolves the string against the *host* time zone,
 * so the same bytes would name a different instant on a different machine: the
 * instant would be invented by the reader rather than read from the
 * declaration. Such a declaration is refused and the caller records the
 * refusal, instead of converting it and claiming the instant was preserved.
 */
const ZONE_DESIGNATOR = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Canonicalise a declared timestamp without inventing an instant. A value that
 * names a valid instant in a non-canonical spelling is converted, which is a
 * faithful format conversion of the same instant; a value that does not name
 * an instant on its own is rejected so the caller can exclude the record
 * instead of guessing.
 */
export function canonicalizeDeclaredTimestamp(
  declared: unknown,
): { value: string; normalised: boolean } | undefined {
  if (typeof declared !== "string" || declared.length === 0) return undefined;
  if (!ZONE_DESIGNATOR.test(declared)) return undefined;
  const parsed = Date.parse(declared);
  if (!Number.isFinite(parsed)) return undefined;
  const canonical = new Date(parsed).toISOString();
  return { value: canonical, normalised: canonical !== declared };
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asInteger(value: unknown, fallback = 0): number {
  const number = asFiniteNumber(value, fallback);
  return Number.isInteger(number) ? number : Math.trunc(number);
}
