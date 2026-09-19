# ADR-0013: Phase 5 command line, diagnostics and configuration

**Status:** Accepted for Phase 5
**Scope:** Bible EPIC-009, issues 080-086
**Gate:** `docs/PHASE-5-GATE.md`

## Context

The command line existed as a 297-line script that emitted JSON unconditionally,
had no `--json` flag, no exit-code taxonomy, and discarded the `code` carried by
every structured error the stack raises. The Bible asks for a control surface
that a person, an automation, and another model can all use, with stable exit
codes and machine output a caller can parse.

## Decisions

### 1. The command line is an adapter, not a second implementation

`apps/cli/src/index.ts` resolves configuration and environment, then calls
runtime use cases. It owns no domain rule. Where a command needs a decision the
runtime already makes, the command asks the runtime:

- the reserved-event list is exported from `packages/runtime` as
  `runtimeReservedEventTypes`, so `event append` refuses a domain event with the
  same vocabulary the runtime uses, rather than restating the list and drifting
  from it;
- `Phase3Runtime.reflectionInputForResidual` reads the ledger to assemble a
  reflection input, so the command names a recorded residual and a budget and
  does not build domain objects itself;
- `asset activate` reads a promotion review from a file and lets the Phase 4
  policy judge it. The command does not evaluate the policy.

### 2. Exit codes and error documents are the contract

`apps/cli/src/errors.ts` freezes the Bible's taxonomy — 0 success, 2 validation,
3 config, 4 migration, 5 storage, 6 RFC/invariant violation, 7 external adapter,
8 privacy/permission — and maps each source error's own `code` onto it. The
source code is preserved rather than replaced, so a caller can distinguish
`ASSET_REVISION_CONFLICT` from `EVENT_ID_CONFLICT` even though both are
validation-class failures. An unrecognised error becomes a storage-class failure
with its original text kept in `details`, rather than being smoothed into a
generic message.

Every failure produces `{ code, message, details?, traceId, suggestedAction }`.
A new failure mode therefore has to be assigned a deliberate code and a
deliberate next step.

A failing `doctor` exits 6: the command ran, but the runtime failed an
integrity check, which is the invariant class rather than a command error.

### 3. `--json` splits stdout from stderr

Under `--json`, stdout carries exactly one versioned machine document and
nothing else, and every diagnostic — including the error document — goes to
stderr. Without `--json`, stdout carries a readable summary and stderr stays
quiet unless something failed. Each machine document declares `schemaVersion`,
so a consumer can refuse a shape it does not understand.

### 4. Configuration is strict and holds no secrets

`praxis.config.json` is versioned by `schemaVersion` and validated against
`schemas/praxis-config.v1.schema.json`. An unknown field is a configuration
error, not an extension point: on a runtime that writes to a ledger, a
misspelled key is more likely to be a mistake with consequences than an
intentional extension. Provider credentials are read from the environment and
are never accepted here.

`init` records `system.config.changed` carrying only safe fields and a digest,
so a configuration change is auditable without publishing anything the operator
did not intend to publish.

`promotionPolicy` is threaded through `RuntimeCompositionRoot` into the Phase 4
asset policy.

### 5. A stated gap rather than a silent claim

Bible section 13.2 also lists context-ranking weights, reflection budgets and
timing-residual thresholds as configuration. They remain package defaults,
because threading them would mean changing the verified Phase 3 and Phase 4
constructor boundaries in a phase whose subject is the command line. This is
recorded as an open gap in `docs/PHASE-5-GATE.md` with its decision owner,
rather than being claimed as delivered.

### 6. Doctor reports, and says what it is reporting on

`doctor` gains a `config` check and a `legacy-import-integrity` check, and
`StoreHealth` gains the migration version so the migration state is part of the
diagnostic surface the Bible asks for. A check asserts something structural — a
projection cursor, a catalog snapshot, a run whose counts disagree with the
ledger — and never asserts that imported material is true.

## Consequences

- A wrapper script branches on a number and parses one document; it never reads
  human prose.
- Two defects were found by the new end-to-end scenario and fixed: `init` and
  `applyLegacyImport` appended records without catching the core projections up,
  so `doctor` immediately and correctly reported a lag.
- `enterprise`-grade claims remain out of scope: the writer is still a local
  capability context, not an authenticated operator, and the CLI does not
  change that.

## Non-goals

This ADR does not add authentication, remote transport, a daemon control
protocol, plugin loading, or shell completion. It does not make the command line
a second authorization layer: it calls the same composition root the daemon
does, with the same capability context.
