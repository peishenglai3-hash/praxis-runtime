import { describe, expect, it } from "vitest";

import { auditRegistries } from "../../scripts/audit-registries.mjs";

describe("control-plane registries", () => {
  it("have one machine-verifiable source row per current breakpoint and RFC label", () => {
    const result = auditRegistries();
    expect(result.issues).toEqual([]);
    expect(result.breakpoints.headings).toBe(67);
    expect(result.breakpoints.rows).toBe(67);
    expect(result.rfc.labels).toBe(24);
    expect(result.rfc.rows).toBe(24);
  });
});
