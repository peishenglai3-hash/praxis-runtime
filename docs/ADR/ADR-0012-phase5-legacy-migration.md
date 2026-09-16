# ADR-0012: Phase 5 audited Legacy migration

**Status:** Accepted for Phase 5
**Scope:** Bible EPIC-008, issues 070-075
**Gate:** `docs/PHASE-5-GATE.md`
**Field map:** `docs/migration/LEGACY-FIELD-MAP.md`

## Context

The Bible names the first-generation `codex-habit` repository at audit baseline
`main@c3be4af` as the Legacy migration input, and requires the importer to
detect and report malformed, duplicated, ambiguous, unrecoverable and unmapped
material rather than repair it. Two different objects are in play:

- the first-generation **source**, which is public; and
- the **runtime data** the first generation produced, which is the owner's
  personal history in a home directory.

The repository holds neither. `legacy/` was empty before this phase, so the
field map had to be derived from the public source and the anomaly classes had
to be established from evidence rather than assumed.

## Decisions

### 1. The field map precedes the importer

`docs/migration/LEGACY-FIELD-MAP.md` records structure — file paths, formats,
field names, identifier shapes, and nine anomaly classes — derived from a
read-only reading of the public first-generation source. It records corpus
fingerprints and structural counts, and no record value. The importer was
written against it, not against a guess about what the format might be. A
field mapping invented without the source would have produced an importer that
cannot import anything real.

### 2. Anomaly classes: five from the Bible table, four added by the audit

The Bible's section 12 table has five rows. Four name a class explicitly —
`possible_overwrite`, `ambiguous_pattern`, `source_metadata_conflict`,
`unrecoverable_field`. The fifth row describes a category cartesian relation
and states its handling without naming a class; this implementation named it
`cartesian_relation`.

The audit established four further conditions the corpus contains and the
table cannot express:

- `encoding_marker` — a leading UTF-8 byte-order mark on a file whose parser
  anchors at byte zero. The first-generation PowerShell installer wrote these,
  and its own readers silently returned nothing for the affected files.
- `parse_error` with a `format_anchor_mismatch` reason — every one of the 45
  signal bodies in the observed corpus is CRLF-delimited, while every
  first-generation reader anchors its frontmatter match on an LF. The tool
  cannot read the files it wrote. This is the same failure class the repository
  already recorded as `BP-040` on the Windows runner.
- `unmapped_path`, kept distinct from `parse_error` so that unknown material is
  reported as unknown rather than as broken.
- `privacy_sensitive`, which makes an exclusion a recorded observation rather
  than a silent omission. A declared rule that matched nothing is reported in
  the same class: a privacy rule that quietly does nothing is worse than none,
  because it reads as protection.

Folding any of the four into an existing class would have reported a parse
failure as "possibly overwritten" — a claim about history the evidence does
not support. The extension is recorded as
`RFC MISMATCH: LEGACY_ANOMALY_CLASSES_EXTENDED` in `docs/RFC/RFC-0001.md`; the
decision owner is the repository owner.

### 3. The scanner reports only what the bytes prove

`packages/runtime/src/legacy/scanner.ts` is read-only and pure with respect to
a `LegacyFileSystem` port. Three rules keep it honest:

- It never normalises a source file. The CRLF bodies are reported as
  unreadable, not converted.
- It never infers a missing value. A signal with no usable declared instant is
  excluded and counted; the six theory fields the writer declared but never
  persisted are listed as `absentFields` on every record, so a reader cannot
  mistake an absent value for a recorded one.
- The overwrite rule reports only the provable fact: how many ordinal values
  inside the observed range are unused. A bucket whose ordinals simply start
  above one is _not_ reported, because that is equally consistent with a
  counter that carried across a boundary.

### 4. Provenance, scope and promotion

`legacy.*` events are validated by `packages/contracts/src/legacy-events.ts`
and by a trigger in `migrations/0011_legacy_import.sql`:

- provenance is fixed per event type — `declared` for a signal, `inferred` for
  a derived pattern or graph edge, `direct` for an observation about the source;
- the corpus fingerprint is part of every event identity, so a re-import of the
  same corpus is idempotent and a different corpus can never collide with an
  earlier run;
- the writer is the frozen `IMPORTER` role, whose namespace is `legacy.*` and
  whose scope list contains no `asset.*` entry.

Consequently no imported record can reach `validated` or `active` through the
import path. A first-generation pattern enters the ledger as inferred material
with confidence capped at 0.5, and turning it into a candidate asset is a
separate, explicit runtime step that carries the Phase 4 promotion policy.

