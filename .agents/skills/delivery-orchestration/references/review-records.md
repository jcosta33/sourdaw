# Review records

## Review bundles and publication

`review:prepare` prints a primary-root bundle path containing `manifest.json`,
`diff.patch`, `review-size.json`, `risk-plan.json`, `pr.md`, and merge-base
`contracts/`. The manifest binds PR, base branch, merge-base, and head. The diff and
deterministic size report use the actual base/head merge-base; handwritten,
test, documentation, and generated changes (including lockfiles) remain visible
as separate groups, and unknown paths count as handwritten. Paths are keyed by
head sha. Re-preparing the same head replaces generated files and preserves
caller files only while the bound base name and merge-base context match; a
populated legacy bundle without base identity cannot be reused. Unrelated
movement of the base tip is allowed when that context is unchanged.

`risk-plan.json` records `format: 'risk-plan-v1'`, the `pr`/`headSha`/`baseSha`
it is bound to, the change's `riskClasses`, the `requiredStances` those classes
earn, and the `triggers` that fired. It is derived from the same path
classification as `review-size.json`, so the plan and the printed size summary
cannot disagree. Classes union when several fire, no class earns a stance
outside its own entry, and parsing recomputes the union from `riskClasses`, so a
hand-edited plan can neither widen nor narrow its own review. The earned stances
name risk surfaces to weigh; the dispatched stances are the orchestrator's
task-derived judgement.

| Class                                                                                       | Earns                                                     | Draw floor |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| `docs-only` (every path Markdown outside `public/`)                                         | correctness                                               | 1          |
| `test-only` (every path a test)                                                             | test-validity                                             | 1          |
| `small` (no specialist surface, within the line budget, handwritten paths all under `src/`) | correctness, test-validity                                | 2          |
| `small-tooling` (the same, with handwritten paths outside `src/`)                           | correctness, module-boundaries, test-validity             | 3          |
| `ordinary` (no specialist surface, over the budget)                                         | correctness, code-craft, module-boundaries, test-validity | 3          |
| `cross-domain`                                                                              | correctness, module-boundaries, test-validity             | 3          |
| `realtime-audio`                                                                            | correctness, realtime-audio, test-validity                | 3          |
| `native-security`                                                                           | correctness, security-platform, test-validity             | 3          |
| `undo`                                                                                      | correctness, project-integrity-undo, test-validity        | 3          |

Every `.github/` path classifies as handwritten whatever its name, so it never
plans `test-only` or `docs-only`, on either side of a rename. Generated paths —
lockfiles and rebuilt wasm artifacts — earn the `realtime-audio`,
`native-security`, and `undo` classes of the tree they sit in, but never count
toward the size budget. The Cargo workspace root `Cargo.lock` and `Cargo.toml`
earn both `realtime-audio` and `native-security`. The Rust toolchain files under
either name, the JavaScript dependency manifests, the native addon build, the
desktop packaging files and entitlements, the fuse, preload and Electron runtime
scripts, and the review tooling that admits CI or feeds the bundle earn
`native-security`; worklet sources under `public/audio/worklets/` and their
generators earn `realtime-audio`. A generated-only change plans `small`. A plan
of several classes needs three distinct stances, or every stance its classes
earn when they earn fewer. Specialist classes keep those stance and evidence
obligations within the same reviewer cost ceiling.

`review:publish` prints the review id and posts as reviewer App only if
GitHub's live head matches the bundle; fresh approvals also require matching
base context. For a plan-carrying bundle it derives the canonical record from
`review.json` and the plan, persists it as `dossier.json` before the POST, and
refuses before any remote write when the plan is missing, malformed, or rebound
from the head/base/pr it must bind; when `review.json` carries no `draws` and no
reusable unpublished record supplies them; when
the draws miss the floor above; when the summary reviewer model or any effective
draw exceeds the review cost ceiling below; or when a value is unsafe. Effective
draws include an unpublished historical dossier reused by a caller document with
no draws. These are fresh-publication gates: exact published replay and recovery
keep their original model and tier metadata without rewriting canonical bytes.
The record is
`format: 'dossier-v1'`: an append-only event chain (`stance-completed` per draw,
`finding-accepted` per inline comment) whose records carry `sequence`,
`previousDigest`, and `digest`, plus `headDigest` and a `dossierDigest` over the
header identity, the approval evidence, and the recommendation. Re-publication of
a head whose record binds its publication replays it unchanged; reviewer
diversity and the freeze are not re-run for that replay, which posts nothing. A
pre-ADR-0054 bundle whose `review.json` has no `draws` falls back to an
unpublished record it already holds. `stances.json`, `discarded.json`,
`reassessment.json`, and a caller-written `dossier.json` are ignored with one
log line, and `semantic-ci.json` is information only.

