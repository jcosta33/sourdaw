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

| Need                                                        | Command                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open a lane                                                 | `pnpm lane:open [issue] [slug] --type <type> [--model <model>] [--stack-on <absolute-parent-lane>]`                                                                                                                              |
| Claim the lane's issue                                      | `pnpm issue:claim <issue>`                                                                                                                                                                                                       |
| Sync a dependent lane                                       | `pnpm lane:sync-parent --lane <absolute-child-lane>`                                                                                                                                                                             |
| Push; open or update the PR                                 | `pnpm lane:publish <issue \| --lane <absolute-path>> [--relates] [--title "<conventional-subject>"] [--summary "<text>"] [--test "<instructions>"] [--model <model>] [--milestone <title>] [--project <title>] [--label <name>]` |
| Write the review bundle                                     | `pnpm review:prepare <pr>`                                                                                                                                                                                                       |
| Post `review.json`                                          | `pnpm review:publish <pr>`                                                                                                                                                                                                       |
| Post final `acceptance.json` (legacy pre-policy heads only) | `pnpm review:accept <pr>`                                                                                                                                                                                                        |
| Record a repair, leave open                                 | `pnpm review:repair <pr> --thread <thread-id> --head <full-sha> --commit <full-sha> --summary "<one line>" [--evidence <path-to-json>]`                                                                                          |
| Confirm repairs, resolve                                    | `pnpm review:confirm <pr> --head <full-sha>`                                                                                                                                                                                     |
| Explain the retired resolution command                      | `pnpm review:resolve --help`                                                                                                                                                                                                     |
| Rebuild rounds; shadow-compare                              | `pnpm review:reconstruct <pr>`                                                                                                                                                                                                   |
| Squash-merge                                                | `pnpm deliver <pr>`                                                                                                                                                                                                              |
| Recover a crashed delivery                                  | `pnpm deliver --recover-lock <pr> --owner <oid>`                                                                                                                                                                                 |
| Recover a wedged review post                                | `pnpm review:publish:recover <pr> --owner <oid> [--attest-absent]`                                                                                                                                                               |
| Close a superseded PR                                       | `pnpm pr:supersede <old> --head <old-sha> --replacement <merged> [--superseded-parent <closed-unmerged-parent> [--parent-replacement <merged-parent-replacement>]] --lineage <path-to-json>`                                     |
| Retire an obsolete PR with confirmed repairs                | `pnpm pr:retire <pr> --head <head-sha> --record <path-to-json>`                                                                                                                                                                  |
| Prune spent remote branches                                 | `pnpm branch:prune [--apply] [--limit <n>]`                                                                                                                                                                                      |
| Retry/discover pending post-merge cleanup                   | `pnpm lane:cleanup [--status]`                                                                                                                                                                                                   |
| Install/refresh macOS cleanup job                           | `pnpm lane:cleanup:install`                                                                                                                                                                                                      |
| Remove a spent lane                                         | `pnpm lane:remove <path>`                                                                                                                                                                                                        |
| Strand an abandoned lane                                    | `pnpm lane:strand <path> --reason "<text>"`                                                                                                                                                                                      |
| Prune lane artifacts                                        | `pnpm lane:prune <path> \| --all \| --stale-days <days>`                                                                                                                                                                         |
| Restamp author identity on lanes                            | `pnpm lane:identity`                                                                                                                                                                                                             |

Details apply only when their mode is used: [lane publication and maintenance](references/lane-publication.md), [closure and retirement](references/closure-and-retirement.md), [review records and legacy acceptance](references/review-records.md), and [repair and lock recovery](references/repair-and-lock-recovery.md). For historical stack admission consult [its dedicated procedure](historical-stack-admission.md). Root [AGENTS.md](../../../AGENTS.md) owns universal lane and review policy.

## Script order

The delivery sequence, in order:

