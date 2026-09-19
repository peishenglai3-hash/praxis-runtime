# Praxis Evals — Hugging Face Preparation

**Status:** `READY FOR HF PUBLICATION` — not uploaded in this release round.

This card describes the public evaluation layer that may later be staged and
uploaded to a Hugging Face dataset repository after the author confirms the
exact owner and repository. The target is intentionally not guessed here.

## Scope

The export may contain only:

- synthetic scenario definitions;
- fault-injection fixtures;
- public evaluation scripts and RunManifest schemas;
- aggregate metrics when an actual run exists;
- this card, support metadata and compatible licence material.

The export must not contain runtime source, private author documents, raw chat,
Production Card archives, candidate registers, GF01 source material, local
databases, backups, logs, credentials or unknown-licence content.

## Evidence boundary

Praxis Runtime `v0.1.0-engineering-preview` has engineering and integration
evidence on the canonical Node.js `22.13.0` Ubuntu/Windows gate. Synthetic
scenario and asset-lifecycle results are not real-user or real-provider
benefit evidence. V1/V2/V2X behavioural evidence, GF01 and real Asset benefit
remain explicitly limited or unknown.

## Staging requirements

Before any upload, create a dedicated `release/hf-export/` staging directory,
copy only files classified `HF_PUBLIC` by
[`PUBLICATION-MANIFEST.md`](./PUBLICATION-MANIFEST.md), record the exact
runtime commit, and rerun secret, privacy, absolute-path, licence and inventory
scans. Upload is permitted only after the author confirms the exact target
repository and issues a separate authorization.
