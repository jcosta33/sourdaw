---
type: adr
id: 0049
title: Single reviewer approval authorizes delivery; the author App merges
status: accepted
date: 2026-09-23
owner: The Sourdaw team
sources:
    - scripts/reviewPublicationBinding.ts
    - scripts/deliverPullRequest.ts
    - scripts/pullRequestReviewState.ts
    - scripts/reviewDossier.ts
    - scripts/__tests__/deliverPullRequest.spec.ts
    - scripts/__tests__/threeRoleTransitions.spec.ts
    - scripts/__tests__/publishReview.spec.ts
    - https://github.com/jcosta33/sourdaw/issues/4584
---

# 0049 - Single reviewer approval authorizes delivery; the author App merges

## Context

ADR 0048 froze the attributable evidence contract with a three-entity tail: the reviewer App records
independent review, the orchestrator User records final acceptance through `review:accept`, and the
orchestrator User merges through `deliver`. That two-identity tail concentrates final authority in a
single human credential and makes every ordinary merge depend on a stored user token that must be
present and verified at delivery time.

Campaign #4584 flips the review policy to single approval. The blind multi-stance review itself is
unchanged: the orchestrator still enumerates stances, dispatches several blind draws, adjudicates
findings, and composes one reviewer-App review document from them. What disappears is the
orchestrator's second (acceptance) approval.

## Decision

The reviewer publication IS the delivery authorization. When `review:publish` posts an APPROVE for a
plan-carrying bundle, it records one `delivery-authorized` dossier event bound to its own just-posted
reviewer review id and to the dossier digest, in the same persisted write as the publication
bindings. `deliver` validates only the current-head reviewer-App approval plus zero unresolved
threads, binds both `authorization.reviewId` and `authorization.approvalReviewId` to the live
reviewer approval review, and executes the merge as the immutable author App. `review:accept` stays
working for pre-policy heads and refuses a duplicate against a dossier that already carries the
reviewer-recorded authorization.

## Consequences

No human-owned identity approves or merges an ordinary pull request: the orchestrator User neither
approves, accepts, nor merges. The remaining independent gates are the reviewer App, the required
`Gate` check, the ruleset controls, and the trusted scripts. The stored `jcosta33` credential serves
only the trusted ruleset change, `issue:claim`, and `lane:publish` project membership.

This decision supersedes the two-identity approval and merge clauses of ADR 0048 — the orchestrator
acceptance and the orchestrator merge — while leaving ADR 0048's evidence, provenance, receipt,
adjudication, and repair targets standing.

A pre-policy plan-carrying head is not deliverable and cannot be re-authorized in place:
re-publication replays the recorded publication rather than posting a fresh reviewer APPROVE, so no
reviewer-bound `delivery-authorized` event is ever recorded. This holds whether the dossier already
records the old orchestrator acceptance authorization (`deliver` refuses its ids, which do not both
bind the live reviewer approval) or records an old-flow APPROVE with no authorization at all
(`deliver` refuses for want of one). Bundles with no `risk-plan.json` stay exempt and still merge.
Such a stuck head needs a new commit and a fresh review round.
