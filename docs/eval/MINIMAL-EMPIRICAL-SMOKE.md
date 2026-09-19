# Minimal Empirical Smoke

**Date:** 2026-09-19  
**Rule:** no synthetic fixture is relabelled as a real result.

## Attempted evidence

The final-freeze preflight checked for `PRAXIS_VALIDATION_PROVIDER_KEY` without
printing its value. It is not available in the current environment. No
provider credential was requested, guessed, searched for, or persisted. No
author-approved prospective task list or licence-cleared historical slice was
provided in this round.

The separate engineering smoke did run from a tracked-only export: fresh
install, build, CLI init/doctor, daemon one-shot and 63 synthetic eval tests
completed successfully. That is installation/runtime evidence, not V1
behavioral evidence.

| Arm        | Required evidence                                                        | Current state               | Honest interpretation                                                       |
| ---------- | ------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------- |
| V1         | 5–10 real low-risk tasks and BASE/STATE/REFLECTION/FULL comparison       | `BLOCKED / NOT RUN`         | The checked-in oracle is synthetic readiness evidence only.                 |
| V2         | 3–5 real historical or strong-verifier subject tasks                     | `BLOCKED / NOT RUN`         | Existing root-cause tests are engineering regressions, not a subject study. |
| V2X        | Same scenario under two real providers/scaffolds                         | `BLOCKED BY PROVIDER`       | No synthetic provider substitution.                                         |
| Real Asset | Real episode → residual → candidate → confirmation → active → later task | `UNKNOWN`                   | Synthetic E2E passes; real benefit may be positive, neutral or negative.    |
| GF01       | Bounded historical source chain                                          | `WAITING_FOR_AUTHOR_SOURCE` | No invention or raw ingest.                                                 |

## What is executable now

- The four arms are structurally distinct in the synthetic evaluator.
- The FULL arm exercises candidate creation, validation, explicit human
  confirmation, activation, later reuse, ignore and challenge.
- Unknown verifier results remain unadjudicated and do not create a false
  failure residual.
- Scenario manifests and negative controls are loadable and testable.

These are readiness claims, not field outcomes. The next empirical run must
separate `input/` and `holdout/`, record provider/model/runtime/commit and keep
an independent verifier outside the subject path.
