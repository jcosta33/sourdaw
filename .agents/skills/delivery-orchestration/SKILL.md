---
name: delivery-orchestration
description: >-
    Orchestrate a Sourdaw change from claim to cleanup: survey claims and open a
    lane, brief and dispatch author, repair, and reviewer agents, publish with
    lane:publish, run review rounds (review:prepare, review.json, review:publish,
    review:repair, review:confirm), deliver, clean up after delivery, and recover
    crashed or blocked operations (delivery lock, review publication recovery,
    blocked Gate, pr:supersede, pr:retire, branch:prune). ALWAYS load when
    orchestrating any change or running any review or delivery trusted script,
    even for a single command.
---

## Purpose

Follow this path from claim to cleanup. Root [AGENTS.md](../../../AGENTS.md) governs ownership,
checks, identities and review. Fix a script refusal at its named cause and retry through the
same route.

## Command reference

[Commands and flags](references/commands.md) includes maintenance, recovery and closure.

### Protected primary package route

Run these commands from the protected primary checkout:

- Lane and tracker writes — `lane:publish`, `lane:sync-parent`, `issue:claim`, `issue:reconcile`,
  `branch:prune`, `pr:supersede`, `pr:retire`.
- Review and delivery — `review:publish`, `review:publish:recover`, `review:repair`,
  `review:confirm`, `review:shadow-status`, `deliver`.
