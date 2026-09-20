---
name: delivery-orchestration
description: >-
    Operate Sourdaw's trusted review and delivery scripts — lane:publish,
    review:prepare, review:publish, review:accept, review:repair, review:confirm,
    review:resolve, deliver,
    pr:supersede, branch:prune — with the delivery lock, crash recovery,
    receipts, review and acceptance document formats, thread resolution, and
    the launcher snapshot trust boundary. ALWAYS load when running any review
    or delivery trusted script or recovering a crashed delivery, even for a
    single command.
---

## Purpose

Root `AGENTS.md` states the delivery rules: trusted scripts only, identity
immutability, workflow boundaries, review blindness, post-before-repair. This skill
holds the procedure an orchestrator needs at the moment it runs those scripts.

## Command reference

| Need                         | Command                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open a lane                  | `pnpm lane:open [issue] [slug] [--model <model>] [--stack-on <absolute-parent-lane>]`                                                                                                         |
| Claim the lane's issue       | `pnpm issue:claim <issue>`                                                                                                                                                                    |
| Sync a dependent lane        | `pnpm lane:sync-parent --lane <absolute-child-lane>`                                                                                                                                          |
| Push; open or update the PR  | `pnpm lane:publish <issue \| --lane <absolute-path>> [--relates] [--summary "<text>"] [--test "<instructions>"] [--model <model>] [--milestone <title>] [--project <title>] [--label <name>]` |
| Write the review bundle      | `pnpm review:prepare <pr>`                                                                                                                                                                    |
| Post `review.json`           | `pnpm review:publish <pr>`                                                                                                                                                                    |
| Post final `acceptance.json` | `pnpm review:accept <pr>`                                                                                                                                                                     |
| Record a repair, leave open  | `pnpm review:repair <pr> --thread <thread-id> --head <full-sha> --commit <full-sha> --summary "<one line>" [--evidence <path-to-json>]`                                                       |
| Confirm repairs, resolve     | `pnpm review:confirm <pr> --head <full-sha>`                                                                                                                                                  |
| Reply `Done` and resolve     | `pnpm review:resolve <pr> --thread <id> --head <sha>`                                                                                                                                         |
| Squash-merge                 | `pnpm deliver <pr>`                                                                                                                                                                           |
| Recover a crashed delivery   | `pnpm deliver --recover-lock <pr> --owner <oid>`                                                                                                                                              |
| Recover a wedged review post | `pnpm review:publish:recover <pr> --owner <oid> [--attest-absent]`                                                                                                                            |
| Close a superseded PR        | `pnpm pr:supersede <old> --head <old-sha> --replacement <merged> --lineage <path-to-json>`                                                                                                    |
| Prune spent remote branches  | `pnpm branch:prune [--apply] [--limit <n>]`                                                                                                                                                   |
| Remove a spent lane          | `pnpm lane:remove <path>`                                                                                                                                                                     |
| Strand an abandoned lane     | `pnpm lane:strand <path> --reason "<text>"`                                                                                                                                                   |
| Prune lane artifacts         | `pnpm lane:prune <path> \| --all \| --stale-days <days>`                                                                                                                                      |

`pr:supersede` refuses to close a superseded pull request until every live
review thread on it has exactly one recorded disposition on the replacement.
Each finding is the decimal database id of a review thread's root comment, as
GitHub reports it. The caller writes that total map as a `FindingLineage` JSON
document and passes its path with `--lineage`; both the bare JSON object and the
rendered marker form are accepted, `oldPr`/`replacementPr` must match the
invocation, and a missing, unreadable, or malformed file refuses with the path.
The transaction then posts the receipt plus a second lineage marker, converges
duplicates to exactly one of each, and closes only afterwards, so a re-run after
a partial transaction repairs rather than duplicates.

`branch:prune` defaults to dry run and deletes only branches whose every PR is
merged or closed. It retains a branch that is the last remote holder of a
measurement source revision a tracked table records, because the admission
resolves that revision by SHA and squash delivery never lands the lane head on
`main`. A recorded revision the remote independently confirms is gone is
reported by name and skipped, so one stale table entry cannot abort the run; a
branch that merely cannot be compared holds nothing and is passed over, while
any comparison that cannot be answered still refuses and deletes nothing.

## Claim at lane open

