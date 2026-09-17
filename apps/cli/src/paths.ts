import { posix, win32, type PlatformPath } from "node:path";

/**
 * Path ancestry.
 *
 * The archive rule needs to know whether any directory above a target is a Git
 * working tree, and it has to give the same answer on every platform the gate
 * runs on. The first version of that walk split the resolved path on both
 * separators and then dropped the leading segment on *every* platform:
 *
 *     const rest = drive ? parts.slice(1) : parts.slice(1);
 *
 * Both branches being identical is the whole defect. Dropping the first
 * segment is correct only where that segment is a drive letter. On POSIX the
 * first segment is the first real directory, so a target under
 * `/tmp/praxis-x/` was compared against `/praxis-x/...` and never against
 * `/tmp/praxis-x/...`. The refusal therefore never fired on Linux — the rule
 * failed open, on the one platform that had never been run. See BP-061.
 *
 * Expressing the walk against an injectable `PlatformPath` is what makes the
 * defect closable rather than merely patched: the ancestor list for *both*
 * platforms is provable from either one, so a Windows-only development machine
 * can hold the Linux behaviour to account.
 */

const hostPath: PlatformPath = process.platform === "win32" ? win32 : posix;

/**
 * Every directory from just below the filesystem root down to and including
 * `target`, outermost first.
 *
 * The root itself is excluded. `/` and `C:\` are never returned, so a `.git`
 * sitting at the root of a volume is not mistaken for an enclosing working
 * tree — the walk starts at the first named directory, which is what the
 * Windows branch of the original always did.
 */
export function ancestorDirectories(
  target: string,
  path: PlatformPath = hostPath,
): string[] {
  const resolved = path.resolve(target);
  const { root } = path.parse(resolved);
  const directories: string[] = [];
  let current = root;
  for (const segment of path.relative(root, resolved).split(/[\\/]+/)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}
