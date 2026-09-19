# Legacy Field Map — first-generation `codex-habit`

**Status:** Phase 5 audit record (EPIC-008 input register)
**Audit date:** 2026-09-15 (Asia/Shanghai)
**Controlling plan:** `Codex Implementation Bible v1.0`, section 12 and EPIC-008

This file is the repository-facing **field map** required by the Bible before a
Legacy migration can be implemented. It records _structure_: file paths, file
formats, field names, identifier shapes, and anomaly classes. It does **not**
contain, transcribe, translate, or paraphrase any first-generation record
value, and no first-generation data is vendored into this repository.

## 1. Governance boundary

The Bible names `codex-habit` at audit baseline `main@c3be4af` as the Legacy
migration input. That repository is **public source**; the _history produced by
running it_ is **owner-local personal data** in the owner's home directory. The
two are different objects and are governed differently:

| Object                                    | Location                                    | Status in this repository                                                       |
| ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| First-generation **source code**          | public `codex-habit` @ `c3be4af`            | Read-only. Not vendored. Used only to derive the field map below.               |
| First-generation **runtime data**         | owner-local `~/.codex-habit/`               | Never vendored, never committed, never copied into a fixture. Owner-local only. |
| Phase 5 **repository fixture**            | `fixtures/legacy/`                          | Synthetic. Structurally identical to the observed shapes; values are generated. |
| Phase 5 **migration archive** (Bible §12) | configured archive directory (not the repo) | Owner-local, hashed by the importer. Never committed.                           |

Consequence: the importer built in Phase 5 is a real importer pointed at a
configurable source root. Running it against the owner's directory produces a
report that is the owner's own evidence. The repository's own tests run against
the synthetic fixture and demonstrate behaviour, not the owner's history.

## 2. Corpus identity

| Corpus                       | Fingerprint (SHA-256 over sorted relative path + file SHA-256)     | Files |
| ---------------------------- | ------------------------------------------------------------------ | ----- |
| Source `codex-habit@c3be4af` | `8C73EDDBFB120BDB86BD8FBC9831E9D28398FF2F52E1991801BE7A63B59274B6` | 19    |
| Owner-local data directory   | `732789BA55C7B24C7B0E0A170790C3B6764FFF74978A0ADD53D7FE467441EC9A` | 345   |

The data-directory fingerprint is recorded so that a later re-import can prove
it read the same corpus. It is a digest, not a copy.

## 3. Artifact inventory

### 3.1 Source-side (public, read-only)

```text
hub-manifest.json                              # hub interface declaration (UTF-8 BOM)
.codex-plugin/plugin.json                      # plugin manifest (UTF-8 BOM)
hooks/codex-hooks.json                         # lifecycle hooks (UTF-8 BOM)
install.ps1 / uninstall.ps1                    # data-directory bootstrap
scripts/signal-capture.mjs                     # writes signals/ and .signals_index.json
scripts/habit-graph.mjs                        # writes patterns/active/ and .graph_state.json
scripts/pattern-matcher.mjs                    # reads patterns + .graph_state.json
scripts/context-injector.mjs                   # reads profile/ and patterns/active/
scripts/foresight-engine.mjs                   # writes profile/foresights.md
scripts/graph-data.mjs                         # derives visualization JSON
scripts/hub-events.mjs                         # writes .events/
scripts/hub-query.mjs                          # reads index/graph/profile/manifest
data/profile/template.md                       # profile template (UTF-8 BOM)
outputs/visualize.html                         # static viewer
.agents/skills/codex-habit-skill/SKILL.md      # skill description
README.md                                      # (UTF-8 BOM)
```

### 3.2 Data-side (owner-local, never vendored)

