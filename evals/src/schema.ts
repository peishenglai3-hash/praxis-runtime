/**
 * A JSON Schema validator that refuses to under-validate.
 *
 * ## Why not a library
 *
 * The obvious choice is `ajv`, and it is deliberately not used. Two reasons,
 * one of which is a defect and one of which is a supply-chain decision.
 *
 * The defect first. On 2026-09-17 the 6V-0 run wrote nine `RunManifest`
 * documents that were **all invalid** — an undeclared `runtime` key against a
 * schema with `additionalProperties: false` — while every test was green and
 * the JSON looked correct. Nothing in the run was checking. The fix adopted
 * after that was an ad-hoc conformance check inside the test file. That was
 * better than nothing and it is not a validator: it knew about four nested
 * groups by name and would have ignored anything it had not heard of.
 *
 * A validator that silently ignores a keyword is the same defect one level
 * down. `ajv` is careful here, but a general-purpose validator's contract is
 * "validate the parts of the schema I understand", and this project cannot
 * afford that contract: **a check that passes because it did not look is
 * exactly what VF-01 names.**
 *
 * So this validator implements a deliberately small subset of JSON Schema and
 * **throws on every keyword it does not implement**. An unimplemented keyword
 * is a hard error, not a skipped constraint. That makes the failure mode
 * "the harness refused to run" rather than "the harness said PASS".
 *
 * The supply-chain reason is secondary but real: this repository is MIT and
 * public, `npm audit` advisories are tracked in the gate report, and a
 * validator for one frozen schema does not justify a new transitive tree.
 *
 * ## What is implemented
 *
 * `type` (string and array-of-string), `const`, `enum`, `required`,
 * `additionalProperties` (boolean and schema), `properties`, `items`,
 * `minLength`, `minimum`, `maximum`, `pattern`, `$ref` (local `#/$defs/...`
 * only), and `$defs`. Anything else throws.
 */

export interface SchemaViolation {
  /** JSON Pointer-ish path, e.g. `/expectation/registered/0`. */
  readonly path: string;
  readonly message: string;
}

export class UnsupportedSchemaKeywordError extends Error {
  constructor(keyword: string, path: string) {
    super(
      `the schema uses "${keyword}" at ${path}, which this validator does not ` +
        `implement. Refusing to validate rather than silently ignoring a ` +
        `constraint: add support for it, or the schema is not being checked.`,
    );
    this.name = "UnsupportedSchemaKeywordError";
  }
}

const IMPLEMENTED = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "required",
  "additionalProperties",
  "properties",
  "items",
  "minLength",
  "minimum",
  "maximum",
  "pattern",
  "$ref",
  "$defs",
  "default",
  "format",
]);

/**
 * `format` is annotated but not asserted.
 *
 * This is stated rather than left implicit because the project has been bitten
 * by an annotation that read as an assertion: `RFC-0001` records the same
 * distinction for `date-time` in the event envelope — the structural schema
 * carries the annotation, and the runtime's Zod validator is what actually
 * checks the calendar. Here `format: "date-time"` is checked only for being a
 * string, and `assertIsoTimestamp` in `manifest.ts` is what checks the shape.
 */
const ANNOTATION_ONLY = new Set(["format", "default", "title", "description"]);

type JsonSchema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === "integer") {
    return actual === "number" && Number.isInteger(value as number);
  }
  if (expected === "number") return actual === "number";
  return actual === expected;
}

export class Validator {
  readonly #root: JsonSchema;
  readonly #defs: Record<string, JsonSchema>;

  constructor(schema: JsonSchema) {
    this.#root = schema;
    const defs = schema["$defs"];
    this.#defs = (defs ?? {}) as Record<string, JsonSchema>;
  }

  validate(document: unknown): SchemaViolation[] {
    const violations: SchemaViolation[] = [];
    this.#checkNode(document, this.#root, "", violations);
    return violations;
  }

