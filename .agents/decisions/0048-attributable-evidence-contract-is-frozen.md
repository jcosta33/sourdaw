---
type: adr
id: 0048
title: The attributable review-evidence contract is frozen
status: partially superseded by 0049 (source-attestation channel only)
date: 2026-09-21
owner: The Sourdaw team
sources:
    - scripts/canonicalRecord.ts
    - scripts/sourceAttestation.ts
    - scripts/reviewDossier.ts
    - scripts/reviewDossierPublication.ts
    - scripts/reviewApprovalFormat.ts
    - scripts/reviewRiskPolicy.ts
    - scripts/reviewRepair.ts
    - scripts/findingLineage.ts
    - scripts/pullRequestMutationLock.ts
    - scripts/reviewPublicationBinding.ts
    - scripts/reconstructReviewRounds.ts
    - scripts/__tests__/canonicalRecord.spec.ts
    - scripts/__tests__/sourceAttestation.spec.ts
    - scripts/__tests__/reviewDossier.spec.ts
    - scripts/__tests__/reviewDossierPublication.spec.ts
    - scripts/__tests__/publishReview.spec.ts
    - scripts/__tests__/deliverPullRequest.spec.ts
    - https://github.com/jcosta33/sourdaw/issues/3367
    - https://github.com/jcosta33/sourdaw/issues/3369
    - https://github.com/jcosta33/sourdaw/issues/3372
    - https://github.com/jcosta33/sourdaw/issues/3375
---

# 0048 - The attributable review-evidence contract is frozen

## Context