Two agents taking the same work waste both. Before `lane:open`, read
`git worktree list` and `gh pr list --state open` for a lane or PR already on
the same issue or surface; a lane or PR you did not open is another agent's
claim and is read-only for you.

An issue-bound lane claims its issue in the same step: `lane:open` prints
the command, and `pnpm issue:claim <issue>` — run from the protected
primary checkout — adds the `status:active` label, removes every other
`status:` label, and moves every board item holding the issue to In
progress, reading the project's field and option ids live. The script
refuses an issue that already carries `status:active`, making an existing
claim visible before work starts; the check is read-then-write, not
atomic, so the survey before `lane:open` remains the guard against two
claims racing in one window. After delivery, verify the issue is closed
and the board item reads Done; project automation may not move it.

An issueless lane's worktree and PR are the claim: choose a slug that names
the change precisely and publish early, before the head is final if
needed. Work that outlives one lane or session — a campaign, or a hand-off to
another agent — is filed first so each lane binds to the issue that
carries it; a change one lane can land stays issueless.

## Script order

The delivery sequence, in order:

1. `lane:publish` — push the lane and open or update the PR (mechanics below).
   It pushes without `--force` and refuses uncommitted changes: the publishing
   session commits the work itself with a conventional subject first.
2. Wait for `Gate` on the head, then `review:prepare <pr>` — write the bundle
   (below) and dispatch blind reviewers against it under the root Review rules.
   A head that conflicts with its base gets no GitHub merge ref, so no
   `pull_request` workflow run is created and `Gate` can never appear: waiting
   on it waits forever. When `lane:publish` reports a conflicted head, read
   `gh pr view <pr> --json mergeable` and resolve the reported paths with a
   push before waiting; an `UNKNOWN` answer is GitHub still computing, so check
   it again rather than treating it as a conflict.
3. Validate every finding, write `review.json` (and `discarded.json` for
   discards), then `review:publish <pr>` — post validated blockers as the
   reviewer App BEFORE dispatching any repair.
4. After the author pushes a fixed head, `review:repair` records the repair per
   thread and leaves the thread open; let the reviewer confirm it with
   `review:confirm <pr> --head <sha>`, then obtain a fresh review round.
5. On an APPROVE round, write `acceptance.json` beside `review.json`, then
   `review:accept <pr>` — final acceptance as the orchestrator User.
6. `deliver <pr>` — squash-merge after both validation points (below).

Each script validates its own preconditions and refuses rather than repairs:
`review:publish` posts only when GitHub's live head matches the bundle;
`review:accept` requires the reviewer Bot's current-head approval and all
threads resolved; `deliver` refuses `BLOCKED`, non-`main` bases, and unstable
reads (below).

## lane:publish mechanics

An issue number resolves its lane by branch prefix; `--lane` names an exact
absolute lane root, which is what disambiguates write-disjoint lanes sharing
one issue.

For conforming `agent/` lanes, `lane:publish` opens a PR titled from the newest
non-merge commit above `origin/main`; it refuses lanes lacking one and never
retitles existing PRs, including after follow-up commits or merges. The body
follows [`.github/pull_request_template.md`](../../../.github/pull_request_template.md);
the script controls format and rejects malformed bodies. New PRs require
explicit `--summary` and `--test`; later supplied flags replace their section,
omitted flags preserve it. Publishing neither enables auto-merge nor posts
reviews.

`lane:publish` targets `main` for ordinary lanes and the verified parent branch
for registered stack children.

Labels and milestone are written by the author App. Project membership is not:
installation tokens cannot reach user-owned Projects v2, so the project listing,
the issue's and PR's own membership, and the `--add-project` write all go through
the verified operator credential, in a second edit. Without that credential an
explicit `--project` refuses, and every other case logs one line and leaves
membership to the operator backfill — the rest of the publish still lands. An
issueless lane derives its project from its derived type label and keeps it only
when the live listing names that project.

Author-locked off-convention branches may publish via `--lane <absolute-path>`
only with an already open PR for that exact branch, proving it a genuine
stranded lane. This path only pushes; it never writes PR title or body and
refuses if the PR is no longer open when the push lands.

### PR body