```text
<root>/signals/<YYYY-MM>/sig_YYYYMMDD_NNN.md   # one signal per file, frontmatter-like body
<root>/.signals_index.json                     # { signals: Signal[], patterns: [] }
<root>/.signal_buffer.json                     # { signals: Signal[] } — unflushed only
<root>/patterns/active/<patternId>.md          # one pattern per file, frontmatter-like body
<root>/patterns/archived/<patternId>.md        # archive bucket (present, empty in observation)
<root>/.graph_state.json                       # { associations, lastBuilt, patternCount, adaptiveThreshold, patterns? }
<root>/.events/event.log                       # NDJSON, one event per line
<root>/.events/<eventId>.json                  # per-event mirror file
<root>/.events/.subscriptions.json             # { subscribers: [] }
<root>/profile/index.md                        # profile frontmatter + prose
<root>/profile/foresights.md                   # `## <Order> Order` sections + `- **trigger** → action` lines
<root>/profile/timeline.md                     # prose (observed with UTF-8 BOM)
```

The scanner must treat **every unknown path as unmapped material**, not as an
error and not as something to guess. New directories that a later
first-generation version may have produced are recorded as
`unmapped_path`, never silently dropped.

## 4. Field map

### 4.1 Signal record — `.signals_index.json` → `signals[]`

| First-generation field | Type as written           | Runtime mapping                                   | Notes                                                                    |
| ---------------------- | ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| `id`                   | string `sig_YYYYMMDD_NNN` | `legacyRecordId`                                  | `NNN` restarts per flush batch — see `possible_overwrite`                |
| `type`                 | string                    | candidate `legacy.signal.imported` payload `kind` | observed vocabulary: preference / rejection / workflow / self_reflection |
| `category`             | string                    | payload `category`                                | used as the graph grouping key                                           |
| `value`                | string                    | payload `value`                                   |                                                                          |
| `timestamp`            | ISO string                | `occurredAt` of the imported event                |                                                                          |
| `confidence`           | number                    | payload `confidence`                              | defaulted to `0.5` at write time when absent                             |
| `source`               | string                    | payload `source`                                  | producer skill name                                                      |
| `order_of_worth`       | string \| null            | **absent in observed data**                       | theory field, optional since v0.3                                        |
| `justification`        | string \| null            | **absent in observed data**                       | theory field, optional since v0.3                                        |
| `test_count`           | number (default 0)        | **absent in observed data**                       | theory field, optional since v0.3                                        |
| `test_survival_rate`   | number \| null            | **absent in observed data**                       | theory field, optional since v0.3                                        |
| `reflexive_effect`     | string \| null            | **absent in observed data**                       | theory field, optional since v0.3                                        |
| `context_label`        | string \| null            | **absent in observed data**                       | theory field, optional since v0.3                                        |

The six `absent in observed data` rows are the Bible's `missing context` class.
They are mapped to `unrecoverable_field` anomalies. They must **not** be
back-filled from inference, and a `null` default must not be presented as a
recorded observation.

### 4.2 Signal file body — `signals/<YYYY-MM>/<id>.md`

Frontmatter-like block delimited by a leading `---` line, followed by an
`Evidence:` line. Observed key set: `[category, confidence, id, timestamp,
type, value]`.

The writer deliberately removes two fields before writing the body:

```js
const meta = { ...sig };
delete meta.evidence;
delete meta.context;
```

`evidence` survives only as a free-text `Evidence:` line. `context` is written
**nowhere** — it exists only in the unflushed buffer. This is the structural
origin of the `missing context` class: two declared fields were dropped at the
persistence boundary rather than recorded as unknown.

### 4.3 Pattern record — `patterns/active/<patternId>.md`

Frontmatter-like block. Written key set:
`[id, trigger, action, confidence, frequency, createdAt, lastSeen]`.
Read-side consumers additionally expect `order_of_worth`, which the writer never
emits; consumers treat the missing value as the literal default `"industrial"`.

Identifier shape: `pat_<fromCategory>_<toCategory>`. The identifier is built
from **category only**, while the upstream association key is
`<category>:<value>`. Distinct `<category>:<value>` pairs that share a category
pair therefore produce the **same** `patternId` and overwrite each other on
disk. See `ambiguous_pattern` in section 5.

### 4.4 Graph state — `.graph_state.json`

| Field               | Shape                                                               | Notes                                                            |
| ------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `associations`      | `{ from: "<cat>:<val>", to: "<cat>:<val>", strength, frequency }[]` | `strength = min(1, frequency/5)`, so only multiples of 0.2 occur |
| `lastBuilt`         | ISO string                                                          |                                                                  |
| `patternCount`      | number                                                              | patterns that passed the threshold filter                        |
| `adaptiveThreshold` | `{ value, cv, baseRate, numCategories }` **or** a bare number       | two shapes from one function — see section 5                     |
| `patterns`          | array (legacy)                                                      | written by an earlier version; no current writer maintains it    |

### 4.5 Event record — `.events/event.log` (NDJSON)

`{ type, source, data, timestamp, id: "evt_<epochMillis>" }`

`id` derives from `Date.now()` alone, so two events emitted inside one
millisecond collide and the per-event mirror file is overwritten.

### 4.6 Profile

`profile/index.md` — frontmatter (`id`, `created`, `updated`, `status`,
`session_count`, plus learned keys) and prose sections.
`profile/foresights.md` — `## <Order> Order` headings; each entry is
`- **<trigger>** → <action> (conf: NN%)`.
`profile/timeline.md` — prose.

## 5. Anomaly classes

Detection must be evidence-based; a flagged row is never rewritten.

### 5.0 Where the class list comes from