1. `lane:publish` — push the lane and open or update the PR ([publication mechanics](references/lane-publication.md)).
   It pushes without `--force` and refuses uncommitted changes: the publishing
   session commits the work itself with a conventional subject first.
2. Wait for the entire `PR checks` workflow on the exact head to conclude `SUCCESS`;
   a green `Plan push checks` job alone is not the workflow result. A model-label event
   may trigger a pre-approval `Gate` failure; that separate run is not awaited before
   independent review and reviewer-App approval. Then `review:prepare <pr>` — write
   the [bundle](references/review-records.md) and dispatch blind reviewers against it
   under the root Review rules. Use one observer per PR; back off on read failures
   or use a connected reader that returns complete checks. Job pages can omit results:
   establish completion from the whole exact-head workflow or a complete check rollup,
   never a green subset, and do not rerun CI because a status read failed.
   A head that conflicts with its base gets no GitHub merge ref, so no
   `pull_request` workflow run is created and no check can ever appear: waiting
   on it waits forever. When `lane:publish` reports a conflicted head, read
   `gh pr view <pr> --json mergeable` and resolve the reported paths with a
   push before waiting; an `UNKNOWN` answer is GitHub still computing, so check
   it again rather than treating it as a conflict.
3. Validate every finding, write `review.json` with the round's `draws` (and
   any `discarded`), then `review:publish <pr>` — post validated blockers as
   the reviewer App BEFORE dispatching any repair.
4. After the author pushes a fixed head, `review:repair` records the repair per
   thread and leaves the thread open; let the reviewer confirm it with
   `review:confirm <pr> --head <sha>`, then obtain a fresh review round.
5. On a clean round, the reviewer posts one APPROVE; that reviewer APPROVE on the
   current head records the delivery authorization in the head's dossier, and
   `review:publish` then re-applies the `ci:approved` label as the reviewer App,
   after its publication lock is released; a failed label write exits nonzero
   naming the pull request, and a plain re-run replays the review and retries it.
   That label event alone starts the heavy checks and `Gate`, so CI capacity is
   spent once per approved head; `REQUEST_CHANGES` removes the label. Re-running
   `review:publish` on the same head replays the review and re-applies the label,
   which restarts a `Gate` that a later label event failed or cancelled.
6. Wait for the approval-triggered `Gate`, then the author runs `deliver <pr>`
   through the protected primary checkout's package route — it squash-merges as
   the author App after the reviewer APPROVE (see [review records](references/review-records.md)) and a green `Gate`. Lane
   files are data, never executable delivery code.

`review:accept <pr>` remains only for legacy pre-policy heads: a plan-carrying
bundle whose dossier already carries the reviewer-recorded delivery authorization
refuses the duplicate. New deliveries never call it.

Each script validates its own preconditions and refuses rather than repairs:
`review:publish` posts only when GitHub's live head matches the bundle;
`deliver` requires the reviewer Bot's current-head APPROVE and all threads
resolved, and refuses `BLOCKED`, non-`main` bases, and unstable reads (see [review records](references/review-records.md)).

## Review bundles and publication

`review:prepare` writes a head-bound bundle with a manifest, diff, size report, risk plan and contracts. Its manifest binds the PR, base, merge-base and head; reuse requires matching base and merge-base context. Fresh `review:publish` requires the live head and, for approval, matching base context; it validates the plan and review document before writing. A bound published record replays exactly, without another post. A legacy bundle without a risk plan retains its historical shape. See [review records](references/review-records.md) for schemas, binding, reconstruction, stack-child admission and legacy acceptance.

At five reviewer `REQUEST_CHANGES` rounds the PR is frozen to fresh publication; respin as one consolidated PR and supersede the old one after the replacement merges. Repair and confirmation remain available.

For thread eligibility, actor and ancestry checks, and crash recovery, read [repair and lock recovery](references/repair-and-lock-recovery.md). The author records repairs without resolving; the distinct reviewer confirms eligible repairs. `review:resolve` is retired.

## deliver

### Validation order