Write for a teammate outside the session. Under template headings explain what
changed and why, without repeating the title, and how to test. Product changes
require user/reviewer-observable steps and expected results, not substituted
author/CI checks; internal or developer work may name its actual validation
interface. Exclude session diaries, unpublished rounds, and mutation tables.

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

The caller writes `stances.json` into that bundle in two phases: before
dispatch it holds the derived stance set, one entry per stance naming the
failure mode that admits it; as each draw reports, its baseline-probe result —
and its exhaustion when that draw fell back to an authoring model — is
recorded into the same file. It sits alongside the
later `dossier.json`, `review.json`, `discarded.json`, and `acceptance.json`.

`risk-plan.json` records `format: 'risk-plan-v1'`, the `pr`/`headSha`/`baseSha`
it is bound to, the change's `riskClasses`, the `requiredStances` those classes
earn, and the `triggers` that fired. It is derived from the same path
classification as `review-size.json`, so the stances and the printed size
summary cannot disagree. The plan is an input to the caller's stance
enumeration, never a stance requirement: the dispatched stances are the
reviewer's task-derived judgement, recorded in `stances.json`. Classes union
when several fire, and no class may require a stance it did not earn: that is
the proportionality rule, and `code-craft` is required only by `ordinary`.

- `small` (no specialist surface, handwritten change within the small-change
  budget) — correctness, test-validity.
- `ordinary` (no specialist surface, over that budget) — correctness,
  code-craft, module-boundaries, test-validity.
- `test-only` — test-validity.
- `cross-domain` — correctness, module-boundaries, test-validity.
- `realtime-audio` — correctness, realtime-audio, test-validity.
- `native-security` — correctness, security-platform, test-validity.
- `undo` — correctness, project-integrity-undo, test-validity.

Parsing recomputes the stance union from `riskClasses`, so a hand-edited plan
can neither widen nor narrow its own review.

`review:publish` prints the review id and posts as reviewer App only if
GitHub's live head matches the bundle; fresh approvals also require matching
base context. Fresh reviewer publication also carries the head-bound dossier and
refuses before any remote write when the plan or dossier is missing, malformed,
or rebound from the head/base/pr it must bind; when the bundle carries
`stances.json` and the dossier's `stances` entries do not correspond to that
record as sets of stance names — every draw names a recorded stance and every
recorded stance carries at least one draw, so several draws on one stance share
its single entry; when
its accepted findings do not match the document's comments
one-to-one; or when its recommendation disagrees with the document's event. It
then persists the canonical record, `format: 'dossier-v1'`: an append-only event
chain (`stance-completed`, `finding-accepted`, `finding-discarded`) whose records
carry `sequence`, `previousDigest`, and `digest`, plus `headDigest` and a
`dossierDigest` over the header identity, evidence and limitations.
Re-publication of the same head replays that persisted record unchanged rather
than minting a second one.

Legacy tolerance: a bundle with no `risk-plan.json` predates this contract and
publishes exactly as before.

### Headless reviewer dispatch

When the harness cannot select subagent models, run each blind stance on another agent
harness headlessly: one stance per dispatch, blind, read-only, no credentials, the
report returned as text for the orchestrator to validate and publish. `reviewerModel`
records the model actually run; the dispatch never enters the trusted snapshot; the
harness, model, and invocation are the dispatching session's choice. When only the
author's model is available, the same-model review still publishes: `review.json`
carries `modelExhaustion` (one line naming what made every other model unavailable)
and the published body names the reviewer model, so the deviation is recorded rather
than silently accepted. A draw on an authoring model records its own exhaustion; a
document-level whole-round `modelExhaustion` covers every draw; per-draw exhaustion
excuses the document-level field in a mixed round.

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

### Dossier input and discard record

The orchestrator writes the caller-authored `dossier.json` beside `review.json`
and `discarded.json`, in input form `format: 'dossier-input-v1'`: the same
`pr`/`headSha`/`baseSha`, one completed `stances` entry per dispatched draw — the
names the bundle's `stances.json` records, plan menu ids or free-form risk names
alike; one stance may carry several draws with distinct reviewer models — each
with its `reviewerModel`, `modelTier` of
`economy`/`standard`/`strongest`, and `outcome` of
`blocker-found`/`clean`, its `exhaustion` when that draw fell back to an
authoring model (one line naming what made every other model unavailable for
that draw), the bounded `evidence` claims, and `limitations`.
The accepted findings are not declared there: they are the review document's own
inline comments. `discarded.json` is the orchestrator's discard record and is
now actually read: an array of `{ finding, stance, reason }`, one entry per
discarded candidate, each with a one-line reason.

