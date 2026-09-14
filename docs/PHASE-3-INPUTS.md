# Phase 3 / Phase 4 Human Inputs

This file distinguishes author/operator decisions from implementation work. The items below cannot be responsibly invented from the Bible, The Final documents, the public first-generation repository, or an AI-generated fixture. Synthetic values may keep Phase 3 tests running, but they do not close the Phase 4 entry gate.

## Required before Phase 4

| Input                        | Why the owner must provide it                                                                                                                                      | Current status             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Trusted writer identity      | The current event envelope records a declared actor. It does not prove which process or person actually wrote the event.                                           | `OWNER INPUT REQUIRED`     |
| Role/scope/ACL matrix        | The system needs explicit permissions for human, agent, system, tool, and model actors, including cross-agent mailbox access and denied operations.                | `OWNER INPUT REQUIRED`     |
| Human-control semantics      | Define inspect, contest, disable, restore, fork, export, purge, stop/exit, confirmation levels, emergency stop, and the audit record for each.                     | `OWNER INPUT REQUIRED`     |
| External-verification policy | Define which outcomes may use a verifier, what evidence is acceptable, who can reject an internal result, and how conflicts are recorded.                          | `OWNER INPUT REQUIRED`     |
| Author-owned golden cases    | Supply sanitized cases with expectation, observation, context exposure, feedback, human explanation, counterexample, model/provider/version, and desired handling. | `OWNER INPUT REQUIRED`     |
| Production assembly          | Set data directory, backup/lock/recovery policy, clock and ID source, default actor, config loading, daemon lifecycle, transport, and operator behavior.           | `OWNER INPUT REQUIRED`     |
| Privacy and purge boundary   | Decide retention, redaction, export, irreversible purge, derived-data rebuild, source-document separation, and any legal constraints.                              | `OWNER INPUT REQUIRED`     |
| Node 22 runner path          | Provide an accessible official Node `22.13.0` runner or approve the private CI/source-upload condition needed to obtain it.                                        | `PENDING / OWNER DECISION` |

## What can proceed with synthetic material

Phase 3 can and does use deterministic fixtures to verify that:

- an outcome baseline must be declared;
- timing requires subscription, sequence lag, and staleness;
- rule checks are limited to declared requirements;
- automatic effect remains `unknown`;
- reflection stops without new evidence, obeys hard budgets, and only proposes;
- concurrent identical logical operations are idempotent while mismatched event contents conflict;
- low-level context-event writes cannot bypass the plan/source lineage checks.

These tests demonstrate implementation behavior, not authorial correctness of a real production policy.

## Boundary not to misread

`requiredPermission` on a Reflection action is currently descriptive metadata. It is not an ACL check, a human confirmation, or an execution grant. The current `Phase3Runtime` records a proposal only; it does not execute the recommended action or promote any asset. Phase 4 must not proceed by treating that label as authorization.

## Owner handoff format

When supplying an input, preserve the original material and identify its status as one of:

1. direct author/operator decision;
2. external verification or artifact evidence;
3. implementation proposal;
4. unresolved dispute or unknown.

The repository should receive only the minimum sanitized contract/fixture needed for testing. Original The Final documents, credentials, private conversations, and unsanitized historical records remain outside the code repository unless a separate explicit publication decision is made.
