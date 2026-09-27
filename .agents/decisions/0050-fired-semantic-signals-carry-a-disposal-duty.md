---
type: adr
id: 0050
title: Fired semantic signals carry a disposal duty at publication
status: accepted
date: 2026-09-26
owner: The Sourdaw team
sources:
    - .agents/decisions/0047-advisory-semantic-review-also-runs-in-ci.md
    - .agents/decisions/0048-attributable-evidence-contract-is-frozen.md
    - scripts/semanticReviewContext.ts
    - scripts/reviewDossierSemanticAssessment.ts
    - scripts/reviewPublicationBinding.ts
    - AGENTS.md
---

# 0050 - Fired semantic signals carry a disposal duty at publication

## Context

[0047](0047-advisory-semantic-review-also-runs-in-ci.md) put the advisory assessment into CI and
[drew its authority boundary](0046-semantic-review-is-advisory-and-local-first.md): a semantic result
can never approve, request changes, resolve a thread, or merge. When the assessment's coverage
projection later became a publication gate, that boundary was kept by making the gate force only an
acknowledgement — the round must cite the assessment or declare it ignored, and nothing more.

The measurement since is that silence won. Across roughly one hundred and ten dossier rounds on this
repository, the recorded impact was `limitation-only` seventy-five times, `none` thirty times,
`stance-changed` four times, and `finding-led` zero times. And the advisory output was not empty:
across fifty-five stored scans, about thirty dispositions read `recommend_investigation`,
concentrated on two rules — `admission_branch_completes_without_asserting` and
`conditional_admission_added`, at probabilities 0.70–0.89. Both rules point at the conditional-admission
escape this repository has already named and documented as standing defect #4441: a UI case whose whole
body sits inside `if (await locator.isVisible().catch(() => false))` reaches its end without asserting
anything. The assessment kept firing the repository's own known weak spot, and no round ever had to say
so. The projection in `semantic-ci.json` carried the withheld scope and the unresolved count, but not
the fired signals, so `review:publish` could not have enforced a naming duty had one existed.

The owner approved changing the ruling on 2026-09-26.

## Decision

The projection gains a bounded, screened `firedSignals` list: each scan signal whose disposition is
`recommend_investigation` is carried as its rule id, path, and probability, capped at the report
summary's own bound with any overflow left in the artifact the record's digest binds, and its strings
refused through the publication-safety screening so a credential-shaped value never reaches the bundle.
A record written before the field existed parses as zero fired signals; a bundle with no
`semantic-ci.json` at all is unaffected.

`review:publish` refuses a fresh publication while any fired signal's citation token
`semantic-signal <ruleId> <path>` appears in none of the three caller-authored documents: a
`stances.json` stance's `admittedBy` line, a `discarded.json` entry's `finding`, or a dossier
`limitations` line. The refusal names the undisposed signal's rule and path. The duty is independent
of the impact field: declaring the whole assessment ignored is not a disposal, because a fired signal
is a specific thing the assessment asked the round to look at, and only naming it disposes of it.

This supersedes one ruling only — that advisory assessment output may be ignored silently. Everything
else about authority stands unchanged and is what keeps the duty safe: the gate can force the round's
record to name what fired, and can never approve, request changes, resolve a thread, or merge. Naming
a fired signal is not conceding it; a stance may dispose of a signal by recording that its admission
line is exactly the mechanism the round attacked, and a discard may dispose of one by recording that
the fired admission is the deliberate #4441 escape, pinned by its own spec.

## Consequences

The silence is no longer free. A round whose assessment fired must write one sentence somewhere in its
published record, or publication refuses before any remote write. On this repository's measured fire
rate — under one fired signal per scan, concentrated on two admission rules — that is one sentence per
round in the common case, spent exactly where the advisory output has been most consistent.

The duty has no calibration behind it, exactly as 0047 recorded: the thresholds are provisional, no
labelled evaluation exists, and naming a fired signal asserts that the round saw it, never that it was
real. That is also why the disposal surfaces are the round's own caller-authored documents and nothing
else — the gate cannot grade the disposal, only refuse its absence, and a vacuous naming is left to
the same orchestrator judgement that grades every stance admission.

The projection is deliberately asymmetric: the fired signals travel, the model's reasoning, outcome
bands, and categories do not. Feeding a downstream reviewer the assessment's judgements anchors it,
which 0047's sidecar separation already guards; the fired-signal list names only where and how
strongly something fired, which is the minimum a disposal duty can be written against.