  #resolve(ref: string): JsonSchema {
    if (!ref.startsWith("#/$defs/")) {
      throw new UnsupportedSchemaKeywordError(
        `$ref to "${ref}" (non-local)`,
        "",
      );
    }
    const name = ref.slice("#/$defs/".length);
    const target = this.#defs[name];
    if (target === undefined) {
      throw new Error(
        `$ref "${ref}" does not resolve: no $defs entry "${name}"`,
      );
    }
    return target;
  }

  #checkNode(
    value: unknown,
    schema: JsonSchema,
    path: string,
    violations: SchemaViolation[],
  ): void {
    for (const keyword of Object.keys(schema)) {
      if (!IMPLEMENTED.has(keyword)) {
        throw new UnsupportedSchemaKeywordError(
          keyword,
          path === "" ? "/" : path,
        );
      }
    }

    if (typeof schema["$ref"] === "string") {
      this.#checkNode(value, this.#resolve(schema["$ref"]), path, violations);
    }

    if (typeof schema["const"] !== "undefined" && value !== schema["const"]) {
      violations.push({
        path,
        message: `expected the constant ${JSON.stringify(schema["const"])}, got ${JSON.stringify(value)}`,
      });
      return;
    }

    if (Array.isArray(schema["enum"])) {
      const allowed = schema["enum"] as unknown[];
      if (!allowed.some((candidate) => candidate === value)) {
        violations.push({
          path,
          message: `expected one of ${JSON.stringify(allowed)}, got ${JSON.stringify(value)}`,
        });
        return;
      }
    }

    if (typeof schema["type"] !== "undefined") {
      const expected = schema["type"];
      const list = Array.isArray(expected)
        ? (expected as string[])
        : [expected as string];
      if (!list.some((candidate) => matchesType(value, candidate))) {
        violations.push({
          path,
          message: `expected type ${list.join("|")}, got ${typeOf(value)}`,
        });
        return;
      }
    }

    if (typeof value === "string") {
      if (
        typeof schema["minLength"] === "number" &&
        value.length < schema["minLength"]
      ) {
        violations.push({
          path,
          message: `shorter than minLength ${schema["minLength"]}`,
        });
      }
      if (typeof schema["pattern"] === "string") {
        // Anchored the way JSON Schema's `pattern` is: an unanchored search.
        if (!new RegExp(schema["pattern"] as string).test(value)) {
          violations.push({
            path,
            message: `does not match /${schema["pattern"]}/`,
          });
        }
      }
    }

    if (typeof value === "number") {
      if (typeof schema["minimum"] === "number" && value < schema["minimum"]) {
        violations.push({
          path,
          message: `below minimum ${schema["minimum"]}`,
        });
      }
      if (typeof schema["maximum"] === "number" && value > schema["maximum"]) {
        violations.push({
          path,
          message: `above maximum ${schema["maximum"]}`,
        });
      }
    }

    if (
      Array.isArray(value) &&
      typeof schema["items"] === "object" &&
      schema["items"] !== null
    ) {
      const itemSchema = schema["items"] as JsonSchema;
      value.forEach((item, index) => {
        this.#checkNode(item, itemSchema, `${path}/${index}`, violations);
      });
    }

    if (typeOf(value) === "object") {
      const object = value as Record<string, unknown>;
      const properties = (schema["properties"] ?? {}) as Record<
        string,
        JsonSchema
      >;

      if (Array.isArray(schema["required"])) {
        for (const key of schema["required"] as string[]) {
          if (!Object.hasOwn(object, key)) {
            violations.push({ path, message: `missing required key "${key}"` });
          }
        }
      }

      for (const [key, child] of Object.entries(object)) {
        const childSchema = properties[key];
        if (childSchema !== undefined) {
          this.#checkNode(child, childSchema, `${path}/${key}`, violations);
          continue;
        }
        const additional = schema["additionalProperties"];
        if (additional === false) {
          violations.push({
            path,
            message: `declares "${key}", which the schema does not`,
          });
        } else if (typeof additional === "object" && additional !== null) {
          this.#checkNode(
            child,
            additional as JsonSchema,
            `${path}/${key}`,
            violations,
          );
        }
      }
    }
  }
}

/** Convenience: returns violations, or throws if the schema itself is unsupported. */
export function validateAgainst(
  schema: JsonSchema,
  document: unknown,
): SchemaViolation[] {
  return new Validator(schema).validate(document);
}

export { ANNOTATION_ONLY };
