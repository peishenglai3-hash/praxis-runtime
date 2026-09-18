# Historical Holdout Protocol

**Status:** implemented and negative-tested; real historical run pending
approved fixture material.

## Contract

Every historical episode is divided before execution:

```text
T0 ... Tk   → input window, visible to Subject Runtime
Tk+1 ... Tn → future holdout, visible only to Evaluator
```

The Subject receives the task prompt and selected input context. It never
receives the holdout value, source excerpt, later correction, human disposition,
Production Card, final asset status, or any other future answer.

The Evaluator may receive an evaluator-only `HoldoutEntry` through the
`RunOptions.holdout` map and the verifier callback. The map is never passed to
the Subject.

## Enforcement

`evals/src/runner.ts` gives the Subject only a `holdout.read()` guard. Calling
it throws `HoldoutAccessError`. `evals/src/run.ts` records the attempt and
marks the run `holdoutIsolation: FAIL`; it does not reveal the value.

Manifests record:

- `holdoutIsolation`: `PASS`, `FAIL`, or `NOT_APPLICABLE`;
- `holdoutLeakageCount`: the number of prohibited attempts.

The negative control is `evals/test/holdout.test.ts`:

- a safe Subject leaves the boundary `PASS` while the verifier reads the
  evaluator-only value;
- a leaking Subject produces `FAIL` and one leakage count;
- a prohibited read is still `FAIL` when no holdout was supplied.

## Evidence boundary

The current 62/62 evaluation-harness tests establish boundary behavior, not a
real historical result. No private archive content is stored in the repository.
The Honghu source remains local-read-only under
`LOCAL-HISTORY-SOURCE-MANIFEST.md`; a real V2 historical run requires an
author-approved, provenance-cleared minimal fixture or an explicitly approved
metadata-only evaluator adapter.