`review:prepare` logs
`review-round-freeze:<pr>:request-changes=<n>:threshold=<t>` from the pull
request's public review history on every run; `review:repair` logs it only at
or above the threshold. At `REVIEW_ROUND_FREEZE_THRESHOLD` (five
reviewer `REQUEST_CHANGES` rounds, `scripts/reviewRoundEscalation.ts`) the pull
request is frozen: `review:publish` refuses every fresh reviewer publication,
approve or request changes, before any remote write, and names the way out —
respin the change as one consolidated pull request, then close the frozen one
with `pr:supersede` once the replacement merges. `review:repair` and
`review:confirm` stay open.

Legacy tolerance: a bundle with no `risk-plan.json` retains its historical shape.
A fresh publication still meets reviewer cost and diversity rules.

### Headless reviewer dispatch

When the harness cannot select subagent models, run each stance on another agent harness headlessly: one stance per dispatch, read-only, without credentials, with the report returned as text. `reviewerModel` records the model actually run; dispatch never enters the trusted snapshot. If no model permitted by root [Review policy](../../../../AGENTS.md#review) is available, report the blocker.

## Review document formats

### Inline comments (REQUEST_CHANGES)

Read every changed line and surrounding code as needed. Comment on the
defective line with one problem, discussing code rather than author. Use
literal fields `defect`, `consequence`, and `done` for what is wrong, why it
matters, and the required result; retired `body` is refused with an error
naming the replacement. Each field is one non-empty line without edge
whitespace; target one precise sentence, never padding. Tooling space-joins
fields and appends a period where terminal punctuation is absent. The composed
comment must fit 600 bytes, not characters; there is no minimum.

Request changes when this head must not merge, and post every blocking comment
with that review. The summary is a short pointer to those comments, not a
report.

### Round record in review.json

`review.json` is the only caller document. Beside its review fields it carries
`draws`, one `{ stance, reviewerModel, tier, outcome }` per completed blind draw —
several draws on one stance with distinct models count once toward the floor —
with fresh `tier` `economy`/`standard` and `outcome` `clean`/`findings`,
and optional `discarded`, one `{ finding, reason }` per discarded candidate. The
fields are exact; an unknown tier or outcome, a repeated stance-and-model pair,
or an extra field is refused. Discards are shape-checked and never posted or
recorded. The accepted findings are the document's own inline comments.
Canonical historical parsers retain `strongest`; that metadata cannot authorize
a fresh publication and is preserved on published replay and recovery.

Every draw, discard, and approval-claim value must be single-line, trimmed and
bounded, and is refused when it carries a credential-shaped value, a private-key
header, a JWT, a bearer token, or raw session-transcript markers. Private
reviewer prose belongs nowhere in the record.

Records persisted under earlier contracts — with per-draw `exhaustion`,
discards, `assessmentImpact`, `assessmentIgnoredReason`, `signalDispositions`,
or `review-reassessed` events — keep verifying byte-identically and replaying;
fresh publications write none of those fields. Readers of historical review and
acceptance documents are unchanged, and `review:accept` takes no dossier.

### Publication binding, replay, and reconstruction

After the review POST lands, `review:publish` appends `review-published` (the
landed review id) and one `finding-published` per posted comment (its public
comment id, matched to the document positionally after a path/line/side check)
to the head's dossier; a bundle dossier that already records its publication
replays — the exact same review must stand live: actor, head, state, body, and
comments — instead of re-posting, and a recorded publication that no longer
stands exact fails closed before any write. `review:accept` refuses a
plan-carrying bundle whose dossier is missing, records no publication, or
leaves an accepted finding without its public comment binding; a legacy bundle
without a risk plan publishes and accepts exactly as before.

`pnpm review:reconstruct <pr>` is read-only: it rebuilds every governed round
from public channels alone — reviews, review comments, author
`sourdaw-repair-v1` marker replies, and reviewer confirmations — and
shadow-compares each head's local dossier against the
reconstruction (recorded review id, recommendation, and every finding's public
comment binding). Mismatches are logged and counted, never gated; the command
fails only on unreadable public data or a corrupt local record.

Author V1 replies reconstruct as repair records. Historical reviewer V1 replies
remain readable as confirmations, while new confirmations use one canonical
`sourdaw-repair-confirmation-v1` marker containing the pull request, thread,
confirmation head, and SHA-256 digest of the entire canonical author record.
The digest binds the complete evidence and summary without repeating those bytes.
Reconstruction places confirmations beside, not inside, a finding's repair list
and requires their digest to match an author record bound to that pull request,
thread, and root finding. This remains structural evidence, not independent
proof that a runtime repair is true.

### APPROVE: compact-v1 evidence

New APPROVE publication requires `format: compact-v1` and
`evidence: { headSha, claims: [{ observable, verification, observed }] }` in
`review.json`. Bind `headSha` to the reviewed bundle head. Supply at least one
claim, with every value a nonblank, trimmed, single-line string: `observable`
is expected behavior from the request or contract, `verification` is the exact
command, check URL, or source comparison, and `observed` is the decisive result
or excerpt. Keep the body to a short conclusion. Publication posts only that
reviewer-written body; the structured evidence stays unpublished in
`review.json`/`acceptance.json`, bound to the head by `headSha`.
`review:accept` validates only `acceptance.json`'s own head-bound evidence;
`review.json`'s evidence is read by the orchestrator, not by any script. The
posted body must fit 600 Unicode code points; reject excess and report the
actual and allowed lengths, never truncate. Record completeness and head
binding do not prove truthful execution; the orchestrator remains responsible
for verifying the claims.
REQUEST_CHANGES must not carry approval evidence.
Unknown fresh formats fail closed. Historical unversioned documents remain
readable only for exact reconstruction and recovery; never rewrite old bundles
or posted reviews.

Keep detailed logs in the session and the concise head-bound verification
record in structured bundle evidence. The public approval carries only its
short conclusion; the structured evidence never leaves the bundle.

### Stack children

A stack child may receive `REQUEST_CHANGES` while its verified parent branch is
its base. Fresh APPROVE publication requires base `main`; for a
registered child they also require the bundle's live context and proof that
reconciliation contains the recorded parent's landed commit.

## acceptance.json (legacy pre-policy heads only)

`review:accept <pr>` remains readable for pre-policy heads, but it is no longer
part of the delivery flow. The reviewer publication is the delivery
authorization (#4584): a reviewer APPROVE on a plan-carrying bundle records one
`delivery-authorized` event bound to its own just-posted review id and to the
dossier digest, in the same persisted write as the publication bindings.
`review.json` carrying `authorization` is refused. `review:accept` refuses a
plan-carrying head whose dossier already carries that reviewer-recorded
authorization — refusing the duplicate — and keeps working for legacy bundles
without a risk plan. New deliveries never call it.

A pre-policy plan-carrying head is not deliverable and cannot be re-authorized
in place: re-publication replays the recorded publication rather than posting a
fresh reviewer APPROVE, so no reviewer-bound `delivery-authorized` event is ever
recorded. This holds whether the dossier already records the old orchestrator
acceptance authorization (`deliver` refuses its ids, which do not both bind the
live reviewer approval) or records an old-flow APPROVE with no authorization at
all (`deliver` refuses for want of one). Bundles with no `risk-plan.json` stay
exempt and still merge. Such a stuck head needs a new commit and a fresh review
round.

`deliver` consumes the record: a plan-carrying head bundle with no recorded
authorization, an authorization whose digest is not the
dossier-minus-authorization digest, or one whose `reviewId`/`approvalReviewId`
do not both bind the live reviewer approval review refuses delivery before any
merge. Legacy bundles without a risk plan deliver exactly as before.
