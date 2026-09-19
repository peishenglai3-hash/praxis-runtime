# Publication Manifest

This is a policy manifest, not permission to publish. It is effective only
after the author says `OPEN_SOURCE_GO` and the final gate is revalidated.

| File / group                                                  | GitHub          | Hugging Face    | Classification    | Notes                                                 |
| ------------------------------------------------------------- | --------------- | --------------- | ----------------- | ----------------------------------------------------- |
| Runtime source, migrations, schemas                           | `GITHUB_PUBLIC` | `LOCAL_ONLY`    | source            | No installed dependencies or local databases.         |
| Safe engineering docs, ADRs, RFC and gates                    | `GITHUB_PUBLIC` | `LOCAL_ONLY`    | documentation     | Redact machine paths; preserve evidence boundaries.   |
| Synthetic tests and scenario definitions                      | `GITHUB_PUBLIC` | `HF_PUBLIC`     | evaluation        | Clearly labelled synthetic/fault-injection material.  |
| RunManifest schemas and evaluation scripts                    | `GITHUB_PUBLIC` | `HF_PUBLIC`     | evaluation        | Version and commit must be recorded in the Eval Card. |
| Aggregated metrics                                            | `GITHUB_PUBLIC` | `HF_PUBLIC`     | evaluation        | Only after a real run exists; no fabricated metric.   |
| `The Final` source documents                                  | `LOCAL_ONLY`    | `NEVER_PUBLISH` | author provenance | Not copied into the repository.                       |
| Raw personal history / private chat / Production Card archive | `LOCAL_ONLY`    | `NEVER_PUBLISH` | historical corpus | Licence, consent and privacy are unresolved.          |
| GF01 source material                                          | `LOCAL_ONLY`    | `NEVER_PUBLISH` | historical corpus | Current status is `WAITING_FOR_AUTHOR_SOURCE`.        |
| SQLite databases, WAL/SHM, backups, logs and test recordings  | `NEVER_PUBLISH` | `NEVER_PUBLISH` | local state       | Physical local artifacts only.                        |
| `.env`, provider keys, tokens, certificates and credentials   | `NEVER_PUBLISH` | `NEVER_PUBLISH` | secret            | Never commit or upload.                               |

The Hugging Face export, if later authorized, must be staged under
`release/hf-export/` and re-scanned for secrets, paths, privacy, license and
inventory before upload. The project owner must confirm the target repository;
this manifest does not guess one.