Dossier evidence, limitations, and approval-claim values must be single-line,
trimmed and bounded, and are refused when they carry a credential-shaped value,
a private-key header, a JWT, a bearer token, or raw session-transcript markers.
Private reviewer prose belongs nowhere in the record.

Readers of historical review and acceptance documents are unchanged, and
`review:accept` takes no dossier.

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
its base. Fresh APPROVE publication and acceptance require base `main`; for a
registered child they also require the bundle's live context and proof that
reconciliation contains the recorded parent's landed commit.

## acceptance.json

After independent review, write `acceptance.json` beside `review.json` in that
head's existing bundle. `review:accept <pr>` accepts only an APPROVE document
with no inline comments and the same head-bound evidence schema as reviewer
approval. It requires the reviewer Bot's current-head approval and all threads
resolved before publishing final acceptance as the immutable orchestrator
User. The posting identity supplies the role; generated text must not announce
acceptance on another person's behalf or claim personal human review.

## Thread resolution

Push the fix, then record it with `review:repair`, which runs as the author App
and leaves the thread open. It reads the thread live and refuses one already
resolved, a `--head` that is not the pull request's live head, or a `--commit`
outside `base..head`: an ancestor of or equal to that head and not an ancestor
of the pull request's `baseRefOid`, so the merge base and every pre-pull-request
commit are refused. The repair must also strictly descend the reviewed commit
from the thread root's live `pullRequestReview.commit.oid`; it may equal the
live head. The reviewed commit itself, its predecessors, and commits that do
not descend it are refused. Missing or malformed root review provenance and
unavailable ancestry comparisons fail closed before posting. It binds the
thread's own root comment as
the finding, plus the commit, one-line summary, bounded evidence, and head, and
posts a readable reply carrying one canonical `sourdaw-repair-v1` marker line;
it never resolves. Re-running the same head and commit posts nothing and reports
the already-recorded state.

For ancestry `B -> P -> R -> H`, let `B` be the PR base and `R` the root finding's
reviewed commit. `H` qualifies as the repair even when it is the live head.
`P` predates the finding, and `R` is the revision that received it; neither
strictly descends `R`, so neither can be recorded or confirmed as its repair.

The reviewer confirms with `review:confirm`, a distinct identity from the
author's. It resolves, in one pass with deterministic mutation ids, the threads
whose author-recorded repair validates: same pull request, same thread, same
head, finding equal to the thread's root comment, repairing commit inside
`base..head` and strictly descending the thread root's live associated review
commit (`pullRequestReview.commit.oid`), record well formed, evidence safe.
The repairing commit may equal the live head. Missing or malformed root review
provenance or an unavailable ancestry comparison fails closed for the whole
batch before any confirmation or resolution. It also fails closed — a refused
record, a duplicate distinct record, a thread already carrying a
confirmation for a different record or a duplicated identical confirmation, a
rebound identity, a mismatched finding, or a commit outside the reviewed range
resolves nothing and reports the refusal, leaving the operator to fix the
ambiguity and re-run. Both commands are lock-free and idempotent by their
deterministic ids, and re-running after a partial pass ignores already-resolved
threads and completes the remainder. `review:resolve` remains only for legacy
roots, where it posts only its bare `Done` as author bot and resolves against
that head; using it on a thread a reviewer blocked reintroduces bare author-side
resolution, which is what `review:repair` and `review:confirm` exist to replace.
No script writes free-form thread replies; wrongly posted findings have no
discussion route. Clarify code, not threads. Resolve only when the current head
addresses the finding, then obtain a new review. File out-of-scope feedback; do
not grow the PR.

## deliver

### Validation order

`pnpm deliver` squash-merges only non-draft, structurally mergeable PRs after
BOTH validation points confirm both the immutable reviewer Bot and orchestrator
User `APPROVED` the current head, with final user acceptance after reviewer
approval, and all threads resolved. Approval counts or matching logins cannot
substitute for those actor identities or ordering. Merge executes as the
verified orchestrator User; receipt and tracker writes retain their author App
identities.