- Release and ruleset — `release:cut` and `ruleset:harden`, which plans without `--apply`.
- Legacy only — `review:accept`. See [legacy admission](references/review-records.md#acceptancejson-legacy-pre-policy-heads-only).

The launcher runs these scripts from a pinned GitHub `main` snapshot and treats lane files as data.
It refuses another working directory with
`trusted GitHub writes must be launched from the protected primary checkout`.
[Launcher trust boundary](references/trust-boundary.md)

Run `review:prepare` from the protected primary too. It runs outside the launcher, checks only its
own relative-import closure against `origin/main` after imports evaluate, and reads reviewer
credentials after the check. When the primary check fails, report the blocker.
[Bundle preparation](references/review-records.md#review-bundles-and-publication)

## Delivery path

### a. Claim

1. Check `git worktree list` and `gh pr list --state open --json number,headRefName,files` for an
   existing claim or overlap. Inspect live diffs and trace changed inputs to generated fields.
   Apply root [lane limits and overlap rules](../../../AGENTS.md#delivery).
2. Open `pnpm lane:open [issue] [slug] --type <type> --model <model>` with the
   author's actual model. This opens the lane from `origin/main` and stamps author identity.
   For a dependent lane add `--stack-on <absolute-parent-lane>`.
3. For an issue-bound lane, run `pnpm issue:claim <issue>` from the primary. Verify the claim
   succeeds before assigning work. For an issueless change, the lane and early PR establish the
   claim. File longer campaigns and handoffs first so each lane can claim against the tracker.

[Claim refusals](references/lane-publication.md#issue-claims) · [Stack procedure](references/lane-publication.md#stack-synchronization)

### b. Brief and dispatch the author

Apply root [Delegation](../../../AGENTS.md#delegation) and the [author brief](#author-brief).
The author commits in the lane. The orchestrator publishes.

### c. Before publishing

- Read the complete lane diff against the brief. In an ordinary lane use
  `git diff origin/main...HEAD`. For a stack use the resolved parent as base.
- Run the exact affected specs and format only changed files in the lane under root
  [Checks](../../../AGENTS.md#checks).
- Commit affected generated outputs before publishing. Check the
  [generation rules](references/delivery-checks.md#generated-artifacts-before-publication) for WASM,
  campaign evidence digests and release tracked-set pins.

### d. Publish

From the primary, run `pnpm lane:publish <issue | --lane <absolute-path>>`. A new PR requires
`--summary "<what changed and why>"` and `--test "<how to verify and what to expect>"`.
Use `--lane` to disambiguate lanes for an issue. Use `--relates` for a slice that leaves its issue
open. The author must commit a conventional subject and a clean lane before publishing.

Write for a teammate outside the session. A product change with any handwritten path under
`src/modules/`, `src/components/`, or `electron/` teaches what to do in the app and what to see or
hear. Put a launch in the step that uses it. For internal work, show the tool's observable result.
Only test-only changes name specs. [Titles, body rules and refusals](references/lane-publication.md#titles-and-pull-request-bodies)

### e. Wait for push checks and mergeability

Use one observer per PR. Require the whole exact-head `Health gates` workflow to conclude
`SUCCESS`. Check `gh pr view <pr> --json mergeable`. Wait out `UNKNOWN`, and resolve
`CONFLICTING` in your lane and publish before waiting for a run. Back off on read failures.
[Checks and conflict diagnostics](references/delivery-checks.md#watching-health-gates)

### f. Review round

From the primary, run `pnpm review:prepare <pr>` and use the printed bundle path. It binds the
head, base and merge base and includes merge-base contracts. Re-prepare when context changes.

Read `manifest.json` and use `contracts/AGENTS.md` as the root policy. When a source it references
is absent from `contracts/`, resolve the link from the referring file's original repository path
and read `git show <baseSha>:<repo-relative-path>` using the manifest's merge-base SHA. Follow any
nested references at that same revision. Use the bundle's `diff.patch` and
`git show <headSha>:<repo-relative-path>` for the code and proposed guidance under review.

Apply the pinned Review rules to derive the stances, including the human minimum and its
exception. Use the bundle's `risk-plan.json` with the pinned risk-class rules to determine the
machine floor. The risk-class table is in the merge-base delivery guidance or the reference it names.

Dispatch blind reviewers with the [reviewer brief](#reviewer-brief). Review the whole exact head
yourself before reading any stance report.

### g. Validate findings

Apply the pinned Review rules against the exact reviewed head.
Reproduce blockers, record discards privately, and combine duplicate findings into one comment
whose `sources` names every draw that independently detected it. A global-only blocker needs
blind reproduction before publication. Hold approval when an unresolved concern leaves the
head unfit.

### h. Write `review.json`

Write the round's only caller document in the bundle. Read the schema and worked examples from
the merge-base delivery guidance and its references.
`REQUEST_CHANGES` carries blocker comments on changed lines. `APPROVE` carries compact
head-bound evidence, a short reviewer-written body and no inline comments.
Keep credentials, private reviewer prose and sensitive logs out of the record.

### i. Before any APPROVE publish

- Require `SUCCESS` for the whole exact-head `Health gates` workflow, `MERGEABLE` and
  zero unresolved threads, including CodeQL. Use [repair](#k-repair) to clear eligible findings.
- Confirm the exact head still passes your global review and the round meets the pinned Review
  policy from [step f](#f-review-round). Keep the compact body within 600 Unicode code points.

### j. Publish the review

From the primary, run `pnpm review:publish <pr>`. It posts as the reviewer App on the bound head.
**Post `REQUEST_CHANGES` before any repair dispatch.** A clean APPROVE records current-head
delivery authorization. A new push starts fresh CI and requires fresh review.
Find the publication, replay and refusal rules in the merge-base review-records reference.

### k. Repair

Only after publishing a validated blocker:

1. Dispatch the [repair brief](#repair-brief). Reassess scope first if a new mechanism or outcome
   is needed. The author commits in the lane. Read the diff and publish through `lane:publish`.
2. From the primary, record each repair as author App with
   `pnpm review:repair <pr> --thread <thread-id> --head <full-sha> --commit <full-sha> --summary "<one line>"`.
   Leave the thread open.
3. From the primary, run `pnpm review:confirm <pr> --head <full-sha>`. The reviewer App resolves
   only threads with valid author records. Follow the refusal if confirmation resolves nothing.
4. Prepare a fresh bundle and run a new blind round on the new head.

[Repair eligibility, evidence and recovery](references/repair-and-lock-recovery.md#thread-resolution)

### l. Gate and deliver

Confirm the whole `Health gates` workflow succeeded on the exact approved head. From the primary,
run `pnpm deliver <pr>`. It validates the live head, review authorization and resolved threads and
squash-merges into `main` as the author App.

#### Validation order

[Live validations and delivery fences](references/delivery-checks.md#validation-order)

#### CI admission

[Gate provenance, workflow attempts and ruleset](references/delivery-checks.md#ci-admission)

#### Refusals and retries

[Mergeability and lint-ledger crossings](references/delivery-checks.md#refusals-and-retries) ·
[Operation-specific lock recovery](references/repair-and-lock-recovery.md)

### Recovering a blocked Gate

When a required check fails because of a filed defect, preserve the original evidence with the
owning issue: the run URL and attempt, full head SHA, failed check and matrix shard, relevant failure
excerpt, and any retained artifacts. Keep that failed run attached to the original head. A matching
issue, a green nightly, or a later successful attempt alone does not establish recovery.

Verify that a fix changes the cause in the code or check scope and that a regression test exercises
the reported failure conditions and outcome. For a scope defect, inspect the changed-path decision
and prove the resulting `Gate` still requires every selected check. A filed issue or a change that
merely touches a nearby path is not this proof. If no relevant fix is available, leave the pull
request blocked and the cause issue open with the failure evidence; there is no retry, empty commit,
scope exception, or delivery waiver.

After the verified fix lands on `main`, check whether its commit is already in the blocked
pull-request lane. If it is absent, merge that actual fix from `main` into the owned lane. This is
justified only when the fix changes the code or scope that produced the failure. Do not rebase or
add an empty commit to trigger another run. Publish the resulting head through `lane:publish`, then
require a fresh `Gate` on that changed code and a fresh review of the new head before delivery. If
the new check fails, retain the new failure as evidence and continue fixing the cause; do not rerun
it to obtain green. Diagnostic retries never replace the original failure or authorize `deliver`.

### m. After delivery

- If the validated PR body has a canonical closing target, verify that issue closed as completed
  and its board item reads Done. A `--relates` issue stays open. An issueless PR skips this step.
- Delivery attempts lane cleanup after receipt and tracker writes and release of its lock. If
  cleanup is pending, run `pnpm lane:cleanup --status`; the scheduled worker retries. Manual
  removal is `pnpm lane:remove <path>` from outside the lane.
- Remove the leftover local branch with the applicable authority. Cleanup and `lane:remove`
  leave it in place. See [remove or strand a lane](references/lane-operations.md#remove-or-strand-a-lane).

#### Local cleanup after delivery

[Cleanup, launchd installation and diagnostics](references/lane-operations.md#local-cleanup-after-delivery)

## Briefs

### Author brief

- Include the objective, lane, branch, paths, exclusions, dependencies, preservation guarantees,
  acceptance conditions, integration observable, exact checks, and required product How to test
  steps. Trace the observables and routes before dispatch under root [Delegation](../../../AGENTS.md#delegation).
- Give the chosen approach and rejected alternative with its reason. Point to the files and
  functions to change and the patterns to follow using `path:line`. Leave naming and local
  structure to the author. Scale detail inversely with tier and use prose rather than pseudo-code.
- Order the work from a failing reproduction for behavior changes through the fix, callers, and
  formatting. Name applicable skills, nested guidance, architecture traps and generated artifacts.
  Give each step an exact check and expected result.
- If the code contradicts the brief or an observable or route is missing, stop and report.
  Commit in the lane with a conventional subject and leave pushing to the orchestrator.
  Return status, changed paths, decisive evidence and blockers.

### Repair brief

- Restate the finding in your own words. Give the chosen repair, code to follow and step order.
- If loosening a validator or check, name the inputs still rejected and the cases that still
  fail, each with a spec.
- Use the author brief's stop rule, lane commit and return requirements.

### Reviewer brief

- Give the printed bundle path, exact head, one failure mode as the stance, and the neutral
  acceptance and check conditions from the request and governing contract. Include only the
  most specific matching stance reference from the merge base when one exists.
- Use the same [pinned sources](#f-review-round). Read `contracts/AGENTS.md`, the selected stance
  reference and any review instructions it links at `baseSha`, and the proposed changes at
  `headSha`. Try to break the change. Establish what should make each check fail, and verify
  through a targeted revert or mutation and its named spec if given exclusive handoff of the
  clean, committed author lane under the pinned reviewer isolation rules. Never create a worktree
  or clone or install dependencies. For an unrun probe, return the mutation, spec and limitation.
- Return the strongest surviving findings with `path`, `line`, `side`, `defect`, `consequence`,
  `done` and reproduction with observed result, or report clean with probe results. Return
  reports only to the orchestrator. Discard hedged findings without a concrete break.
- Choose the model under the pinned Review policy. If the harness cannot choose subagent models,
  read the merge-base review-records reference for headless reviewer dispatch.

## Freeze

Follow the Review policy and freeze and replay procedures from the [pinned sources](#f-review-round).

## References

- [Lane publication](references/lane-publication.md) for claim refusals, branch conventions,
  commit authorship, titles, bodies, metadata, stacks and `branch:prune`.
- [Lane adoption](references/lane-adoption.md) before taking custody of a released PR.
- [Historical stack admission](historical-stack-admission.md) for a child without lineage files.
- [Closure and retirement](references/closure-and-retirement.md) before `pr:supersede` or `pr:retire`.
