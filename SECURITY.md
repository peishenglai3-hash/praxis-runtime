# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

The channel is GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on this repository). It was enabled on
2026-09-17 and is the preferred route.

If it is unavailable, open a minimal public issue that says only that you have
a security report and asks for a private channel. Do not include the details,
the payload, or the steps to reproduce in that issue.

Include what you can: what you did, what happened, what you expected, the
version or commit, and the smallest reproduction you have. A partial report is
more useful than a withheld one.

This is a pre-alpha research project maintained by one person. There is no
response-time commitment, no bounty, and no support contract. Reports will be
acknowledged and handled as time allows, and the fix will be recorded in
[`docs/断点记录.md`](./docs/%E6%96%AD%E7%82%B9%E8%AE%B0%E5%BD%95.md) with the
rest of the project's failure history.

## Repository security controls

Inspected and changed on 2026-09-17, during Phase 6B, under the owner's
authorisation to execute the minimum changes where admin capability existed and
nothing required a plan migration or incurred billing. All of these are free on
a public repository.

| Setting                             | State       | Why it matters                                                                                                              |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Secret scanning                     | **enabled** | The repository is public and its history is immutable. Scanning is how a future accidental commit is caught.                |
| Secret scanning **push protection** | **enabled** | The highest-value control: it blocks the commit rather than reporting it afterwards.                                        |
| Private vulnerability reporting     | **enabled** | Without it this file's first instruction cannot be followed.                                                                |
| Dependabot alerts                   | **enabled** |                                                                                                                             |
| Dependabot **security updates**     | disabled    | Available, deliberately off: it opens pull requests automatically, which is a workflow change rather than a visibility one. |
| Non-provider secret patterns        | disabled    | Available; not enabled.                                                                                                     |
| Secret-scanning validity checks     | disabled    | Available; not enabled.                                                                                                     |

A full-history audit of all 518 text blobs across every ref was run on
2026-09-17 and found no credential of any kind. That is the difference between
"nothing leaked" and "nothing can leak quietly" — the second is what these
controls buy.

**One hazard was removed before push protection was enabled.** The Phase 6B
conformance suite needs credential-shaped values to prove that redaction works,
and its first draft wrote them as literals — which is exactly what push
protection blocks, meaning the test written to prove secrets do not leak would
have blocked the push that carried it. The values are now assembled from
fragments at runtime, so the test stays realistic and the repository stays
pushable.

## What the security boundary actually is

Read this before reporting, because several things that look like
vulnerabilities are documented boundaries rather than defects.

**Authorization is a local capability check, not an identity system.** The
runtime authorizes a `WriterContext` — a declared writer identity with a role
and a list of capability scopes — and it separates the declared actor from the
writer that actually recorded the event. That is a guard against one component
of the runtime silently writing outside its remit. It is **not**:

- OS-level process isolation,
- an authenticated control plane,
- enterprise IAM, OAuth, or an account system,
- protection against a hostile process running as the same user.

A local process that can open the SQLite file can write to it. That is a known
and accepted property of a local-first design, recorded in
`docs/ADR/ADR-0008-phase35-writer-identity-acl.md`. A report that amounts to
"a local attacker with file access can modify the database" is describing the
design, not a bug.

**Deletion is honest about its limits.** `privacy purge` removes a session's
payloads and leaves a minimal tombstone that does not contain the deleted
content. It cannot reach copies that already left the machine — a Git remote, a
filesystem backup, a synced folder. The runtime says so rather than implying
otherwise.

**`node:sqlite` is experimental** in the pinned Node.js `22.13.0`. That is the
upstream release's own classification and is not a defect in this project.

## Secrets

- `praxis.config.json` must not contain secrets. It is versioned, strict, and
  rejects unknown fields; provider secrets belong in OS environment variables
  or a secret store.
- Event payloads must not contain secrets. The event ledger is append-first:
  a secret written into it cannot be edited away, only purged.
- The core CI workflow requires no secrets and runs on GitHub-hosted runners
  with `contents: read`. Provider live tests, if any are ever added, belong in
  a separate workflow that is never a required gate.

## If you find a secret in this repository or its history

Report it privately through the channel above. Do not open a public issue
quoting it, and do not open a pull request that "removes" it — rewriting
history is deliberate here and requires the owner's explicit authorisation.
