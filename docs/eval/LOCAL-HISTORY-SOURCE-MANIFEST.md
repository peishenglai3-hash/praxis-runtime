# Local History Source Manifest

**Iteration:** Pre-Open-Source Iteration 1/2  
**Policy:** local read for evaluation only; no historical corpus enters GitHub
or Hugging Face in this iteration.

This manifest is an allowlist, not a discovery invitation. Paths not listed
here are outside the evaluation scope. `UNVERIFIED` is a provenance state, not
permission to copy or publish.

| source_id                   | project / local_path                                                                           | date_range / format                                |                                     estimated_record_count | provenance / privacy                                                                                                                           | credentials / licence                                                   | read_permission                                                    | fixture_permission                                                     | repository_copy / publication                              | allowed_eval_purpose                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `HONGHU-ARCHIVE-20260908`   | author-controlled historical archive (machine-specific path intentionally omitted)             | 2026-07-13—2026-09-08; JSONL/CSV/Markdown metadata | 11,411 visible interaction records; 5,999 artifact records | owner-supplied de-identified research export; residual re-identification risk is not established; personal/third-party material may be present | no credentials intentionally used; licence `UNVERIFIED`                 | `READ_LOCALLY_FOR_EVAL`                                            | aggregate-only; no raw or quoted fixture without a new author decision | `NO` / `NO`                                                | bounded source discovery, record-ID/timestamp lookup, aggregate metrics only |
| `INC-001-REPOSITORY-RECORD` | Praxis repository `docs/incidents/INC-001-*.md`, gates, and breakpoint records                 | 2026-09; Markdown                                  |                       bounded engineering incident records | primary project record already in the repository; private working context may be represented                                                   | no credentials; repository licence boundary applies                     | `READ_LOCALLY_FOR_EVAL`                                            | structural references only; no private transcript extraction           | existing repository files only; no new personal transcript | verifier/false-green and recovery regression analysis                        |
| `CODEX-HABIT-GEN1`          | generation-1 `codex-habit` source and local state referenced by `docs/eval/CORPUS-MANIFEST.md` | historical; JavaScript/JSON pattern state          |   294 derived patterns; raw event directory observed empty | derived, incomplete, and not reproducible from raw events                                                                                      | licence/provenance for local state not re-established in this iteration | `READ_LOCALLY_FOR_EVAL` only if a bounded task names an exact path | `NO`                                                                   | `NO` / `NO`                                                | migration-boundary audit only; not ground truth                              |
| `PRAXIS-CURRENT-REPOSITORY` | current repository checkout (machine-specific path intentionally omitted)                      | current; TypeScript/SQLite/JSON fixtures           |                                      repository-controlled | engineering source, not personal historical dialogue                                                                                           | repository dependencies only; no secrets in fixtures                    | `READ_LOCALLY_FOR_EVAL`                                            | synthetic and aggregate fixtures allowed                               | branch push allowed; historical data forbidden             | runtime, harness, and deterministic verifier tests                           |

## Explicit boundaries

- `contains_personal_data`: **possible/yes** for the Honghu archive and
  engineering incident records; no assumption of safe publication is made.
- `contains_third_party_data`: **possible** in the historical project archive.
- `contains_credentials_or_secrets`: **not established**; the archive is not
  treated as secret-free. No credential-bearing file is opened for evaluation.
- `license_status`: `UNVERIFIED` for the historical archive. Local evaluation
  is allowed by the current author instruction; redistribution is not.
- `fixture_permission`: metadata and aggregate references only. The source
  archive is not ingested into the Runtime and no dialogue excerpt is written
  to a manifest.
- `repository_copy_permission`: `NO` for raw or quoted historical material.
- `publication_permission`: `NO` in this iteration.

The archive README and the existing `CORPUS-I-REGISTER.md` remain the source
references for counts and integrity claims. This file intentionally does not
duplicate the archive.
