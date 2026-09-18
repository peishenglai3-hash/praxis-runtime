import { describe, expect, it } from "vitest";

import {
  compareVersions,
  extractNodeBounds,
  isVersionInNodeRange,
} from "../../scripts/node-version-range.mjs";

describe("canonical Node runtime range", () => {
  it("parses a major-only upper bound", () => {
    expect(extractNodeBounds(">=22.13.0 <23")).toEqual({
      minimum: "22.13.0",
      maximum: "23",
    });
  });

  it("rejects Node 24 when the canonical range ends before Node 23", () => {
    expect(isVersionInNodeRange("24.15.0", ">=22.13.0 <23")).toBe(false);
  });

  it("keeps the negative control meaningful by accepting the pinned runtime", () => {
    expect(isVersionInNodeRange("22.13.0", ">=22.13.0 <23")).toBe(true);
    expect(compareVersions("22.13.0", "23")).toBe(-1);
  });
});
