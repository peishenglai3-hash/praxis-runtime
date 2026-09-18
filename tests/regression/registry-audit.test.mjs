import { describe, expect, it } from "vitest";

import { auditRegistries } from "../../scripts/audit-registries.mjs";

describe("control-plane registries", () => {
  it("have one machine-verifiable source row per current breakpoint and RFC label", () => {
    const result = auditRegistries();
    expect(result.issues).toEqual([]);
    expect(result.breakpoints.headings).toBe(result.breakpoints.rows);
    expect(result.breakpoints.headings).toBeGreaterThan(0);
    expect(result.rfc.labels).toBe(result.rfc.rows);
    expect(result.rfc.labels).toBeGreaterThan(0);
  });
});
