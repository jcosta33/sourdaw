---
type: adr
id: 0056
title: Expand the review-round freeze to ten
status: accepted
date: 2026-11-09
owner: The Sourdaw team
sources:
    - .agents/decisions/0054-proportional-machine-checked-review-floor.md
---

# 0056 - Expand the review-round freeze to ten

## Decision

Raise `REVIEW_ROUND_FREEZE_THRESHOLD` from five to ten reviewer `REQUEST_CHANGES` rounds. This
supersedes only the five-round threshold in ADR 0054; its proportional review floor, publication
record, and delivery authorization contracts remain unchanged.

A pull request admits fresh reviewer publication through nine request-changes rounds and freezes at
ten. Repair and confirmation remain available after the freeze so unresolved threads stay resolvable.

## Consequence

A change can spend more review rounds consolidating findings before it must be respun as a fresh
pull request. The freeze flag and refusal message report the new threshold.