Head, head branch, base branch, body, canonical closing target, and stacked
dependents must stay stable between reads. `deliver` remains main-only and
refuses any other base; reconcile a landed parent through `lane:sync-parent`,
republish the child against main, and obtain fresh review before delivery. Do
not merge any other way.

### CI admission

Snapshot-backed CI admission is advisory: successful, failed, pending, absent,
cancelled, malformed, or unavailable evidence does not itself block delivery.
GitHub still enforces the live ruleset's required `Gate`; `deliver` refuses
`BLOCKED` before any remote write, including receipts or merge attempts.
Dormant required-CI admission retains pinned workflow-derived gate and
complete-rollup rules from the launcher's pinned `origin/main` workflow copy;
lanes cannot select or reshape it.

### Refusals and retries

GitHub structural mergeability independently gates base compatibility: delivery
retries one transient `UNKNOWN`, refusing conflicts or a second `UNKNOWN`.

## The delivery lock

`deliver` serializes each PR with a protected-primary Git ref pointing to a
strict owner blob. Acquire with zero-ref Git compare-and-swap; release requires
the acquired object ID. Hold ownership from before authentication through merge
or already-merged recovery and tracker completion. Validate and refuse existing
owners without waiting or automatic takeover, regardless of liveness. Crashes
leave the ref; only `deliver --recover-lock` clears it.

Recovery refuses a live recorded process fence, adopts the lock under its own
fence before reading anything, then requires two matching remote reads. It
never merges, retargets, posts, or closes, and accepts only the immutable
orchestrator User or historical author Bot as merger. Clearing records a
dead-owner-keyed receipt; repeat recovery replays it without GitHub access.

Already-merged recovery accepts the immutable orchestrator User or historical
author Bot as merger; fresh delivery requires the orchestrator User and rejects
a fresh author-bot merge. Actor type and immutable ID must agree in both paths.

## Review-publication lock recovery

`review:publish` and `review:accept` serialize each PR with their own owner ref.
A run that dies after the journal records `remote-mutation-attempted` but before
GitHub answers leaves a dead owner that recovery can neither release nor replace
with a releasable one: the journal cannot prove the POST never landed, so the
default refusal has to hold, and adoption only re-creates the same refusal.

`review:publish:recover` refuses a live fence, authenticates the recorded
publication identity, and requires the retained payload digest to match the
bundle document plus two stable inspections of the same head. When the journal
itself proves no mutation landed — the owner is still `prepared`, or it carries
an HTTP 422 marker — absence releases the owner, and its receipt makes repeat
recovery idempotent without GitHub access.

`--attest-absent` is the operator's explicit assertion that the review POST never
landed, and it is the only path that releases an owner whose sole failing
condition is a missing definitive answer. It is legitimate only after
independently establishing that the remote holds no review at the journaled head
— for instance, the owning run has been dead long enough that a landed POST
would be visible. The flag adds one term to the release decision; every other
protection still runs and keeps its refusal: a live fence, ambiguous or non-exact
landed review evidence, unauthorized landed review evidence, a payload digest
that differs from the retained lock, and a missing or mismatched bundle. The
release records the operator attestation in its own receipt version rather than
inferring it from an older receipt, so replay distinguishes it from a
journal-attested absence and a receipt that did not record it never gains it.

## Receipts

Same-head delivery receipts preserve the issue-comment REST endpoint's
ascending comment-ID order for adjacency and newest authority; timestamps only
prove App-owned comments remained unedited.

## Launcher trust boundary

Run `lane:publish`, `review:accept`, `deliver`, `issue:claim`, and
`issue:reconcile` through the protected primary checkout's package route. This
is the snapshot-backed write trust boundary: launcher and whole script closure
must match one pinned `origin/main` commit and come only from the primary
repository. Lane files are data, never executable delivery code. Lanes
predating the launcher or trailing `main` can publish and deliver without
first merging.

This isolates lane-controlled files, not operator-running code. The pre-launcher
operator environment is trusted; same-account processes can read credentials.
Snapshot and token-bearing children discard redirecting overrides (Node
loaders/preloads; Git, GitHub CLI, GitHub Actions, and App configuration) and
use launcher-resolved `git` and `gh`. During credential lookup and isolated
execution for the orchestrator User role, discard inherited GitHub, Git, and
Node overrides the same way.