The three-entity governance migration (#3367 spec, #3369 plan) makes every agent-authored pull
request attributable to an orchestrator, an implementation author, and blind reviewers. Its AC-006
requires that author-controlled branch content never create, alter, omit, supersede, or authorize
the durable evidence delivery relies on. By the time this freeze landed, the machinery had been
built piecemeal across predecessor packets — the dossier record (#2999), exact-owner lock recovery
(#3371), visible receipts (#3374), author-App lane commits (#4444), and typed stance admission
(#4484) — with each schema pinned by its own module docstring and specs, but no single record of
what the contract _is_: which schemas exist, which channel each lives on, and which rules bind
writers and readers. Without that freeze, later waves (source attestation, adjudication
persistence, transition enforcement) would each have had to re-derive the boundary they build on.

## Decision

The attributable evidence contract is frozen as follows. Later migration waves extend it by
addition only; changing a frozen shape means a new format version beside the old, with the old
reader retained.

**Schemas and versions.** Exactly these formats carry review and delivery evidence:

- `dossier-v1` — the canonical, hash-chained review dossier (`reviewDossier.ts`): per-draw stance
  completions, accepted and discarded finding dispositions, bounded evidence and limitations,
  `headDigest` and `dossierDigest` over the head-bound header.
- `dossier-input-v1` — the caller-authored input the publisher assembles into `dossier-v1`
  (`reviewDossierPublication.ts`), validated against the bundle's `risk-plan-v1` and the review
  document before any remote write.
- `compact-v1` — approval evidence claims in `review.json` / `acceptance.json`
  (`reviewApprovalFormat.ts`); the structured evidence stays in the bundle and only the short
  conclusion is posted.
- `risk-plan-v1` — the generated risk classification a bundle is prepared with
  (`reviewRiskPolicy.ts`).
- `stances.json` — the caller's pre-dispatch stance record; when a bundle carries it, the dossier
  publication gate binds the record's draws to it one-to-one as sets of stance names
  (`reviewDossierPublication.ts`).
- The `sourdaw-*-v1` marker-line records — repair records, confirmation, finding lineage, and the
  source attestation (`sourceAttestation.ts`), which binds every exact commit OID above the
  comparison base and its observed Git authorship to the published head — all framed by the one
  marker grammar in `canonicalRecord.ts`. **Retired 2026-09-23 by
  [0049](0049-retire-the-source-attestation-comment.md) (accepted, superseding this item): the
  comment channel has no live writer, and the authorship gate remains.**
- Delivery receipts (`prContract.ts`): HTML-comment records with their own v1/v2 grammars, not
  marker lines — v2 carries a visible summary plus a hidden canonical payload, and v1 HTML-only
  receipts remain readable.
- The mutation-lock owner blobs and recovery journals (`pullRequestMutationLock.ts`) on
  protected-primary git refs.

**Channels.** Every evidence value lives on exactly one of three channels:

- _Protected public_: GitHub records posted by an immutable designated identity — reviewer-App
  reviews, orchestrator-User acceptance, author-App repair records and receipts. Readers validate
  the immutable actor node ID, the bound head, ancestry, and the canonical payload before trusting
  a record, and paginate every remote read.
- _Restricted_: the primary-root review bundle (`review-bundles/<pr>-<headSha>/`), read and written
  only by trusted scripts running from the protected primary checkout. No evidence reader sources a
  file from a lane worktree.
- _Author-controlled_: lane branch files, commit messages, PR bodies, and prose by any other actor.
  This content is the _object_ of review, never evidence. The marker grammar ignores prose that
  merely mentions a marker token, payload parsing refuses anything but the canonical byte form, and
  record readers refuse foreign-actor markers.

**Rules.** One canonical byte form per record (key-sorted, whitespace-free JSON; duplicate or
reordered keys refused at parse). Hash chains cover sequence, predecessor digest, and payload, so
edit, deletion, reorder, and forgery mutations fail verification. Caller-authored strings are
single-line, trimmed, byte-bounded, and refused when credential- or transcript-shaped. Unknown
format versions fail closed. An indeterminate remote mutation retains its exact owner until
domain-specific reconciliation proves the result; the recovery journal survives a crash between
preparation and the public event.

**Verification.** The contract's behaviors are pinned by exact focused specs:
`canonicalRecord.spec.ts` (byte form and marker grammar, including planted-prose and
duplicate-key refusal), `reviewDossier.spec.ts` (round-trip, hash-chain edit/delete/reorder/
forgery, predecessor-digest, redaction, size bounds, head rebinding), `reviewDossierPublication
.spec.ts` (input assembly, replay idempotence, stance-record correspondence),
`publishReview.spec.ts` (live-head binding, recovery journal across crash, legacy adapters,
paginated reads), `repairReviewFinding.spec.ts` / `confirmReviewRepairs.spec.ts` (foreign-actor
marker refusal, thread and comment pagination), `sourceAttestation.spec.ts` (record round-trip,
canonical byte form, exact-OID binding, foreign-actor marker refusal, newest authority), and
`deliverPullRequest.spec.ts` (immutable
actor identities, wrong-head and wrong-actor approvals ignored, receipt ordering). The source
attestation and `sourceAttestation.spec.ts` were deleted on 2026-09-23 by
[0049](0049-retire-the-source-attestation-comment.md); the rest of this verification record stands.

## Consequences

New evidence kinds — source attestation (#3373), persisted adjudication (#3375), transition
enforcement (#3376) — must ride these channels and rules or introduce a new additive format
version; they may not relax the canonical-byte, redaction, actor-binding, or recovery rules, and
they may not move evidence onto author-controlled content. Historical v1 artifacts stay readable
through their explicit adapters; this freeze changes no writer, no CI policy, and no delivery gate.

## Extension — publication binding and adjudication persistence (2026-09-22, #3375)

Under the freeze's addition-only rule, `dossier-v1` gains two event kinds: `review-published`
(binding the landed public review id) and `finding-published` (binding each accepted finding to its
public comment id within that review). `review:publish` appends them after the POST lands and
verifies the landed comment shape against the document positionally
(`reviewPublicationBinding.ts`); a rerun whose dossier already records the publication replays it —
the exact same review must stand live, actor, head, state, body, and comments — instead of posting
a duplicate, and a record that no longer stands exact fails closed. A record claiming the canonical
format whose chain does not validate is corrupt evidence, never fresh input. `review:accept`
refuses a plan-carrying bundle whose dossier is missing, records no publication, or leaves an
accepted finding unbound; legacy bundles without a risk plan publish and accept exactly as before.
`review:reconstruct` rebuilds every governed round from public channels alone — reviews, comments,
and repair markers — and shadow-compares each local dossier against that reconstruction, recording
mismatches without gating (`reconstructReviewRounds.ts`). No existing event kind, digest rule, or
channel assignment changed; dossiers written before this extension parse unchanged.

## Extension — three-role transition enforcement (2026-09-22, #3376)

Under the same addition-only rule, `dossier-v1` gains one event kind: `delivery-authorized`, binding
the orchestrator's delivery intent to the landed acceptance review id, the acceptance-time dossier
digest, the observed unresolved-thread count, and the literal intent `deliver`. `acceptance.json`
carries the matching `authorization` block (refused in `review.json`); `review:accept` refuses a
plan-carrying bundle when the block is missing, mismatched to the dossier, or duplicating a recorded
authorization, then appends the event after the acceptance POST lands. The parse-level invariants
admit at most one authorization, only after the recorded publication, binding exactly that
publication as the approval. `deliver` consumes the record: a plan-carrying head bundle without a
recorded authorization, with a digest that is not the dossier-minus-authorization digest
(`authorizedEvidenceDigest`), or bound to anything but the live orchestrator acceptance review is
refused; legacy bundles without a risk plan deliver exactly as before. The review-state read gains
`databaseId` so the live acceptance's numeric id can be bound, and the deliver trusted closure pins
the dossier modules it now reads. `threeRoleTransitions.spec.ts` pins the cross-role matrix —
author, reviewer, and orchestrator approvals are never interchangeable, and an acceptance left
behind on a stale head authorizes nothing.
