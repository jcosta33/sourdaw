---
type: adr
id: 0009
title: Toaster pattern-morph is deterministic at a 0.5 activation threshold
status: accepted
date: 2026-07-16
owner: The Sourdaw team
sources:
  - .agents/findings/inventory-decisions-backlog.md
  - src/modules/Toaster/useCases/patternMorph.ts
---

# 0009 — Toaster pattern-morph is deterministic at a 0.5 activation threshold

## Context

Toaster pattern-morph originally resolved a step's activation stochastically:
`lerpStep` re-rolled `Math.random()` every tick to decide whether an
interpolated step was on. A held mid-morph therefore flickered and was not
reproducible, and the inventory listed the intended morph model (live re-roll vs
frozen interpolation vs commit-to-A/B) as an open architecture/product call.

Inventory round-2 remediation committed to a **deterministic** morph:
`patternMorph.ts` `lerpStep` now computes the interpolated activation
probability `(A.active ? 1 − t : 0) + (B.active ? t : 0)` and turns the step on
when that value is `>= 0.5`, instead of re-rolling. This is verified in the
current code (`src/modules/Toaster/useCases/patternMorph.ts`, `lerpStep`:
`active: activeProbability >= 0.5`).

This is a deliberate behavioral change from a stochastic morph to a
deterministic one. It resolves the round-1 open call, so it is recorded here —
with an explicit status note that product-owner confirmation is still pending.

## Decision

Toaster pattern-morph is **deterministic** with a **0.5 activation threshold**:

- A step's activation at morph position `t` is the interpolated probability
  `(A.active ? 1 − t : 0) + (B.active ? t : 0)`, on iff `>= 0.5`. At `t < 0.5`
  pattern A's activation dominates; at `t > 0.5` pattern B's does.
- The continuous non-activation fields (`velocity`, `probability`,
  `microTiming`) keep interpolating linearly across the morph.
- Discrete fields (`retriggerCount`, `condition`, `paramLocks`) snap at the 0.5
  midpoint (A below, B at/above).

A held morph position now yields a stable, reproducible pattern rather than a
per-tick re-roll.

## Non-goals

- Do not reintroduce per-tick `Math.random()` re-rolling into the morph path.
- Do not change the interpolation of the continuous fields; only the activation
  resolution was made deterministic.
- Do not decide here whether morph should later offer an opt-in probabilistic
  mode — that would be a new capability, not this contract.

## Open questions

- **Product-owner confirmation (pending).** Confirm that "morph is deterministic
  with a 0.5 activation threshold" is the intended musical contract, versus a
  probabilistic morph that some users may have relied on for generative
  variation. Until confirmed, this ADR is accepted as the shipped behavior but
  flagged for owner sign-off (tracked in `open-decision-docket.md`, Toaster).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Per-tick `Math.random()` re-roll (original) | A held mid-morph flickered and was unreproducible; unsuitable as a stable musical contract. |
| Commit-to-A/B (hard switch at a boundary, no interpolation) | Loses the interpolated velocity/probability/microTiming behavior that gives morph its musical value. |
| Frozen interpolation with a threshold other than 0.5 | 0.5 is the symmetric midpoint where A and B contribute equally; any other threshold biases the morph toward one pattern without justification. |

## Consequences

- Positive: morph output is deterministic and reproducible; a held position is
  stable, which is the behavior a musical morph control implies.
- Negative: users who relied on the old stochastic re-roll for generative
  variation lose that behavior; this is why owner confirmation is still pending.
- Neutral: continuous-field interpolation is unchanged, so only the on/off
  resolution semantics shifted.

## Status

accepted

Records shipped behavior in `patternMorph.ts`. **Pending product-owner
confirmation** that the deterministic 0.5-threshold contract is intended.

## Follow-up work

Obtain product-owner sign-off on the deterministic morph contract. If a
probabilistic morph is still wanted, specify it as an explicit opt-in mode
rather than reverting the deterministic default.

## Affected requirements

- Toaster pattern-morph musical contract (no spec AC exists yet; create one if
  the owner confirms, to lock the deterministic 0.5-threshold semantics).
