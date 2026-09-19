# Preview Release Gate

**Candidate branch:** `release/v0.1.0-preview-candidate`  
**Release engineering:** started as preparation only; no tag, merge, GitHub
Release or Hugging Face upload is authorized.  
**Current decision:** `CONDITIONAL / NO-GO`

## Gate state

| Gate                               | State                             | Evidence                                                                                                                                              |
| ---------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime core freeze                | `RESPECTED`                       | Only release-blocking test/documentation/privacy corrections are in this round.                                                                       |
| Critical runtime defects           | `0 observed`                      | Current tests, registry audit and prior re-entry evidence.                                                                                            |
| High correctness/data-loss defects | `NO CURRENT CLOSED DEFECT`        | Core suites pass locally; fresh candidate CI still required.                                                                                          |
| Windows Node 22.13.0               | `PENDING CANDIDATE CI`            | Prior run `35356138756` passed before this candidate's final changes.                                                                                 |
| Ubuntu Node 22.13.0                | `PENDING CANDIDATE CI`            | Prior run `35356138756` passed before this candidate's final changes.                                                                                 |
| Clean tracked-only environment     | `PASS for install/operator smoke` | `git archive` export at `2447004` passed install, build, CLI/daemon smoke and 63 eval tests; canonical Node 22 verification remains a CI requirement. |
| Scenario regression                | `PASS (synthetic)`                | SC-01–SC-12 and negative-control suites; no field claim.                                                                                              |
| Verifier negative controls         | `PASS (synthetic)`                | Runtime pin, path, config, false-green and unknown-verifier controls.                                                                                 |
| Secret scan                        | `PASS for real secrets`           | Current and reachable-history scan found no usable credential.                                                                                        |
| Privacy scan                       | `CONDITIONAL`                     | Current paths redacted; older public ancestry retains non-secret path metadata.                                                                       |
| License                            | `READY`                           | MIT `LICENSE` present; historical corpus excluded.                                                                                                    |
| Dependencies                       | `CONDITIONAL`                     | No Critical/High; three unique dev advisories remain open.                                                                                            |
| README/support/limitations         | `READY pending final CI facts`    | Release-facing documents created and claims narrowed.                                                                                                 |
| V1/V2/V2X real evidence            | `NOT AVAILABLE`                   | No provider credential or author-approved real task set was supplied.                                                                                 |
| Real Asset benefit                 | `UNKNOWN`                         | Synthetic lifecycle is proven; benefit is not.                                                                                                        |
| GF01                               | `WAITING`                         | No source chain or publication permission.                                                                                                            |

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

Until the author explicitly says `OPEN_SOURCE_GO`, stop after candidate CI,
review artifacts and documentation. Do not merge to `main`, create a final
tag, publish a GitHub Release or upload to Hugging Face.