The Bible's section 12 table has five rows. Four of them name a class
explicitly — `possible_overwrite`, `ambiguous_pattern`,
`source_metadata_conflict`, `unrecoverable_field`. The fifth row describes a
condition ("graph cartesian relation") and states its handling, but names no
class; this implementation gave it the name `cartesian_relation`.

The Phase 5 audit found four further conditions the audited corpus exhibits and
the table cannot express: a file whose declared format cannot be parsed
(`parse_error`), a leading byte-order mark on a file whose parser anchors at
byte zero (`encoding_marker`), a path the field map does not describe
(`unmapped_path`), and material matched by a privacy rule
(`privacy_sensitive`). They are implemented as distinct classes rather than
folded into an existing one, because folding would report a parse failure as
"possibly overwritten" — a claim about history the evidence does not support.

This provenance is recorded as `RFC MISMATCH: LEGACY_ANOMALY_CLASSES_EXTENDED`
in `docs/RFC/RFC-0001.md`; the decision owner is the repository owner.

| Class                      | Detection rule as implemented                                                                                                          | Handling                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `possible_overwrite`       | An ordinal that repeats inside one date bucket, or an unused ordinal value **inside the range a bucket actually occupies**.            | Keep the surviving file. Record the count of unused ordinals. Do not renumber as "true history".                                                                 |
| `ambiguous_pattern`        | More than one distinct `<category>:<value>` association pair mapping to one `patternId`.                                               | Record the collision count. The survivor is a `candidate` asset at low provenance. Never auto-`active`.                                                          |
| `source_metadata_conflict` | Two source files declaring different versions of the same component, or a declared version that does not match the code's own header.  | Record both declarations verbatim as metadata. Do not elect a winner.                                                                                            |
| `unrecoverable_field`      | A declared field with no value in any observed record, or a field dropped at the persistence boundary.                                 | Record the field name and the reason. Never infer a value.                                                                                                       |
| `cartesian_relation`       | An association set whose cardinality equals the pairwise product of its grouping key rather than the count of observed co-occurrences. | Import as `legacy` candidate evidence only. Never as a mechanism fact.                                                                                           |
| `parse_error`              | A file whose declared format cannot be parsed (malformed JSON, unreadable frontmatter).                                                | Record path, size, digest and the failure. Do not repair.                                                                                                        |
| `encoding_marker`          | A leading UTF-8 BOM on a file whose parser anchors at byte zero.                                                                       | Record it as the reason for a `parse_error` when it causes one.                                                                                                  |
| `unmapped_path`            | A path under the source root that the field map does not describe.                                                                     | Record it. Never guess a mapping.                                                                                                                                |
| `privacy_sensitive`        | A path matched by a declared privacy rule — by absolute prefix or by the relative prefix the field map names it with.                  | Excluded from import **and from the archive copy**, counted, and reported with the rule id. A declared rule that matched nothing is reported too. See section 7. |

### 5.1 Corpus census (owner-local observation, structure only)

Observed on the owner-local corpus fingerprinted in section 2. These are counts
and shapes, not content.

| Observation                                              | Value                                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| signal files / index entries                             | 45 / 45, single month bucket, identifier sequence restarts present                                                          |
| declared patterns / distinct pattern identifiers / files | 990 / 294 / 294                                                                                                             |
| destroyed pattern instances                              | **696**, by identifier collision                                                                                            |
| distinct association strengths                           | `[0.4]` — a single value                                                                                                    |
| `adaptiveThreshold.value` vs. minimum strength           | `0.1146` vs. `0.4` → the threshold filters nothing                                                                          |
| `graph.patternCount` / `graph.patterns` / files on disk  | 990 / 153 / 294 — three mutually inconsistent counts                                                                        |
| association grouping categories                          | 22                                                                                                                          |
| `.events/` contents                                      | empty; `.subscriptions.json` absent                                                                                         |
| declared versions                                        | README `v0.2.0-dev`, `plugin.json` `0.1.0`, `hub-manifest.json` `0.3.0`, script headers `v0.3`, skill roadmap `v0.1`–`v0.6` |
| signal bodies delimited by LF                            | **0 of 45**                                                                                                                 |
| signal bodies delimited by CRLF                          | **45 of 45**                                                                                                                |
| pattern bodies delimited by LF                           | 294 of 294                                                                                                                  |
| files failing the first-generation frontmatter anchor    | **45 of 45 signal bodies**, plus 1 profile file (UTF-8 BOM)                                                                 |

The line-ending row is the most consequential cross-cutting finding, and it is
verified at byte level rather than inferred. Every first-generation reader
anchors its frontmatter match on the two-byte sequence `---` + LF:

```js
const m = text.match(/^---\n([\s\S]*?)\n---/);
```

