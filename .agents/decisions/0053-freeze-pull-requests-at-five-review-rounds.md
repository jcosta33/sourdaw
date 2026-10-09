---
type: adr
id: 0053
title: A pull request freezes at its fifth review round
status: superseded
date: 2026-09-25
owner: The Sourdaw team
sources:
    - scripts/reviewRoundEscalation.ts
    - scripts/reviewPublicationBinding.ts
    - scripts/__tests__/reviewRoundEscalation.spec.ts
---

# 0053 — A pull request freezes at its fifth review round

## Superseded 2026-09-27

The owner replaced the five-round freeze with an advisory warning. At five reviewer
`REQUEST_CHANGES` rounds and every later count, `review:prepare`, `review:publish`, and
`review:repair` warn the agent to examine review churn and remaining findings. A fresh
publication can continue with a valid, head-bound reassessment and every other existing
publication requirement. The three-round reassessment gate continues at all higher counts.
The context and decision below record the former policy, not the current behavior.

## Context

The escalation threshold (`REVIEW_ROUND_ESCALATION_THRESHOLD`, three reviewer `REQUEST_CHANGES`
rounds) requires the orchestrator to record a reassessment before the next fresh publication and
offers `split`, `respec`, or `continue`. That is advice, not a bound: the orchestrator writes the
reassessment itself, so a session that keeps choosing `continue` can spend an unbounded number of
rounds on one change.

PR #4746 demonstrated the cost. A refusal message plus its spec took fourteen published
`REQUEST_CHANGES` rounds, seventeen commits and fifty-two review objects, with ten reassessments
all reading `continue`. Six of the fourteen findings were real defects in the message — a missing
field blamed on a present one, "incomplete" claimed for a wrong-typed field, a named repair that
`review:prepare` refuses, an unreachable path — and eight were a claim the suite did not observe.
The churn came from repairing one state per round instead of enumerating the change's claims and
states once, and from re-dispatching the same stance menu instead of deriving stances from the diff.
Nothing in the machinery stopped it, because nothing could: the only gate above the threshold was a
document the looping session authored.

## Decision

A pull request freezes at `REVIEW_ROUND_FREEZE_THRESHOLD` — five reviewer `REQUEST_CHANGES` rounds,
in `scripts/reviewRoundEscalation.ts`. At or above it the pre-publication gate refuses a fresh
reviewer publication whatever the bundle carries. No caller document lifts a freeze: not a
reassessment, not any other file the session can write. `review:repair` and `review:confirm` stay
open, because unresolved threads must remain resolvable.

The freeze is flagged in the log — `review-round-freeze:<pr>:request-changes=<n>:threshold=<t>` —
and the round before it is flagged as `review-round-freeze-warning`, so the churn is visible while
there is still a round to spend on consolidation.

The only routes out of a frozen pull request are closing it, stranding its lane, or re-raising the
change in a new lane as one consolidated diff.

## Consequences

A session cannot spend more than five rounds on one pull request, whatever it believes about the
remaining findings. A frozen pull request is a session failure rather than a delivery problem: the
count measures an agent that patched states one at a time instead of enumerating the change's
claims and states up front, and the fix belongs in how the change was scoped, not in more rounds.

The freeze does not by itself close a pull request. Closing one is a deliberate act, so the
mechanism takes the closure route in a following slice; until then a frozen pull request is refused
further review and left for the operator or the session to close.

Below the freeze threshold the escalation contract is unchanged, including its reassessment and its
refusals.
