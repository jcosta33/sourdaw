---
type: adr
id: 0055
title: Retire automatic semantic review
status: accepted
date: 2026-10-28
owner: The Sourdaw team
supersedes:
    - 0046
    - 0047
sources:
    - .agents/decisions/0046-semantic-review-is-advisory-and-local-first.md
    - .agents/decisions/0047-advisory-semantic-review-also-runs-in-ci.md
    - .agents/decisions/0054-proportional-machine-checked-review-floor.md
---

# 0055 - Retire automatic semantic review

## Decision

Retire the advisory semantic review scanner, provider requests, hosted check, and assessment
retrieval during review preparation. This supersedes ADRs 0046 and 0047 and the remaining advisory
operation described in ADR 0054. Independent human-directed review and the existing publication,
approval, and delivery gates remain in force. Historical dossier records remain readable and
replayable under their original contracts.

## Consequence

Review preparation produces the diff, contracts, size, risk plan, and manifest without querying
or downloading a semantic assessment. The hosted workflow no longer spends provider credits.
