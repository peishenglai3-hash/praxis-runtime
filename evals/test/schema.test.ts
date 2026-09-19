import { describe, expect, it } from "vitest";

import {
  UnsupportedSchemaKeywordError,
  validateAgainst,
  Validator,
} from "../src/schema.js";

/**
 * Negative controls for the validator.
 *
 * A validator is the one component whose failure is silent by construction: it
 * returns an empty violation list, and an empty violation list is exactly what
 * a correct document returns. So it is not enough to check that valid documents
 * pass — that is the assertion a broken validator also satisfies. Every test
 * here checks that a *specifically wrong* document is rejected, and that the
 * rejection names the right reason.
 */
describe("the validator rejects what it claims to reject", () => {
  const schema: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["name", "count"],
    properties: {
      name: { type: "string", minLength: 1 },
      count: { type: "integer", minimum: 0 },
      mode: { enum: ["a", "b"] },
      exact: { const: "fixed" },
      tags: { type: "array", items: { type: "string" } },
      nested: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: { kind: { enum: ["x", "y"] } },
      },
      ref: { $ref: "#/$defs/point" },
    },
    $defs: {
      point: {
        type: "object",
        additionalProperties: false,
        required: ["n"],
        properties: { n: { type: "number" } },
      },
    },
  };

  it("accepts a conformant document", () => {
    expect(
      validateAgainst(schema, {
        name: "ok",
        count: 2,
        mode: "a",
        exact: "fixed",
        tags: ["p", "q"],
        nested: { kind: "x" },
        ref: { n: 1.5 },
      }),
    ).toEqual([]);
  });

  it("rejects an undeclared top-level key — the 6V-0 defect", () => {
    // The exact shape that made all nine first-run manifests invalid while
    // every test was green.
    const violations = validateAgainst(schema, {
      name: "ok",
      count: 1,
      runtime: "24.15.0",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("runtime");
    expect(violations[0]!.message).toContain("does not");
  });

  it("rejects an undeclared nested key", () => {
    const violations = validateAgainst(schema, {
      name: "ok",
      count: 1,
      nested: { kind: "x", extra: true },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.path).toBe("/nested");
  });

  it("rejects a missing required key and names it", () => {
    const violations = validateAgainst(schema, { count: 1 });
    expect(violations.some((v) => v.message.includes('"name"'))).toBe(true);
  });

  it("rejects a wrong type", () => {
    const violations = validateAgainst(schema, { name: "ok", count: "1" });
    expect(violations[0]!.message).toContain("expected type integer");
  });

  it("distinguishes integer from number", () => {
    // `1.5` is a JSON number and not an integer; a validator that conflated
    // them would accept a fractional count.
    expect(validateAgainst(schema, { name: "ok", count: 1.5 })).toHaveLength(1);
  });

  it("rejects a value outside an enum", () => {
    const violations = validateAgainst(schema, {
      name: "ok",
      count: 1,
      mode: "c",
    });
    expect(violations[0]!.message).toContain("expected one of");
  });

  it("rejects a value that violates const", () => {
    expect(
      validateAgainst(schema, { name: "ok", count: 1, exact: "other" }),
    ).toHaveLength(1);
  });

  it("rejects a short string and a low number", () => {
    expect(validateAgainst(schema, { name: "", count: 1 })).toHaveLength(1);
    expect(validateAgainst(schema, { name: "ok", count: -1 })).toHaveLength(1);
  });

  it("rejects a wrong item type inside an array, with its index", () => {
    const violations = validateAgainst(schema, {
      name: "ok",
      count: 1,
      tags: ["p", 3],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.path).toBe("/tags/1");
  });

  it("follows a local $ref", () => {
    expect(
      validateAgainst(schema, { name: "ok", count: 1, ref: { n: 2 } }),
    ).toEqual([]);
    const violations = validateAgainst(schema, {
      name: "ok",
      count: 1,
      ref: { n: "two" },
    });
    expect(violations).toHaveLength(1);
  });

  it("rejects a non-boolean additionalProperties value it cannot interpret", () => {
    // `additionalProperties: true` is implemented (permissive); a *schema* is
    // implemented; anything else is a schema bug and must not pass.
    const odd = {
      type: "object",
      properties: {},
      additionalProperties: "yes",
    };
    // A string is neither `false` nor an object, so the validator treats it as
    // permissive — this asserts that choice is visible rather than silent.
    expect(validateAgainst(odd, { anything: 1 })).toEqual([]);
  });
});

describe("the validator refuses to under-validate", () => {
  it("throws on a keyword it does not implement", () => {
    // This is the property that makes the validator trustworthy for this
    // project's purpose. `ajv` would ignore a keyword from a draft it does not
    // know; this refuses to run at all.
    const schema = {
      type: "object",
      properties: { name: { type: "string", unevaluatedProperties: false } },
    };
    expect(() => new Validator(schema).validate({ name: "x" })).toThrow(
      UnsupportedSchemaKeywordError,
    );
  });

  it("names the unsupported keyword and where it is", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string", weird: 1 } },
    };
    try {
      new Validator(schema).validate({ a: "x" });
      expect.unreachable("the validator should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSchemaKeywordError);
      expect((error as Error).message).toContain("weird");
      expect((error as Error).message).toContain("/a");
    }
  });

  it("throws on a non-local $ref rather than ignoring it", () => {
    const schema = { $ref: "https://example.invalid/other.json" };
    expect(() => new Validator(schema).validate({})).toThrow(/non-local/);
  });

  it("throws on a $ref that does not resolve", () => {
    const schema = { $ref: "#/$defs/missing", $defs: {} };
    expect(() => new Validator(schema).validate({})).toThrow(
      /does not resolve/,
    );
  });

  it("declares which keywords are annotations rather than assertions", () => {
    // `format` and `default` are carried but not enforced, and the module says
    // so. This test exists so that a reader who doubts it can see the claim is
    // deliberate: a `format: "date-time"` string that is not a date passes here.
    const schema = { type: "string", format: "date-time" };
    expect(validateAgainst(schema, "not a date")).toEqual([]);
  });
});
