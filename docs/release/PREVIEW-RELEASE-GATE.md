# Preview Release Gate

**Candidate branch:** `release/v0.1.0-preview-candidate`  
**Release engineering:** final GitHub preparation authorized; merge, tag and
Release remain ordered operations from the verified `main` commit. No Hugging
Face upload is included in this round.
**Current decision:** `PASS — ENGINEERING PREVIEW`

## Gate state

| Gate                               | State                          | Evidence                                                                                                                                         |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime core freeze                | `RESPECTED`                    | Only release-blocking test/documentation/privacy corrections are in this round.                                                                  |
| Critical runtime defects           | `0 observed`                   | Current tests, registry audit and final candidate CI evidence.                                                                                   |
| High correctness/data-loss defects | `NO CURRENT OBSERVED BLOCKER`  | Exact candidate run `35422995773` passed both runners; no high correctness/data-loss failure surfaced in the final gate.                         |
| Windows Node 22.13.0               | `PASS`                         | Run `35422995773`; artifact is Node `22.13.0`, clean, complete and points to `46a461a`.                                                          |
| Ubuntu Node 22.13.0                | `PASS`                         | Run `35422995773`; artifact is Node `22.13.0`, clean, complete and points to `46a461a`.                                                          |
| Clean tracked-only environment     | `PASS`                         | `git archive` export passed install, build, CLI/daemon smoke and eval tests; final CI independently checked a clean tracked checkout on Node 22. |
| Scenario regression                | `PASS (synthetic)`             | SC-01–SC-12 and negative-control suites; no field claim.                                                                                         |
| Verifier negative controls         | `PASS (synthetic)`             | Runtime pin, path, config, false-green and unknown-verifier controls.                                                                            |
| Secret scan                        | `PASS for real secrets`        | Current and reachable-history scan found no usable credential.                                                                                   |
| Privacy scan                       | `PASS WITH DISCLOSED CAVEAT`   | Current paths redacted; older public ancestry retains non-secret path metadata, accepted without history rewrite.                                |
| License                            | `READY`                        | MIT `LICENSE` present; historical corpus excluded.                                                                                               |
| Dependencies                       | `ACCEPTED RISK — NON-BLOCKING` | No Critical/High; three unique dev advisories remain open in development-only tooling.                                                           |
| README/support/limitations         | `READY`                        | Release-facing documents created, claims narrowed and candidate CI evidence recorded.                                                            |
| V1/V2/V2X real evidence            | `KNOWN LIMITATION`             | Real behavioral evidence remains incomplete; this does not block an Engineering Preview.                                                         |
| Real Asset benefit                 | `UNKNOWN — KNOWN LIMITATION`   | Synthetic lifecycle is proven; real benefit is not claimed.                                                                                      |
| GF01                               | `KNOWN LIMITATION — WAITING`   | No source chain was invented or published.                                                                                                       |

## Hard stop conditions

The candidate must not be merged, tagged or published if any of these occurs:

- final CI is red or runs on the wrong commit/runtime;
- a real Critical/High security or correctness defect appears;
- the clean export depends on untracked or machine-local state;
- a secret, private corpus or unknown-license material enters the public bundle;
- README claims exceed the evidence;
- release branch, tag, manifest and verified commit diverge.

## Release class recommendation

If the engineering gates close but real V1/V2/V2X evidence remains absent, the
only honest class is `v0.1.0-engineering-preview`. It must not be called a
Research Preview and must retain the evidence limitations above.

## Authorization boundary

The author has issued `OPEN_SOURCE_GO`. Continue only through the ordered
release procedure: final candidate checks, PR, required CI, merge, verified
`main` SHA, annotated tag and GitHub Release. Hugging Face remains separate and
is not uploaded without an explicitly identified owner/repository.
