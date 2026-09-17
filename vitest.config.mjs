import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Every workspace package resolves to its **source** under test.
 *
 * This used to alias `@praxis/contracts` only, leaving the rest to resolve
 * through `package.json#exports` into `dist/`. Two builders write that one
 * directory — `tsup --dts` writes a bundled `dist/index.d.ts`, `tsc --build`
 * writes per-file declarations and, incrementally, does not rewrite the
 * bundle — so a test run could read the previous build and report a failure
 * ("the restore failed") or a pass for code that no longer exists. That is
 * recorded as `BP-049`.
 *
 * INC-001 section 10 freezes a verification order in which the test layers run
 * **before** `build` and the built artifacts are smoked **after** it. That
 * order is only sound if the test layers do not depend on asking correctly
 * just how stale `dist/` currently is, so the dual-writer hazard has to go
 * rather than be scheduled around. Tests now exercise sources; the artifact
 * smoke steps (`pnpm smoke:cli`, `pnpm smoke:daemon`) run real processes
 * against the build this run produced, which is what makes them worth running
 * last.
 */
const roots = ["packages", "apps"];

/** @type {Record<string, string>} */
const alias = {};
for (const root of roots) {
  const rootDir = resolve(import.meta.dirname, root);
  if (!existsSync(rootDir)) continue;
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = resolve(rootDir, entry.name, "src", "index.ts");
    if (existsSync(source)) alias[`@praxis/${entry.name}`] = source;
  }
}

export default defineConfig({
  resolve: { alias },
  // Vitest's 5000ms default is a budget for pure tests. The integration layer
  // is not pure: it opens real databases with `synchronous=FULL`, so every
  // ledger commit fsyncs, and a legacy import writes many. That budget was set
  // by nobody; it was the default, and it had never been spent on a cold
  // runner because this suite had never run on CI at all.
  //
  // It now has been. On windows-latest seven integration tests timed out at
  // 5000ms while the same tests passed on ubuntu-latest in the same run, and
  // pass locally in 300-3000ms each. A cold 2-vCPU runner with a real-time
  // scanner is several times slower than a warm development machine, which is
  // the whole difference. No retry or sleep loop exists in the store or the
  // runtime, so this is budget and not a hang.
  //
  // The timeout's job is to catch a hang, not to enforce a performance
  // budget. 30s is deliberately generous for that job and deliberately not
  // tuned: the real CI durations are not known yet, and picking a tight number
  // before measuring it would be inventing precision. Tighten it once the
  // first green run reports what these tests actually cost there. See BP-062.
  testTimeout: 30_000,
});
