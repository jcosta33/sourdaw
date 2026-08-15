---
type: adr
id: 0026
title: 'The agent owns the codebase and operates by exception'
status: accepted
date: 2026-08-15
owner: The Sourdaw team
sources:
  - https://doi.org/10.1007/s10664-024-10456-6
  - https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bird2011dtm.pdf
  - https://dl.acm.org/doi/10.1109/3468.844354
  - https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders
  - https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/
  - https://dora.dev/capabilities/trunk-based-development/
---

# 0026 — The agent owns the codebase and operates by exception

**Accepted 2026-08-15.** Ratified by the product owner in session; supersedes the "Team Lead"
policy merged in #1962. The root `AGENTS.md` "Ownership" section is the operative text; this ADR
records why it says what it says.

## Context

Sourdaw is built by one product owner directing agent sessions. The recurring failure was not bad
code — it was the agent behaving like a task executor rather than an owner: asking permission for
settled questions, documenting defects instead of fixing them, leaving encountered rot as "out of
scope", writing docs that enumerate state instead of stating contracts, and surfacing every
judgment call to the owner. The owner's direction: operate as the principal engineer of the whole
codebase, and structure delegation so that only product decisions ever reach them.

The question was how to encode that durably, on evidence rather than sentiment.

## Evidence

**Rot propagates itself.** A controlled experiment (29 developers, mixed methods) found existing
technical debt causally increases the debt developers introduce while extending a system — more
re-implementation, worse naming, more smells, at ≥95% credible intervals (Levén, Broman, Besker &
Torkar, *EMSE* 29:73, 2024). Leaving a defect in place is not neutral: it degrades every later
change made near it. Code-imitating agents strengthen the effect — they reproduce the idiom around
them, rot included. This makes fix-on-sight an empirical duty, not tidiness.

**Concentrated ownership predicts quality.** Across Windows Vista and 7, components with a strong
top owner had fewer pre- and post-release failures, and the number of low-expertise minor
contributors was the strongest defect predictor (Bird, Nagappan, Murphy, Gall & Devanbu, FSE 2011;
replicated at Microsoft and by McIntosh et al., ICSE 2016). Delegated agents are minor
contributors by construction. The consequence is not "do not delegate" — it is that the owner
reviews and integrates every delegated change, and accountability never transfers downward.

**Review alone is a weak gate.** Modern code review finds fewer defects than everyone — including
reviewers — expects; its measured value is knowledge transfer and awareness, and rigorously
reviewed components still ship defects (Bacchelli & Bird, ICSE 2013; McIntosh et al., *EMSE*
2016). So a reviewer's approval is never sufficient evidence for a delegated change. The evidence
that counts is executable: a test that fails when the fix is reverted, a measurement at the
boundary users hear. This repo already learned that lesson locally (ADR 0015, the daw-dsp
measurement rules); the finding generalizes it.

**Management by exception is the correct supervision mode.** The canonical human-automation
framework (Parasuraman, Sheridan & Wickens, *IEEE Trans. SMC-A* 30(3), 2000) distinguishes
management by consent — the human approves each act — from management by exception — the system
decides and acts, the human is informed of exceptions and retains override. Consent-mode makes the
principal the bottleneck and was the failure being corrected.

**Only one-way doors go up.** Reversible decisions should be made quickly, low in the
organization, at ~70% of the information one would like; applying the heavyweight process to them
is the named organizational failure mode. Irreversible-and-consequential decisions get
deliberation and the principal (Bezos, Amazon shareholder letters 2015 and 2016).

**Small batches, few lanes, merge promptly.** Teams with three or fewer active branches that merge
to trunk at least daily deliver faster and more stably across the DORA dataset (Forsgren, Humble &
Kim, *Accelerate*; dora.dev). Multi-agent studies find the dominant failure mode is the
orchestrator's decomposition and missing validation between plan and execution — not worker
execution — so the owner's leverage is precise task specs and structured verification, not more
workers.

## Decision

The root `AGENTS.md` "Ownership" section encodes the model:

1. The agent is the principal engineer and owns the codebase end to end; the user is the CEO and
   owns the product.
2. Management by exception: decide, act, deliver. Escalate only one-way doors with product
   consequence, as options plus a recommendation.
3. Fix encountered defects on sight in their own lane; file only genuinely separate, sizeable
   work, with enough context to execute cold. Never document around a defect.
4. Docs state contracts that hold under change — no counts, no inventories, no quirk catalogs.
5. Delegated changes get owner review against their spec plus discriminating executable evidence
   before merge.
6. Small batches, few live lanes, prompt merges.

## Consequences

The owner stops hearing about anything reversible. Encountered rot stops accumulating in docs,
dockets and "known drift" notes — its two terminal states are fixed or filed-with-context. Doc
sections that enumerate repository state are defects against rule 4 and get removed as touched.
The review-stance discipline in Delivery is unchanged; this ADR adds the evidence bar those
reviews must clear, not a new process.
