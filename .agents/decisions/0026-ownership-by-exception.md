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
  - https://s2.q4cdn.com/299287126/files/doc_financials/annual/2015-Letter-to-Shareholders.PDF
  - https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders
  - https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/
  - https://link.springer.com/article/10.1007/s10664-015-9381-9
  - https://arxiv.org/abs/2503.13657
  - https://dora.dev/capabilities/trunk-based-development/
---

# 0026 — The agent owns the codebase and operates by exception

**Accepted 2026-08-15.** Directed by the product owner and delivered through PR #1966, whose
thread is the ratification record; supersedes the "Team Lead" policy merged in #1962. The root
`AGENTS.md` "Ownership", "Docs" and "Delivery" sections are the operative text; this ADR records
why they say what they say.

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
top owner had fewer failures — the effect is strongest pre-release; Windows 7 post-release was
directional but not significant — and the number of low-expertise minor contributors correlated
with failures more strongly than any standard metric Microsoft collects in three of four failure
categories (Bird, Nagappan, Murphy, Gall & Devanbu, FSE 2011; replicated by Greiler, Herzig &
Czerwonka, MSR 2015, and Thongtanunam et al., ICSE 2016). Delegated agents are minor contributors
by construction. The consequence is not "do not delegate" — it is that the owner reviews and
integrates every delegated change, and accountability never transfers downward.

**Review alone is a weak gate.** Modern code review finds fewer defects than everyone — including
reviewers — expects; its measured value is knowledge transfer and awareness, and rigorously
reviewed components still ship defects (Bacchelli & Bird, ICSE 2013; McIntosh et al., *EMSE*
2016). So a reviewer's approval is never sufficient evidence for a delegated change. The evidence
that counts is executable: a test that fails when the fix is reverted, a measurement at the
boundary users hear. This repo already learned that lesson locally (ADR 0015, the daw-dsp
measurement rules); the finding generalizes it.

**Management by exception is the correct supervision mode.** The canonical human-automation
framework (Parasuraman, Sheridan & Wickens, *IEEE Trans. SMC-A* 30(3), 2000) separates
approve-before-execution from act-with-veto on its automation-level scale; the aviation-automation
literature names these management by consent and management by exception (Billings, *Aviation
Automation*, 1997). Under exception mode the system decides and acts, and the human is informed of
exceptions and retains override. Consent mode makes the principal the bottleneck and was the
failure being corrected.

**Only one-way doors go up.** Reversible decisions should be made quickly, by individuals or small
groups close to the work, at ~70% of the information one would like; applying the heavyweight
process to them is the named organizational failure mode. Irreversible-and-consequential decisions
get deliberation and the principal (Bezos, Amazon shareholder letters 2015 and 2016).

**Small batches, few lanes, merge promptly.** Teams with three or fewer active branches that merge
to trunk at least daily deliver faster and more stably across the DORA dataset (Forsgren, Humble &
Kim, *Accelerate*; dora.dev). Multi-agent failure taxonomies find specification and verification
failures dominate over individual agent capability (Cemri et al., "Why Do Multi-Agent LLM Systems
Fail?", arXiv:2503.13657), so the owner's leverage is precise task specs and structured
verification, not more workers.

## Decision

The root `AGENTS.md` "Ownership", "Docs" and "Delivery" sections encode the model:

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
sections that enumerate repository state are defects against rule 4: fix or file the underlying
defect before the note is removed, never delete the note as compliance. A note pinning a measured,
test-guarded, deliberately accepted state is a contract, not drift, and stays. The review-stance
discipline in Delivery is unchanged; this ADR adds the evidence bar those reviews must clear, not
a new process.
