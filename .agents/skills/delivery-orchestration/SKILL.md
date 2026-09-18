---
name: delivery-orchestration
description: >-
    Operate Sourdaw's trusted review and delivery scripts — lane:publish,
    review:prepare, review:publish, review:accept, review:resolve, deliver,
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
| Sync a dependent lane        | `pnpm lane:sync-parent --lane <absolute-child-lane>`                                                                                                                                          |
| Push; open or update the PR  | `pnpm lane:publish <issue \| --lane <absolute-path>> [--relates] [--summary "<text>"] [--test "<instructions>"] [--model <model>] [--milestone <title>] [--project <title>] [--label <name>]` |
| Write the review bundle      | `pnpm review:prepare <pr>`                                                                                                                                                                    |
| Post `review.json`           | `pnpm review:publish <pr>`                                                                                                                                                                    |
| Post final `acceptance.json` | `pnpm review:accept <pr>`                                                                                                                                                                     |
| Reply `Done` and resolve     | `pnpm review:resolve <pr> --thread <id> --head <sha>`                                                                                                                                         |
| Squash-merge                 | `pnpm deliver <pr>`                                                                                                                                                                           |
| Recover a crashed delivery   | `pnpm deliver --recover-lock <pr> --owner <oid>`                                                                                                                                              |
| Close a superseded PR        | `pnpm pr:supersede <old> --head <old-sha> --replacement <merged>`                                                                                                                             |
| Prune spent remote branches  | `pnpm branch:prune [--apply] [--limit <n>]`                                                                                                                                                   |
| Remove a spent lane          | `pnpm lane:remove <path>`                                                                                                                                                                     |
| Strand an abandoned lane     | `pnpm lane:strand <path> --reason "<text>"`                                                                                                                                                   |
| Prune lane artifacts         | `pnpm lane:prune <path> \| --all \| --stale-days <days>`                                                                                                                                      |

`branch:prune` defaults to dry run and deletes only branches whose every PR is
merged or closed.

## Script order

The delivery sequence, in order:

1. `lane:publish` — push the lane and open or update the PR (mechanics below).
   It pushes without `--force` and refuses uncommitted changes: the publishing
   session commits the work itself with a conventional subject first.
2. Wait for `Gate` on the head, then `review:prepare <pr>` — write the bundle
   (below) and dispatch blind reviewers against it under the root Review rules.
3. Validate every finding, write `review.json` (and `discarded.json` for
   discards), then `review:publish <pr>` — post validated blockers as the
   reviewer App BEFORE dispatching any repair.
4. After the author pushes a fixed head, `review:resolve <pr> --thread <id>
--head <sha>` per thread, then a fresh review round.
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
`diff.patch`, `review-size.json`, `pr.md`, and merge-base `contracts/`. The
manifest binds PR, base branch, merge-base, and head. The diff and
deterministic size report use the actual base/head merge-base; handwritten,
test, documentation, and generated changes (including lockfiles) remain visible
as separate groups, and unknown paths count as handwritten. Paths are keyed by
head sha. Re-preparing the same head replaces generated files and preserves
caller files only while the bound base name and merge-base context match; a
populated legacy bundle without base identity cannot be reused. Unrelated
movement of the base tip is allowed when that context is unchanged.

`review:publish` prints the review id and posts as reviewer App only if
GitHub's live head matches the bundle; fresh approvals also require matching
base context.

### Headless reviewer dispatch

When the harness cannot select subagent models, run each blind stance on another agent
harness headlessly: one stance per dispatch, blind, read-only, no credentials, the
report returned as text for the orchestrator to validate and publish. `reviewerModel`
records the model actually run; the dispatch never enters the trusted snapshot; the
harness, model, and invocation are the dispatching session's choice.

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

### APPROVE: compact-v1 evidence

New APPROVE publication requires `format: compact-v1` and
`evidence: { headSha, claims: [{ observable, verification, observed }] }` in
`review.json`. Bind `headSha` to the reviewed bundle head. Supply at least one
claim, with every value a nonblank, trimmed, single-line string: `observable`
is expected behavior from the request or contract, `verification` is the exact
command, check URL, or source comparison, and `observed` is the decisive result
or excerpt. Keep the body to a short conclusion. Publication posts only that
reviewer-written body; the structured evidence stays unpublished in
`review.json`/`acceptance.json`, where `review:accept` and the orchestrator
consume it, bound to the head by `headSha`. The posted body must fit 600
Unicode code points; reject excess and report the actual and allowed lengths,
never truncate. Record completeness and head binding do not prove truthful
execution; the orchestrator remains responsible for verifying the claims.
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

Push fixes before `review:resolve`, which posts only bare `Done` as author bot
and resolves against that head. No script writes free-form thread replies;
wrongly posted findings have no discussion route. Clarify code, not threads.
Resolve only when the current head addresses the finding, then obtain a new
review. File out-of-scope feedback; do not grow the PR.

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

## Receipts

Same-head delivery receipts preserve the issue-comment REST endpoint's
ascending comment-ID order for adjacency and newest authority; timestamps only
prove App-owned comments remained unedited.

## Launcher trust boundary

Run `lane:publish`, `review:accept`, `deliver`, and `issue:reconcile` through
the protected primary checkout's package route. This is the snapshot-backed
write trust boundary: launcher and whole script closure must match one pinned
`origin/main` commit and come only from the primary repository. Lane files are
data, never executable delivery code. Lanes predating the launcher or trailing
`main` can publish and deliver without first merging.

This isolates lane-controlled files, not operator-running code. The pre-launcher
operator environment is trusted; same-account processes can read credentials.
Snapshot and token-bearing children discard redirecting overrides (Node
loaders/preloads; Git, GitHub CLI, GitHub Actions, and App configuration) and
use launcher-resolved `git` and `gh`. During credential lookup and isolated
execution for the orchestrator User role, discard inherited GitHub, Git, and
Node overrides the same way.
