import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { LegacyFileSystem, LegacySourceFile } from "./scanner.js";

/**
 * Node filesystem adapter for the Legacy scanner.
 *
 * The adapter is deliberately narrow: it only ever reads, it never follows a
 * symbolic link, and it never walks outside the supplied root. A legacy corpus
 * is untrusted input, so the walk is bounded in depth and file size rather than
 * trusting the tree to be well behaved.
 */

export interface NodeLegacyFileSystemOptions {
  maxDepth?: number;
  maxFileBytes?: number;
}

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;

export class NodeLegacyFileSystem implements LegacyFileSystem {
  readonly #maxDepth: number;
  readonly #maxFileBytes: number;

  constructor(options: NodeLegacyFileSystemOptions = {}) {
    this.#maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  readSourceFiles(root: string): LegacySourceFile[] {
    const files: LegacySourceFile[] = [];
    this.#walk(root, root, 0, files);
    files.sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0,
    );
    return files;
  }

  #walk(
    root: string,
    directory: string,
    depth: number,
    files: LegacySourceFile[],
  ): void {
    if (depth > this.#maxDepth) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );

    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        this.#walk(root, absolute, depth + 1, files);
        continue;
      }
      if (!entry.isFile()) continue;

      let stats;
      try {
        stats = lstatSync(absolute);
      } catch {
        continue;
      }
      if (stats.size > this.#maxFileBytes) continue;

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(readFileSync(absolute));
      } catch {
        continue;
      }

      files.push({
        relativePath: relative(root, absolute).split(sep).join("/"),
        sizeBytes: stats.size,
        modifiedAtMs: Math.trunc(stats.mtimeMs),
        bytes,
      });
    }
  }
}
