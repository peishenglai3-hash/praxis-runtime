# BP-049 — Canonical verification order

**Status:** CLOSED — author decision recorded 2026-09-18

The owner confirmed the canonical verification order for `pnpm verify`:

```text
runtime / version
→ dependency / lockfile
→ lint
→ typecheck
→ unit
→ integration
→ replay
→ regression
→ build
→ CLI smoke
→ daemon smoke
```

The repository implements this as eleven gate stages. `test:regression`
includes `tests/regression` and the credential-free `evals/test` self-tests;
there is no separate `test:evals` gate stage. This preserves the exact order
while retaining harness verification.

Evidence:

- `scripts/gate.mjs` — canonical stage list;
- `package.json#scripts.verify:chain` — executable order;
- `tests/regression/gate-runner.test.ts` — order and no-extra-stage regression;
- `docs/ADR/ADR-0007-runtime-ci-reproducibility.md` — authoritative decision.
