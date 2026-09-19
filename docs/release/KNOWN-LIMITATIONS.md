# Known Limitations

This is the release-facing list for the engineering preview candidate. It is
intentionally narrower than the complete RFC debt register.

## Evidence limitations

- Current-branch real V1 low-risk task evidence is not collected.
- Current-branch V2 historical/strong-verifier evidence is not collected as a
  subject evaluation.
- V2X provider/scaffold comparison is blocked by the absence of two approved
  provider/scaffold runs.
- The reusable-asset lifecycle is exercised end-to-end in synthetic harness
  fixtures, but real benefit is **UNKNOWN**; no positive benefit claim is made.
- GF01 remains `WAITING_FOR_AUTHOR_SOURCE`. The historical chain has not been
  synthesised or copied into the repository.

## Runtime and platform limitations

- Canonical support is Node `22.13.0`; Node 24 is intentionally rejected by
  the canonical gate.
- `node:sqlite` is experimental in the canonical Node release.
- macOS x64, macOS arm64 and Linux arm64 are not tested.
- The adapter boundary is not a provider integration or a credentials system.
- The local writer/ACL contract does not protect against a hostile process with
  access to the same filesystem.
- Some Bible configuration knobs remain package defaults and are tracked as
  RFC gaps rather than silently exposed as operator controls.
- Doctor covers the implemented local maintenance checks; it is not a general
  OS health or security scanner.

## Distribution limitations

- The workspace is not an npm package and no npm publication is planned for
  this preview.
- No installer, GUI, Electron shell, cloud service, marketplace or telemetry
  system is included.
- The repository's historical Git ancestry contains non-secret path metadata
  from earlier engineering records. Current public documents are redacted;
  history is not rewritten in this round. The engineering preview discloses
  this limitation and does not include any real secret or private corpus.
