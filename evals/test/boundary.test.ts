import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The evaluation boundary, as a checked property.
 *
 * The owner's brief §5 fixes the direction:
 *
 *     praxis-runtime  →  被测对象
 *     praxis-evals    →  外部观察者 / evaluator
 *
 *     原则: eval → runtime        禁止: runtime → eval
 *
 * An evaluator the subject can reach is an evaluator the subject can
 * influence. For a project whose entire Phase 6V question is "what does the
 * runtime do when it is not the one keeping score", a runtime that can import
 * the scorer would quietly invalidate every result in this package.
 *
 * ## Why a test and not only a linter
 *
 * `.dependency-cruiser.cjs` carries the same rule, and this test is not
 * redundant with it. The cruiser resolves the dependency graph through
 * TypeScript config and workspace links; if that configuration is ever wrong,
 * the cruiser reports "no violations" and the rule silently stops existing.
 * That is VF-01's exact shape — a check that passes because it did not look.
 *
 * This test reads the source text instead. It is cruder and it cannot fail
 * open: a relative import path is a literal string, and `../../evals/` in a
 * file under `packages/` is visible without resolving anything.
 *
 * Both run. Agreement between a structural tool and a textual one is worth
 * more than either alone.
 */

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
]);

function collectSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(path));
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    if (dot >= 0 && SOURCE_EXTENSIONS.has(entry.name.slice(dot)))
      found.push(path);
  }
  return found;
}

/** Any import or require whose specifier names the evaluation package. */
const EVAL_IMPORT =
  /(?:from|import|require)\s*\(?\s*["']([^"']*evals\/[^"']*|[^"']*@praxis\/evals[^"']*)["']/g;

describe("nothing in the runtime can reach the evaluator", () => {
  it("finds no import of `evals/` anywhere under packages/ or apps/", () => {
    const offenders: string[] = [];
    for (const root of ["packages", "apps"]) {
      const absolute = resolve(repositoryRoot, root);
      let files: string[];
      try {
        files = collectSourceFiles(absolute);
      } catch {
        continue;
      }
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(EVAL_IMPORT)) {
          offenders.push(
            `${relative(repositoryRoot, file)} imports "${match[1]}"`,
          );
        }
      }
    }
    expect(
      offenders,
      "the runtime must not import the evaluator; see ADR-0015",
    ).toEqual([]);
  });

  it("has a non-empty scan, so the assertion above is not vacuous", () => {
    // A test that passes because it scanned nothing is the defect it is meant
    // to catch.
    //
    // The first version of this assertion demanded more than 50 files, which
    // was a number invented on the spot and was wrong — the real count is 37.
    // §18 of the owner's brief forbids inventing thresholds ahead of a
    // baseline, and that applies to a harness's own self-checks as much as to
    // its metrics. So this names specific files that certainly exist instead:
    // if the scan read these, it read the tree.
    const scanned = collectSourceFiles(resolve(repositoryRoot, "packages")).map(
      (file) => relative(repositoryRoot, file).split("\\").join("/"),
    );
    expect(scanned.length).toBeGreaterThan(0);
    for (const required of [
      "packages/contracts/src/index.ts",
      "packages/runtime/src/index.ts",
      "packages/store/src/index.ts",
      "packages/adapters/src/index.ts",
    ]) {
      expect(scanned, `the scan did not reach ${required}`).toContain(required);
    }
  });

  it("confirms the scan can detect what it looks for", () => {
    // The negative control. If `EVAL_IMPORT` matched nothing by construction —
    // a typo in the pattern — the first assertion would pass for the wrong
    // reason on every file in the repository.
    const planted = [
      'import { x } from "../../evals/src/index.js";',
      'import { y } from "@praxis/evals";',
      'const z = require("../../evals/src/rate.js");',
      'const w = await import("../evals/src/run.js");',
    ];
    for (const line of planted) {
      expect(line.match(EVAL_IMPORT), `pattern missed: ${line}`).not.toBeNull();
    }
    // And it must not fire on the runtime's own imports.
    expect('import { x } from "./runner.js";'.match(EVAL_IMPORT)).toBeNull();
    expect(
      'import { x } from "../../packages/contracts/src/index.js";'.match(
        EVAL_IMPORT,
      ),
    ).toBeNull();
  });

  it("does not list @praxis/evals as a dependency of any workspace package", () => {
    // A package.json dependency would be the other half of the same mistake:
    // the import scan would still pass if the dependency were declared but
    // unused, and it would be there waiting.
    for (const root of ["packages", "apps"]) {
      for (const entry of readdirSync(resolve(repositoryRoot, root), {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        const manifest = join(repositoryRoot, root, entry.name, "package.json");
        let parsed: {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        try {
          parsed = JSON.parse(readFileSync(manifest, "utf8")) as typeof parsed;
        } catch {
          continue;
        }
        const declared = {
          ...(parsed.dependencies ?? {}),
          ...(parsed.devDependencies ?? {}),
        };
        expect(
          Object.keys(declared),
          `${root}/${entry.name} must not depend on the evaluator`,
        ).not.toContain("@praxis/evals");
      }
    }
  });

  it("keeps credential-bearing experiments out of the mandatory gate", () => {
    // Two properties are easy to confuse here, and only one of them is the
    // boundary.
    //
    //  - The runtime must never depend on the evaluator. That is the boundary,
    //    and the assertions above check it.
    //  - The gate may freely run the evaluator's *self-tests* — the rate, schema,
    //    oracle and boundary suites. They need no model, no network and no
    //    credential, and §3 of the owner's brief asks for exactly them: "Test
    //    the test. 验证装置本身必须成为被验证对象."
    //
    // What the gate must never do is run an *experiment*. A gate that needs a
    // credential is not a gate, and `PRAXIS_VALIDATION_PROVIDER_KEY` is exactly
    // the thing that must stay out of deterministic CI.
    const manifest = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const chain = manifest.scripts["verify:chain"] ?? "";
    expect(chain.length).toBeGreaterThan(0);

    // Nothing in the chain may name a credential-gated script.
    for (const forbidden of [
      "validate:6v0",
      "PRAXIS_VALIDATION_PROVIDER_KEY",
      "eval:run",
    ]) {
      expect(chain, `the gate must not run ${forbidden}`).not.toContain(
        forbidden,
      );
    }

    // And the scripts the gate *does* run must be resolvable and credential-free.
    for (const name of chain
      .split("&&")
      .map((part) => part.trim().replace(/^pnpm\s+/, ""))) {
      if (name.length === 0) continue;
      expect(
        manifest.scripts[name],
        `verify:chain names "${name}", which does not exist`,
      ).toBeDefined();
      expect(
        manifest.scripts[name],
        `"${name}" must not require a provider credential`,
      ).not.toContain("PRAXIS_VALIDATION_PROVIDER_KEY");
    }
  });
});
