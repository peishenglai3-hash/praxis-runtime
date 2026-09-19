# ADR-0015: The evaluation harness boundary

**Status:** Accepted for Phase 6V
**Scope:** Owner's Phase 6V brief §5 (`Evaluation Harness 边界`)
**Decision date:** 2026-09-18
**Supersedes:** nothing

## Context

Phase 6V is the first phase whose subject is the project's own usefulness rather
than its correctness. That changes what an evaluation tool is: up to Phase 6 it
was a test, and a test's failure mode is being wrong. From Phase 6V it is an
_instrument_, and an instrument's failure mode is being **believed**.

The owner's brief fixes the direction and the prohibition in the same paragraph:

```
praxis-runtime
        ↓
   被测对象

praxis-evals
        ↓
   外部观察者 / evaluator

原则:  eval → runtime
禁止:  runtime → eval
```

and adds two constraints on the arrangement:

- 「如果当前暂时仍在 monorepo：也必须保证逻辑和依赖方向等价。」
- 「评价框架不得成为 Runtime 正常运行依赖。」

There is also a scheduling permission: 「本轮允许先完成架构决议和最小 Harness，
不要求立即把所有 evaluation code 迁移成新仓库。」

## Why this is a decision and not a directory

The obvious reading is "make a folder". The actual problem is that **an
evaluator the subject can reach is an evaluator the subject can influence** —
not through malice, but through the ordinary mechanics of a shared module graph.
If `packages/runtime` can import `evals/`, then:

1. A type or constant defined for measurement can become load-bearing for the
   product, and the instrument acquires a stake in its own readings.
2. `pnpm build` can order the two against each other, so a broken evaluator
   breaks the runtime — the exact inversion of the constraint above.
3. Most seriously for this phase: the boundary between "what the runtime did"
   and "what the harness concluded" stops being visible in the module graph.
   Phase 6V's whole question is whether the runtime behaves well when it is not
   keeping score, and that question is unanswerable if the scorekeeper is inside
   the runtime's dependency closure.

So the decision is about **direction**, and the directory is only how direction
is made checkable.

## Decision

`evals/` is a top-level directory at the repository root, sibling to `tests/`,
containing `@praxis/evals` as a logically separate package.

**Dependency direction.** `evals/` may import anything in `packages/` and
`apps/`. Nothing in `packages/` or `apps/` may import `evals/`, directly or
transitively, by relative path or by package name. This is enforced twice:

- `.dependency-cruiser.cjs`, rule `runtime-does-not-depend-on-evals`, over
  `packages/` and `apps/`.
- [`evals/test/boundary.test.ts`](../../evals/test/boundary.test.ts), which
  reads source text rather than resolving a module graph.

**Both, deliberately.** The cruiser resolves through TypeScript config and
workspace links; if that configuration is ever wrong the cruiser reports "no
violations" and the rule silently ceases to exist — a check that passes because
it did not look, which is `VF-01`. The textual scan cannot fail that way: a
relative import path is a literal string. The scan is cruder and its failure
mode is a false positive, which is the safe direction to be wrong in. Agreement
between a structural tool and a textual one is worth more than either alone.

**Not a workspace package.** `evals/` is not listed in `pnpm-workspace.yaml`, so
it is absent from `pnpm -r build`, from the lockfile's workspace graph, and from
`scripts/assert-workspace-deps.mjs`'s package set. It is typechecked, because
`tsconfig.json` includes `evals/**/*.ts`, and that is the only build-system
integration it has.

The reason for _not_ making it a workspace package is the third constraint
above. A workspace package would be built by `pnpm build`, which is a mandatory
gate stage; the evaluator would then be able to break the runtime's build. The
brief forbids exactly that, and a rule in a cruiser config would not prevent it.

**Import style.** `evals/` imports the runtime through relative source paths —
`../../packages/contracts/src/index.js` — matching what `tests/` already does,
because `pnpm verify` runs the test layers _before_ `pnpm build` and a
package-name import would resolve to a `dist/` that does not exist yet.

**Gate membership.** `test:evals` is a stage in `verify:chain`, positioned after
`test:regression`. It runs `evals/test` only: the rate, schema, oracle and
boundary suites. Those need no model, no network and no credential, and §3 of
the brief asks for them under 「Test the test」. Experiments — anything needing
`PRAXIS_VALIDATION_PROVIDER_KEY` — are **not** in the chain, and
`evals/test/boundary.test.ts` asserts that no script the chain names mentions a
credential. A gate that needs a network is not a gate.

## Migration path

The owner's target is a separate `praxis-evals` repository. Nothing in this
decision obstructs it, and two things make it cheap:

- `evals/` already imports the runtime only through paths that would become
  `@praxis/*` package imports in a separate repository.
- The boundary checks would become filesystem facts rather than rules that need
  enforcing, at which point they can be deleted rather than migrated.

What must move first is `RunManifest` writing and the arm definitions, because
those are the parts a separate repository would need to own. What should not
move is `scripts/gate.mjs`'s new stage: a separate repository's self-tests
belong to that repository's CI, not to this one's gate.

## Consequences

**Accepted costs.**

- Two enforcement mechanisms to keep in step. If the cruiser rule and the
  textual scan disagree, the scan is authoritative and the cruiser is wrong.
- `evals/` is invisible to `pnpm -r` tooling: no `pnpm -r lint`, no workspace
  dependency assertion over it. It is linted by the root `eslint .` and
  typechecked by the root `tsconfig.json`, which is the coverage that matters.
- A contributor can still add an import that violates the direction; they will
  be stopped by the gate rather than by the compiler.

**What this decision does not settle.**

- Whether the evaluator should eventually be able to run against a _published_
  runtime artifact rather than source. That is a Release Engineering question
  and §14 of the brief explicitly leaves it there.
- How experiment results are stored long-term. `test-results/` is git-ignored
  and is not an archive; §17's record standard is met per run, and where those
  records live across phases is unresolved.
- Whether the harness should own a scenario registry that the runtime can read
  for any purpose. It must not, and nothing currently proposes it.

## What would falsify this decision

A case where the runtime genuinely needs to know something an evaluation
produced. The nearest real candidate is the `RunManifest` schema, which lives in
`schemas/eval/` inside this repository and is read by the runtime's own
`assert-phase3-schemas.mjs` family of checks. That is a schema shared by path,
not a dependency, and it is worth watching: if the manifest ever needs to be
validated _by_ the runtime, the direction has quietly reversed and this ADR
should be revisited rather than patched.
