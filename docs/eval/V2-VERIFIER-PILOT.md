# V2-B Strong-Verifier Pilot

**Status:** STRUCTURAL READY; real model pilot NOT RUN.

The repository already exercises deterministic compiler/test-runner/filesystem
and replay verifiers, including verifier-unknown and timing/outcome separation.
Those suites establish that the verifier can disagree or abstain without the
Runtime inventing a result.

No provider-backed coding/debugging/production run was executed in this
iteration. A deterministic local run may be used as a harness smoke test, but
it must not be reported as model or field evidence.