Every signal body on disk begins with `---` + CRLF. The first-generation
system therefore **cannot read the signal bodies it wrote**. Within
`c3be4af` this stays latent because signals reach their consumers through
`.signals_index.json` rather than through the body files; the defect surfaces
for any consumer that reads the bodies directly — including a Legacy importer.
It is the same failure class this repository already recorded as `BP-040`
(Windows checkout newline mismatch), reproduced independently in the
first-generation corpus.

The importer classifies each case as `parse_error` with reason
`format_anchor_mismatch` (line-ending anchor) or `encoding_marker` (BOM). It
records the file and the reason and does not normalise the source in place.

**Coverage boundary of the version row.** The `declared versions` row is an
audit observation across five declaration sites, but `source_metadata_conflict`
is raised only from the two **machine-readable manifests** the field map
classifies as `source_manifest` (`hub-manifest.json` and
`.codex-plugin/plugin.json`). Version strings in `README.md`, in script
headers, and in the skill roadmap are prose: the scanner does not read them,
and the files carrying them are disclosed as `unmapped_path`. That is a real
gap between what the audit observed and what the importer reports, stated here
rather than left implicit — closing it would mean teaching the importer to
parse prose for version strings, which is inference, not reading.

## 6. Import mapping

| First-generation material | Runtime event / object                                                                                        | Provenance |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| signal record             | `legacy.signal.imported`                                                                                      | `declared` |
| pattern record            | `legacy.pattern.imported`                                                                                     | `inferred` |
| graph association         | `legacy.graph-edge.imported`                                                                                  | `inferred` |
| anomaly                   | `legacy.anomaly`                                                                                              | `direct`   |
| import run                | `legacy.import.completed`                                                                                     | `direct`   |
| archive copy              | files under the archive root **except those a privacy rule excluded** + `LegacyArchiveManifest` in the report | `direct`   |

The Bible's section 12 sentence "旧 patterns → candidate asset，不自动
active" describes the destination of a first-generation pattern in the second
generation. The importer delivers the **first** half and stops: it writes
`legacy.pattern.imported` with `inferred` provenance, and it does **not**
create a candidate asset. The importer's writer is the frozen `IMPORTER` role,
whose namespace is `legacy.*` only and which holds no `asset.*` scope, so it
could not create one. Candidate-asset creation is a separate, explicit runtime
step taken by a writer that holds the asset scope — and the second half of the
sentence, "不自动 active", is enforced by the Phase 4 promotion policy, which
no import path can satisfy on its own.

No first-generation pattern may reach `validated` or `active` without that
policy, independent evidence, and human confirmation.

## 7. Privacy rule set (default)

The Bible requires an explicit privacy position rather than a silent one.

- Import is **content-preserving by default for structure** and
  **content-excluding by default for free text**. Signal and pattern _values_
  are stored as declared material; a rule set may mark categories or path
  patterns as sensitive.
- A record matching a sensitive rule is **excluded and counted**, not
  truncated. The report states how many were excluded and by which rule id.
- The exclusion reaches the **archive** as well as the ledger. The archive
  holds bytes rather than a summary of bytes, so a rule that kept a path out of
  the imported families while the archive copied the same material would be a
  nominal control: the exclusion would be reported and the bytes would be
  elsewhere. Excluded paths are absent from the archive and from its manifest.
- The archive copy is written under the configured archive root, never inside
  the repository working tree, and is never staged by Git. That rule is checked
  when the archive is **written** (a confirmed import); a dry run writes nothing
  and is not refused by it.
- The migration does not claim to delete or alter the original source. The
  original directory is read-only input and is left untouched.
- The report contains counts and anomaly classes. It does not contain record
  values.

### 7.1 Absolute paths are disclosed, not hidden

Every path the importer records **inside a record** is root-relative: anomaly
rows, event payloads and the inventory carry the path as the field map names
it, so a report stays portable and does not carry the operator's directory
layout into an event payload.

Three surfaces do carry an absolute host path, and they do so deliberately:

1. the import run's `root`, which names what was read;
2. the archive manifest's `archiveRoot` and each entry's `archivedPath`;
3. the command line's `legacy import` `archive` line and `legacy runs --json`.

They are kept because a migration record that cannot name its own input is not
auditable, and because the ledger already holds the root — redacting it from
the report would make the report disagree with the ledger. The consequence is
that these documents name the operator's home directory. **They are
owner-local operational evidence and are not publication material.** Anything
derived from them that leaves this machine should be reduced to the
root-relative paths and the corpus fingerprint first.

## 8. Non-goals

This map does not claim that the first-generation history can be fully
recovered. It does not re-derive destroyed pattern instances, back-fill the
six absent theory fields, elect a winning version among conflicting
declarations, or treat the category-level association graph as a mechanism
fact. Where the record is gone, the migration reports that it is gone.