`pnpm deliver` squash-merges only non-draft, structurally mergeable PRs after
BOTH validation points confirm the immutable reviewer Bot `APPROVED` the current
head, with its recorded delivery authorization binding that live reviewer
approval, and all threads resolved. Approval counts or matching logins cannot
substitute for that actor identity. Merge executes as the immutable author App;
receipt and tracker writes retain their author App identities.

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

### Recovering a blocked Gate

When a required check fails because of a filed defect, preserve the original
evidence with the owning issue: the run URL and attempt, full head SHA, failed
check and matrix shard, relevant failure excerpt, and any retained artifacts.
Keep that failed run attached to the original head. A matching issue, a green
nightly, or a later successful attempt alone does not establish recovery.

Verify that a fix changes the cause in the code or check scope and that a
regression test exercises the reported failure conditions and outcome. For a
scope defect, inspect the changed-path decision and prove the resulting `Gate`
still requires every selected check. A filed issue or a change that merely
touches a nearby path is not this proof. If no relevant fix is available, leave
the pull request blocked and the cause issue open with the failure evidence;
there is no retry, empty commit, scope exception, or delivery waiver.

After the verified fix lands on `main`, check whether its commit is already in
the blocked pull-request lane. If it is absent, merge that actual fix from
`main` into the owned lane. This is justified only when the fix changes the code
or scope that produced the failure. Do not rebase or add an empty commit to
trigger another run. Publish the resulting head through `lane:publish`, then
require a fresh `Gate` on that changed code and a fresh review of the new head
before delivery. If the new check fails, retain the new failure as evidence and
continue fixing the cause; do not rerun it to obtain green. Diagnostic retries
never replace the original failure or authorize `deliver`.

### Local cleanup after delivery

Once merged recovery or delivery completes its receipt and tracker writes, and its serialization is
released, it queues and attempts native lane removal. A cleanup refusal leaves delivery successful
and reports pending cleanup. Failed delivery never attempts cleanup. A periodic deterministic macOS
job recovers missed queueing and crashes by rescanning registered author and legacy detached review
roots; no model automation or reviewer-created checkout is involved.

`lane:cleanup` writes identity-bound pending/protected/removed records before attempting removal,
under the primary `.agents/lane-cleanup/`. Safety refusals retry on the ordinary schedule; unavailable
inspection uses capped backoff. Successful delivery wakes its matching head while respecting shared
inspection backoff. Every attempt repeats live exact-head
merge/supersession and local safety proof through `removeLane`; records grant no deletion authority.
Dirty, untracked, non-regenerable ignored data, active Git work, open files, incomplete process
inspection and foreign locks survive. A replacement directory or changed HEAD gets a separate delayed
record and must earn its own fresh proof. Git CAS serialization recovers only a proven-dead worker.

Run `pnpm lane:cleanup:install` from approved current sources to install or refresh the user launchd
job. It materializes the worker's verified `origin/main` local-import closure, requires only Node and
existing Git/GitHub executables, and checks runtime bytes and manifest against approved Git objects
before every execution. It can refresh only the canonical protected-primary bootstrap from approved
sources when its HEAD/index or previous verified installation proves the current bytes; a local edit
refuses. It preserves other primary dirt and never depends on the author lane surviving. Consult
`lane:cleanup --status` from a current checkout, `.agents/lane-cleanup/worker*.log`, and
`launchctl print gui/$(id -u)/com.sourdaw.lane-cleanup` for retained work and scheduler status.

### Refusals and retries

GitHub structural mergeability independently gates base compatibility: delivery
retries one transient `UNKNOWN`, refusing conflicts or a second `UNKNOWN`.

The [launcher trust boundary](references/trust-boundary.md) describes the snapshot closure and environment controls. For a crashed delivery, repair, confirmation, closure, or review publication, follow the operation-specific [lock recovery](references/repair-and-lock-recovery.md); recovery itself does not perform the original operation.
