import { posix, win32 } from "node:path";

import { describe, expect, it } from "vitest";

import { ancestorDirectories } from "../../apps/cli/src/paths.js";

/**
 * The archive rule refuses to write the owner's first-generation corpus into a
 * Git working tree. The walk answering "is any ancestor a working tree?" split
 * the resolved path on both separators and then dropped the leading segment on
 * every platform — correct only where that segment is a drive letter. On Linux
 * it skipped the first real directory, so a target under `/tmp/praxis-x/` was
 * never compared against `/tmp/praxis-x/` and the refusal silently did not
 * happen. Every test of that rule passed, because every run was on Windows.
 *
 * Both platforms are therefore asserted from whichever one is running, with
 * explicit `posix` and `win32` path implementations. The point is not that the
 * walk is pure but that the Linux behaviour is checked by a machine that may
 * never run Linux. See BP-061.
 */

describe("ancestorDirectories on POSIX", () => {
  it("starts at the first real directory, which is not a drive letter", () => {
    // The defect in one assertion: the old walk returned
    // ["/praxis-x", "/praxis-x/archive"] here, dropping "tmp" entirely.
    expect(ancestorDirectories("/tmp/praxis-x/archive", posix)).toEqual([
      "/tmp",
      "/tmp/praxis-x",
      "/tmp/praxis-x/archive",
    ]);
  });

  it("never returns the root, so a `.git` at `/` is not an enclosing tree", () => {
    expect(ancestorDirectories("/", posix)).toEqual([]);
    expect(ancestorDirectories("/tmp", posix)).toEqual(["/tmp"]);
  });

  it("normalises redundant separators and a trailing one", () => {
    expect(ancestorDirectories("/tmp//a/", posix)).toEqual(["/tmp", "/tmp/a"]);
  });

  it("keeps a single-segment absolute path reachable", () => {
    expect(ancestorDirectories("/srv", posix)).toEqual(["/srv"]);
  });
});

describe("ancestorDirectories on Windows", () => {
  it("starts below the drive root and keeps the drive on every entry", () => {
    expect(ancestorDirectories("C:\\Users\\a\\b", win32)).toEqual([
      "C:\\Users",
      "C:\\Users\\a",
      "C:\\Users\\a\\b",
    ]);
  });

  it("never returns the drive root itself", () => {
    expect(ancestorDirectories("C:\\", win32)).toEqual([]);
    expect(ancestorDirectories("C:\\Users", win32)).toEqual(["C:\\Users"]);
  });

  it("handles a UNC share, which the old drive test did not recognise", () => {
    // The old code treated this as POSIX, started at "\", and produced
    // ["\share", "\share\dir"] — a path that exists nowhere.
    expect(ancestorDirectories("\\\\server\\share\\dir", win32)).toEqual([
      "\\\\server\\share\\dir",
    ]);
  });

  it("normalises forward slashes, which Windows accepts as separators", () => {
    expect(ancestorDirectories("C:/Users/a", win32)).toEqual([
      "C:\\Users",
      "C:\\Users\\a",
    ]);
  });
});
