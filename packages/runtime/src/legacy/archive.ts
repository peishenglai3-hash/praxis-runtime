import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { LegacyArchiveManifest } from "@praxis/contracts";
import { stableStringify } from "@praxis/contracts";

import { sha256Hex } from "./parse.js";

/**
 * Optional read-only archive of the material an import read.
 *
 * The Bible allows the importer to keep a hashed copy of the original files so
 * that a later reviewer can check the migration against what it actually read.
 * The archive is written outside the repository working tree, its entries are
 * made read-only, and the manifest records the digest of every copied file and
 * of the corpus as a whole.
 */

export interface LegacyArchiveInput {
  archiveRoot: string;
  sourceFingerprint: string;
  createdAt: string;
  entries: Array<{ relativePath: string; bytes: Uint8Array }>;
  /**
   * Digests the plan recorded for the corpus it was derived from, keyed by the
   * path as the field map names it. When supplied, every archived stream is
   * checked against it, so the archive is proven to hold the corpus the plan
   * describes rather than merely asserted to.
   */
  expectedDigests?: ReadonlyMap<string, string>;
}

export class LegacyArchiveError extends Error {
  readonly code = "LEGACY_ARCHIVE_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "LegacyArchiveError";
  }
}

/**
 * Derive a safe, stable label for each source root so that archived entries
 * from several roots cannot collide and no entry carries an absolute path.
 *
 * A label is the root's final path segment reduced to portable characters. If
 * two roots share a segment the later one is suffixed with its index, so the
 * mapping stays deterministic for a given root list.
 */
export function legacyRootLabels(roots: readonly string[]): string[] {
  const emitted = new Set<string>();
  const labels: string[] = [];
  for (const [index, root] of roots.entries()) {
    const normalized = root.replaceAll("\\", "/").replace(/\/+$/, "");
    const segment = normalized.split("/").filter(Boolean).pop() ?? "root";
    const sanitized = segment.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
    const base = sanitized.length === 0 ? "root" : sanitized;
    // Two roots with different basenames can still sanitise to the same label
    // ("data-2" and "data/2"), so uniqueness is checked against the labels
    // actually emitted rather than against the base names.
    let label = base;
    let suffix = index;
    while (emitted.has(label)) {
      label = `${base}-${suffix}`;
      suffix += 1;
    }
    emitted.add(label);
    labels.push(label);
  }
  return labels;
}

const UNPORTABLE_CHARACTERS = new Set(["<", ">", '"', "|", "?", "*"]);

/**
 * A segment is portable when it carries no control character and none of
 * the characters Windows reserves in a file name. The check is written
 * against code points rather than a regular-expression character class so
 * the rule stays readable and cannot be misread as a range.
 */
function hasUnportableCharacter(segment: string): boolean {
  for (const character of segment) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127) return true;
    if (UNPORTABLE_CHARACTERS.has(character)) return true;
  }
  return false;
}

/**
 * Reject any relative path that could escape the archive root. A legacy corpus
 * is untrusted input, so the archive never trusts a stored path to be safe.
 */
function assertContained(relativePath: string): string[] {
  const segments = relativePath
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new LegacyArchiveError("archive entry has an empty relative path");
  }
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new LegacyArchiveError(
        `archive entry escapes the archive root: ${relativePath}`,
      );
    }
    // A colon in a segment would be a drive or stream designator on Windows;
    // the writer never produces one, and accepting it would let a stored path
    // mean something other than a nested file.
    if (segment.includes(":")) {
      throw new LegacyArchiveError(
        `archive entry contains a path designator that some filesystems treat specially: ${relativePath}`,
      );
    }
    if (hasUnportableCharacter(segment)) {
      throw new LegacyArchiveError(
        `archive entry contains a character some filesystems reject: ${relativePath}`,
      );
    }
  }
  return segments;
}

export function writeLegacyArchive(
  input: LegacyArchiveInput,
): LegacyArchiveManifest {
  const archiveRoot = resolve(input.archiveRoot);
  const filesRoot = join(archiveRoot, "files");
  mkdirSync(filesRoot, { recursive: true });

  const entries: LegacyArchiveManifest["entries"] = [];
  for (const entry of [...input.entries].sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  )) {
    const destination = join(filesRoot, ...assertContained(entry.relativePath));
    if (!resolve(destination).startsWith(resolve(filesRoot))) {
      throw new LegacyArchiveError(
        `archive entry resolves outside the archive root: ${entry.relativePath}`,
      );
    }
    mkdirSync(dirname(destination), { recursive: true });
    const digest = sha256Hex(entry.bytes);
    const expected = input.expectedDigests?.get(entry.relativePath);
    if (expected !== undefined && expected !== digest) {
      throw new LegacyArchiveError(
        `archived bytes do not match the digest this plan recorded for ${entry.relativePath}`,
      );
    }
    if (existsSync(destination)) {
      // The archive is write-once by design, so its entries are made
      // read-only. A re-import of the same corpus therefore leaves the
      // existing copy alone when the content still matches, and refuses to
      // silently replace it when it does not.
      const existingDigest = sha256Hex(
        new Uint8Array(readFileSync(destination)),
      );
      if (existingDigest !== digest) {
        throw new LegacyArchiveError(
          `archive entry already exists with different content: ${entry.relativePath}`,
        );
      }
    } else {
      // A crash between write and rename must not leave a short file that the
      // next attempt refuses as "different content", so the bytes land in a
      // temporary name and are moved into place in one step.
      const staging = `${destination}.tmp-${sha256Hex(entry.relativePath).slice(0, 12)}`;
      writeFileSync(staging, entry.bytes);
      try {
        renameSync(staging, destination);
      } catch (error) {
        try {
          unlinkSync(staging);
        } catch {
          // The staging file is reported by the error below either way.
        }
        throw new LegacyArchiveError(
          `could not place archive entry ${entry.relativePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      try {
        chmodSync(destination, 0o444);
      } catch {
        // A filesystem that does not support the mode still keeps the copy;
        // the manifest digest, not the mode bit, is what makes the archive
        // auditable.
      }
    }
    entries.push({
      relativePath: entry.relativePath,
      sha256: digest,
      sizeBytes: entry.bytes.byteLength,
      archivedPath: destination,
    });
  }

  const manifest: LegacyArchiveManifest = {
    archiveRoot,
    createdAt: input.createdAt,
    sourceFingerprint: input.sourceFingerprint,
    entries,
  };
  const manifestPath = join(archiveRoot, "manifest.json");
  const stagedManifest = `${manifestPath}.tmp`;
  writeFileSync(
    stagedManifest,
    `${JSON.stringify(JSON.parse(stableStringify(manifest as never)) as unknown, null, 2)}\n`,
  );
  renameSync(stagedManifest, manifestPath);
  return manifest;
}
