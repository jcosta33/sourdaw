---
type: adr
id: 0054
title: Review publication enforces a proportional, machine-checked floor instead of self-attested paperwork
status: accepted
date: 2026-10-22
owner: The Sourdaw team
supersedes:
    - 0050
    - 0053
sources:
    - scripts/reviewDocumentParser.ts
    - scripts/reviewDossierPublication.ts
    - scripts/reviewPublicationBinding.ts
    - scripts/reviewStructuralAdmission.ts
    - scripts/reviewRiskPolicy.ts
    - scripts/reviewRoundEscalation.ts
    - scripts/__tests__/publishReview.spec.ts
    - scripts/__tests__/reviewStructuralAdmission.spec.ts
    - .agents/decisions/0048-attributable-evidence-contract-is-frozen.md
    - .agents/decisions/0050-fired-semantic-signals-carry-a-disposal-duty.md
    - .agents/decisions/0053-freeze-pull-requests-at-five-review-rounds.md
    - https://github.com/jcosta33/sourdaw/issues/5473
---

# 0054 - Review publication enforces a proportional, machine-checked floor

## Context

A fresh reviewer publication required five caller-written documents: `review.json`, a
`stances.json` admission record with a per-draw baseline probe whose `result` had to read
`mutation-detected`, a `dossier.json` input carrying `assessmentImpact` and optional signal
dispositions, a `discarded.json`, and from the third request-changes round a `reassessment.json`.
Every one of them was written by the session whose review it gated, so the publisher could check
their shape and never their truth. A probe that never ran and a probe that ran wrote the same token.

The measurements say the paperwork bought little. ADR 0050 recorded the semantic-assessment
impact across roughly one hundred and ten rounds: `finding-led` zero times. The flat refusal of
fewer than three unique stances applied to every plan, so a documentation typo needed three probed
reviewers. The reassessment gate offered `continue` to the session that kept failing, and PR #4746
spent fourteen rounds with ten `continue` reassessments.

The owner decided on 2026-10-22 to replace the self-attested records with a proportional minimum the
publisher can check from data it controls.

## Decision

`review.json` is the only caller document for a fresh reviewer publication. It carries `draws` —
one `{ stance, reviewerModel, tier, outcome }` per completed draw — and an optional `discarded`
list of `{ finding, reason }`, shape-checked, evidence-safe, and never posted. `review:publish`
derives the canonical `dossier-v1` record itself from `review.json`, the bundle's risk plan, and
live facts, persists it before the POST, and binds the publication and the delivery authorization
into it after. It reads no `stances.json`, `discarded.json`, `reassessment.json`, or caller
`dossier.json` input, and logs one line when a bundle still carries them.

The floor follows the risk plan. A new `docs-only` class, for a change whose every path is
Markdown outside `public/` and `.github/`, earns one stance; `.github/` paths never plan `test-only`
or `docs-only`. Distinct stances across `draws` must reach one for `docs-only` and
`test-only`, two for `small` — product code whose handwritten paths are all under `src/` — and
otherwise three, including a small change to tooling, configuration, build or server code
(`small-tooling`), or every stance the plan's classes earn when they earn fewer. A `realtime-audio`, `native-security`, or `undo` plan also needs one `strongest` draw. The
baseline probe stays a reviewer instruction the orchestrator checks in each report; it is no longer
a publication token. A document whose `reviewerModel`, or any draw's model, matches an authoring
model must still carry `modelExhaustion` and name that model in the body.

The semantic-review publication duties are removed: no fired-signal disposal, `assessmentImpact`,
`assessmentIgnoredReason`, `signalDispositions`, or `semantic-ci <reason>` limitation is required,
and no refusal reads `semantic-ci.json`. The advisory assessment and the CI `Semantic review` check
are unchanged ([0047](0047-advisory-semantic-review-also-runs-in-ci.md)).

The three-round reassessment of [0049](0049-single-approval-review-author-merge.md)'s bounded-rounds
extension and the five-round warning that replaced [0053](0053-freeze-pull-requests-at-five-review-rounds.md)
on 2026-09-27 give way to a hard freeze at five
reviewer-App `REQUEST_CHANGES` rounds, `REVIEW_ROUND_FREEZE_THRESHOLD`: `review:publish` refuses any
fresh reviewer publication, approve or request changes, and tells the operator to respin the change
as a fresh pull request and close the frozen one with `pr:supersede`. `review:repair` and
`review:confirm` stay open. `stances:check` is deleted with the record it judged.

Under [0048](0048-attributable-evidence-contract-is-frozen.md)'s addition-only rule the record format
does not change: records persisted under the earlier contracts, with per-draw exhaustion, discards,
`assessmentImpact`, signal dispositions, or `review-reassessed` events, keep verifying, replaying,
and delivering. Only the retired caller input `dossier-input-v1` and the `stances.json` binding
leave 0048's schema list.

## Consequences

A docs-only fix publishes with one blind draw and a small change with two; the cost of review now
follows the risk the plan measures. The publisher refuses only what it can prove from the record:
missing draws, a floor not met, a specialist plan without a strongest draw, an unknown tier, an
unsafe value, an approval with inline comments, a moved head, and a frozen pull request. Stance
independence and probe execution remain the orchestrator's judgement, stated as such rather than
dressed as machine-checked evidence.

A pull request cannot spend more than five reviewer rounds. A frozen change is respun as one
consolidated diff; the old pull request closes through `pr:supersede` once the replacement merges.

The semantic assessment no longer shapes the publication record. A fired signal the orchestrator
judges real becomes an ordinary finding; one it judges noise costs nothing.
