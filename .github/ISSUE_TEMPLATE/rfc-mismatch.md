---
name: RFC MISMATCH
about: The repository and the plan disagree. This is the required way to say so
title: "[rfc-mismatch] "
labels: rfc-mismatch
---

<!--
Bible section 17 and INV-10: a structural conflict between the implementation
and the plan must be reported as an RFC MISMATCH rather than resolved by
editing the plan, widening an invariant, or writing a passing test around it.

This template is the shape the plan defines. Fill in every section; "we worked
around it" is not an answer to any of them.
-->

## Issue

<!-- ISSUE-XXX, or the Bible section if no issue owns it. -->

## Observed reality

<!-- What the repository actually does. Point at the file and line, or at the
     test that shows it. -->

## Conflicting requirement

<!-- Quote the requirement. Which document, which section, which words. -->

## Why silent compensation is unsafe

<!-- What would be lost or hidden if someone resolved this by changing the
     requirement text, the schema, or the test instead. -->

## Smallest viable options

- **A.**
- **B.**

## Recommended option

<!-- One of the above, and why. -->

## Blocked work

<!-- What cannot proceed until this is decided. -->

## Decision owner

<!-- Who has to decide. For anything structural, that is the repository owner. -->
