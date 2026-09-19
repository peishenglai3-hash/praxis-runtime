# Clean Installation Report

**Purpose:** prove that the project can leave the author's development
directory and still be installed from tracked files only.

## Procedure

1. Export the candidate with `git archive` into a new temporary directory.
2. Confirm there is no `.git`, `node_modules`, `.praxis`, database, backup,
   cache, private attachment or untracked file in the export.
3. Run `pnpm install --frozen-lockfile`, build, CLI help/init/doctor, daemon
   one-shot smoke and the evaluation bootstrap from that directory.
4. Run the canonical `pnpm verify` only on Node `22.13.0`; a Node 24 local run
   is an intentional negative control.

## Current evidence

| Check                            | State                                             | Evidence                                                                      |
| -------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tracked-tree export              | `PENDING FINAL COMMIT`                            | Must be rerun after the candidate hardening commit.                           |
| Clean install                    | `PENDING FINAL COMMIT`                            | Must be rerun from the export, not the working checkout.                      |
| Clean build and CLI/daemon smoke | `PENDING FINAL COMMIT`                            | Must be rerun from the export.                                                |
| Exact Node 22 CI                 | `PASS on prior baseline; pending candidate rerun` | Run `35356138756` passed both Ubuntu and Windows at the pre-freeze baseline.  |
| Node 24 canonical gate           | `EXPECTED FAIL`                                   | The runtime pin check correctly rejects the developer machine's Node 24.15.0. |

The candidate cannot be called reproducible until the pending export and a
fresh exact-runtime CI run are attached to the final commit.
