# License Audit

**Status:** READY for the source-preview license boundary, subject to the
author's existing MIT decision and final publication review.

## Repository license

- `LICENSE` is present and contains the MIT License.
- Copyright holder: Lai Peisheng.
- `package.json` remains `private: true`; no npm package license boundary is
  being asserted.
- `CITATION.cff` and documentation identify the same project and license.

## Included material

- Runtime source, migrations, schemas, tests and synthetic fixtures are
  repository-authored or project-generated and are covered by the repository
  license unless a file says otherwise.
- `node_modules`, caches, local SQLite files, WAL/SHM files, backups, logs,
  private chat and historical archives are not release artifacts.
- The author-supplied `The Final` documents are intellectual provenance, not
  copied public corpus material.
- No third-party source file is intentionally bundled into the runtime; package
  dependencies remain external install-time dependencies described by the
  lockfile.
- The historical GF01 archive has unverified provenance/licence/consent and is
  explicitly excluded from GitHub and Hugging Face publication.

If a future change copies third-party code or fixtures into the tree, it must
add an attribution and compatibility review before release.
