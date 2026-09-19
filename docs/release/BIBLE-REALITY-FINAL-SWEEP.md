# Bible-to-Reality Final Sweep

Each row follows: Bible requirement → current implementation → current test →
real-scenario evidence → public claim.

| Subsystem              | Implemented? | Tested? | Tested what it claims?                                                | Real evidence                                  | Public claim                                                       |
| ---------------------- | ------------ | ------- | --------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Event ledger           | Yes          | Yes     | Append-first, seq cursor, writer boundary, WAL/migration tests        | No field durability study                      | Local durable event substrate; not production-scale durability.    |
| Projection/replay      | Yes          | Yes     | Pure/rebuildable reducers, CAS and replay fixtures                    | No long-term live corpus                       | Derived state is rebuildable, not raw truth.                       |
| Context                | Yes          | Yes     | Planner ranks supplied factors and enforces budget/source exposure    | No real retrieval study                        | Planner/ranker over supplied signals; no learned judgement engine. |
| Expectation            | Yes          | Yes     | Structured expectation/verification and unknown semantics             | No live independent verifier study             | Verification state remains explicit; unknown is not failure.       |
| Residual               | Yes          | Yes     | Outcome/timing/rule residual boundaries and idempotency               | No field false-residual rate                   | Bounded deterministic detectors only.                              |
| Reflection             | Yes          | Yes     | STOP/CONTINUE/ESCALATE proposal budget and no side effects            | No user outcome study                          | Proposal mechanism, not autonomous correction.                     |
| Asset                  | Yes          | Yes     | Candidate → validation → human confirmation → active/challenge/ignore | Synthetic E2E only                             | Real benefit unknown; no automatic promotion.                      |
| Agent cursor           | Yes, bounded | Yes     | seq-bound cursor/replay fixtures                                      | Cross-agent field study absent                 | Different cursors are supported; multi-agent society is not.       |
| Adapter boundary       | Yes          | Yes     | Contract/conformance/neutrality tests                                 | No current live provider evidence              | Provider-neutral boundary, not all-provider support.               |
| FieldContext           | Yes          | Yes     | Schema and evaluator fields                                           | No social-field study                          | Input metadata, not a social theory classifier.                    |
| CLI/daemon             | Yes          | Yes     | Build, smoke, doctor, lock and operator-surface tests                 | Clean export pending                           | Local operator surface; not a packaged product.                    |
| Backup/restore         | Yes          | Yes     | `VACUUM INTO`, manifest checksum, staged restore, doctor/rebuild      | No disaster-recovery exercise outside fixtures | Local backup workflow; no remote backup guarantee.                 |
| Privacy purge          | Yes, bounded | Yes     | Physical local purge, receipts, invalidation/rebuild                  | No forensic deletion certification             | Best-effort local purge; remote copies are out of scope.           |
| Doctor                 | Yes, bounded | Yes     | Implemented health/maintenance checks                                 | No OS security scan                            | Diagnostic gate, not complete system security proof.               |
| Evaluation assumptions | Yes          | Yes     | Schema validator, holdout isolation, false-green controls             | V1/V2/V2X absent                               | Synthetic readiness only until real runs exist.                    |

No module is promoted from “implemented” to “empirically effective” by its
unit or integration test name.