`legacy.*` moves from the generic append scope to `system.migrate`, which is
the scope the migration boundary already reserved.

### 5. Atomic run record, append-only

`recordLegacyImport` commits the run row, its source inventory, its anomaly
rows and every imported event in one SQLite transaction. The events are
appended first so the run row can be written complete in a single insert; the
run tables are append-only, because a correction is a new run rather than an
edit.

Idempotency is keyed on the **corpus fingerprint alone**. The first
implementation keyed it on `(source_fingerprint, plan_hash)`, which was wrong
in a way that only showed up under review: the plan hash covers the privacy
rule set, so the same corpus reviewed under a changed rule set produced a new
plan hash, missed the existing run, and tried to write a second set of events
for a corpus already in the ledger — colliding with the records it had written
itself. A corpus is imported once; whether the reviewer has since changed the
rule set is a fact about the review, not about the corpus. The unique index on
`(source_fingerprint, plan_hash)` remains as a structural guard, and a replay
that finds a stored run under a different plan returns
`planDiffersFromRecorded: true` with nothing written, so the caller is told
rather than handed a silent success.

`getLegacyIntegrityIssues` gives doctor a structural view: an imported event
whose corpus has no run, a run whose declared counts disagree with the ledger,
a run with no completion event, a run with no inventory. A run whose events the
operator has since purged is not reported as a failure — the deletion right is
not an integrity defect — so the check consults the purge receipts for the
run's `legacy:<fingerprint>` scope.

### 5.1 The migration file is frozen, including its comments

`migrations/0011_legacy_import.sql` is content-addressed: `MigrationRunner`
stores a SHA-256 of the file's raw text in `schema_migrations.checksum` and
refuses to open a database whose recorded checksum differs. A comment edit is
therefore a breaking change, and two statements inside that file are now stale
rather than wrong-in-behaviour:

- the `legacy_event_integrity` comment claims the trigger enforces
  "deterministic identity". It does not and cannot: the identity is derived by
  `legacyEventId` in the runtime — a canonical, escaped composite of the family
  and the record identifiers, not a hash — which SQLite cannot recompute at
  that point. The trigger
  enforces writer role, a 64-hex corpus fingerprint, a non-empty operation id,
  a non-empty evidence array, a source ref equal to the payload fingerprint,
  fixed provenance per event family, and a known verb. **Identity determinism
  is enforced by `legacyEventId` and its tests, not by the database.**
- the file header says a re-import is recognised by
  `(source_fingerprint, plan_hash)`; per §5 it is recognised by the fingerprint
  alone.

Neither can be corrected in place without invalidating every existing
database, so the corrections live here. This is recorded as `BP-048` in
`docs/断点记录.md`, together with the rule it establishes: a committed
migration is never edited for text, and a behaviour change ships as a new
migration version.

### 6. Repository fixture is synthetic and byte-exact

`fixtures/legacy/` is generated by `scripts/generate-legacy-fixture.mjs` and
reproduces the observed formats and all nine anomaly classes with synthetic
values. Several classes are encoding facts, so `.gitattributes` marks
`fixtures/legacy/**` as `-text` and `.prettierignore` excludes it: Git must not
normalise the very bytes the importer is required to detect.

The owner's real corpus is never copied into the repository. Running the
importer against it is an owner-local action that produces the owner's own
report; the repository's tests demonstrate behaviour, not the owner's history.

## Consequences

- The importer is real rather than demonstrative: its rules come from the
  formats the first generation actually wrote.
- Nine anomaly classes are reported: five from the Bible's table (one of them
  named here rather than there) and four added by the audit. The extra classes
  are recorded here rather than folded into an existing one, because folding
  them would hide the finding.
- The archive is written outside the repository, made read-only, and is
  idempotent by digest: a re-import that finds different content at the same
  path refuses rather than replacing it. Each write is verified against the
  digests the plan was derived from, so the archive is proven to hold the
  corpus it claims rather than merely asserted to.
- `applyLegacyImport` catches the core projections up after a successful
  import, mirroring the confirmed-purge behaviour, so a large import does not
  leave doctor reporting a lag it would be right to report.

## Non-goals

This ADR does not claim that the first-generation history can be fully
recovered. It does not re-derive destroyed pattern instances, back-fill the
absent theory fields, elect a winner among conflicting version declarations,
or treat the category-level association graph as a mechanism fact. The
migration does not delete or alter the original source, and it makes no claim
about copies held outside the local machine.
