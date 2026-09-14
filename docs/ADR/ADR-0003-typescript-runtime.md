# ADR 0003 Use A TypeScript Node Runtime

Status: Accepted

## Context

The runtime must support a cross-platform CLI, a local daemon, typed contracts, JSON Schema artifacts, and deterministic tests.

## Decision

Use strict TypeScript on Node.js 22.13.0 or newer with ESM. Keep provider-specific SDK types behind adapter ports. Use pnpm workspaces, tsup builds, Vitest tests, ESLint, Prettier, and dependency-cruiser.

## Consequences

The core remains accessible to Codex and future language clients. Contracts must stay provider-neutral, and the locked toolchain is part of the reproducibility contract.
