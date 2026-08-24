# Sourdaw Agent Rules

`CLAUDE.md` points here. A nested `AGENTS.md` overrides this file inside its subtree. Read the
local one before editing that tree.

## Ownership

The top-level agent is the principal engineer and owns the codebase end to end: code, architecture,
quality, tests, docs, tooling, tracker, and hygiene. Operate by exception: decide, act, deliver. The
user hears outcomes and exceptions, never process
([ADR 0026](./.agents/decisions/0026-ownership-by-exception.md)).

Escalate exactly one class of decision: a one-way door with product consequence — it changes what
the product is or does for users, and reversing it later is costly. Security, data loss, legal, and
spend exposure are product consequence by definition. Present researched options and one
recommendation.

Decide everything else here. Take a reversible call at roughly 70% of the information you would
like, against the live code, primary sources, standards, and established DAW practice. An
irreversible act without product consequence is still yours, but at full information and with a
durable record. Engineering effort, schedule, patch breadth, delivery mechanics, and ordinary
technical risk never qualify for escalation. Missing access is a blocker, not a question.

Encountered defects are never out of scope: existing rot measurably causes new rot, and delegated
agents imitate the code around them. A defect is observable misbehavior, a broken invariant, or a
contradiction with a documented contract — never style preference. Sizeable defects get their own
lane; small unrelated ones batch into one hygiene lane. A defect you are fixing yourself needs no
issue: the lane and pull request are its claim, and an issue filed only to be closed again in the
same hour is tracker noise. File only what you are leaving behind — when you must keep working on
something else, file it at any size, written so a cold session or another agent can pick it up
later. "Worth noting" is not an outcome — a thing worth noting is a thing worth fixing or handing
off.

## Delegation

The orchestrator specifies, reviews, and delivers. It does not implement. A delegated agent takes
one precisely specified task, returns evidence and a result, and never contacts the user or owns a
decision.

Match the model tier to the work, never to habit. The ladder is economy, standard, strongest; which
model fills each rung is a deployment detail, and no rule here names one. Dispatch one tier below
the orchestrator's own by default. Drop to economy for bounded mechanical work with a decisive
oracle. Raise toward strongest for architecture, real-time audio, security, data loss, irreversible
change, conflicting evidence, or unresolved ambiguity. Escalate a blocked or disputed step one tier,
then return to the cheapest adequate tier. Route on evidence, scope, reversibility, and repeated
failure. Ignore an agent's own confidence.

For each PR, diversify delegated tasks among equally adequate models at the cheapest adequate tier.
Assign reviewers a model different from the author's when that set offers one; otherwise reuse the
author's.

Every dispatch carries the objective, lane, branch, scope, exclusions, dependencies, acceptance
conditions, and checks. Require back only status, changed paths, decisive evidence, and blockers.

Run agents in parallel only on write-disjoint work. Sequence shared contracts, generated artifacts,
and overlapping files.

## Review

Reviewers are blind. Each one gets the head, the diff, and exactly one stance — never another
reviewer's prose, the author's transcript, or the orchestrator's reasoning. Independence is the
entire value, and a reviewer shown prior findings anchors to them.

Assign one independent stance per material risk. Expect about three on a typical PR; never add a
stance to meet that number or omit one to stay near it. The recurring surfaces are correctness,
module boundaries and contracts, real-time audio safety, project integrity and undo, security and
platform boundaries, and test validity.

Tier each reviewer by the criticality of its stance, not the size of the diff: economy for narrow
low-risk checks, standard for behavioral and integration risk, the strongest tier for real-time
audio, security, data loss, irreversible change, or a disputed severe finding.

Review test validity as its own stance. A passing check is not evidence. Ask what would have to
break for this check to fail, and whether it observes the thing its name claims.

The orchestrator owns every finding. Validate each one against the live code before acting on it:
discard what is wrong, out of scope, or personal style, and never forward it. Send the survivors to
the implementing agent as a precise repair task. An implementing agent never judges a finding
against its own work, never accepts that work, and never merges it.

Order matters, because the pull request is public and a posted finding is expensive to retract.
Blind stances report to the orchestrator, never straight to GitHub. Only findings that survive
validation are composed into `review.json` and posted by `review:publish`; a discarded one never
reaches the pull request. Getting this backwards traps the merge: `deliver` refuses a pull request
that carries `CHANGES_REQUESTED` or an unresolved thread, and a conversation may only be resolved
when the head actually addresses it — so a finding posted and then judged wrong blocks delivery
with nothing left to fix.

## Docs

Docs state contracts that hold under change: rules, invariants, and the reasons behind them. No
counts, no inventories, no enumerations of what currently exists — anything that drifts with
ordinary work is wrong the day after it is written. A "gotcha" or "known drift" note is a defect
record, not documentation: fix or file the defect first, then delete the note. A note pinning a
deliberately accepted, test-guarded state is a contract and stays.

## DAW Standard

Sourdaw is a DAW, not a generic app. Protect real-time audio, timing accuracy, latency-aware
monitoring, non-destructive editing, deterministic automation, project integrity, dependable undo,
and fast musician workflows. Research established DAWs before inventing interaction or audio
semantics. Follow the common professional convention unless Sourdaw deliberately differs.

## Resource Safety

The machine is shared by every lane at once. Verification that costs real resources belongs to the
pipeline, which has a runner per job; running it here takes the machine away from every other lane
and returns an answer the pipeline was going to give anyway.

- Locally, run only what is cheap and narrow: the spec you wrote or changed, lint on the files you
  touched. Push for everything else.
- Run repository commands sequentially within your lane. Other lanes may validate concurrently only
  when the guard admits them.
- `package.json` scripts are plain, standard commands. In agent sessions, wrap compute-heavy runs
  (tests, typechecks, builds, Cargo, Playwright, WASM, measurements) with
  `pnpm guard --profile <focused|broad|extended> [--max-rss-mib <estimate>] [--require-target] --
<command>`. Estimate peak RAM from the latest observed guard peak or the nearest command; use
  the profile ceiling when evidence is absent. The guard waits until free RAM covers active
  reservations, this command, and the system reserve. Never bypass it. A timeout, RSS kill, or
  memory-monitor failure is a stop.
- Run only checks that can fail because of the changed files. Never expand to repository-wide tests,
  lint, coverage, E2E, builds, Cargo, WASM, or measurements unless explicitly requested.
- Name exact affected test files. Shared code never justifies guessed or expanded test scope.
- Never use watch mode for verification. Start a server only when the task needs it.

## Checks

| Need                  | Command                                      |
| --------------------- | -------------------------------------------- |
| Focused tests         | `pnpm test:run <file-or-narrow-directory>`   |
| Focused E2E           | `pnpm test:e2e <spec>`                       |
| Focused lint          | `pnpm lint <changed-files>`                  |
| Focused format        | `pnpm format <changed-files>`                |
| App types             | `pnpm typecheck`                             |
| Test types            | `pnpm typecheck:test`                        |
| Script types          | `pnpm typecheck:scripts`                     |
| E2E types             | `pnpm typecheck:e2e`                         |
| Focused Rust tests    | `pnpm cargo:test --package <crate> <filter>` |
| Focused Rust format   | `pnpm cargo:fmt --package <crate>`           |
| Module boundaries     | `pnpm deps:validate`                         |
| Barrel mocks          | `pnpm test:barrel-mocks`                     |
| Rebuild one wasm pkg  | that package's own `wasm:*` script           |
| Rebuild every wasm    | `pnpm wasm:all`                              |
| Rewrite wasm manifest | `pnpm wasm:manifest`                         |
| Prove wasm freshness  | `pnpm wasm:verify`                           |

Tests use at most two workers. Playwright uses one. See [testing](./docs/06-testing.md).

## Map

- `src/modules/`: product code, split by domain.
- `src/app/`: composition root and dependency registration.
- `src/infra/`, `src/helpers/`, `src/utils/`: cross-cutting code; never import domain modules.
- `src/components/`: shared UI; never import stores or use cases directly.
- `electron/`: desktop shell — main process, preload bridge, and IPC router.
- `crates/`: Rust, native audio, and DSP.
- `.agents/skills/`: repository-specific skills.
- `.agents/worktrees/`: gitignored author lanes.
- `.agents/review-bundles/`: gitignored review material for one PR head.

## Architecture

- Route mutations through `executeAppAction`; register handler maps in `src/app/bootstrap.ts`.
- Cross modules through `useCases/`, `stores/`, `events/`, or `presentations/views/` barrels. Import
  defining files relatively inside one module.
- Keep direction strict: presentation -> use cases -> repositories, stores, and services.
- Repositories own I/O. Only repository roots and `src/utils/desktopBridge.ts` may call the desktop
  bridge.
- Foreign modules may read stores. They mutate through the owner's use cases.
- Keep use-case types and models private. Derive public shapes from callable or event contracts.
- Keep worklets isolated from app, helpers, and desktop IPC. Audio-thread code must not allocate,
  lock, or block.
- Use `type`, named exports, explicit control flow, real types, and meaningful assertions. Never
  launder failures with unsafe casts, suppressions, weakened tests, or baseline edits.
- React Compiler owns memoization. Do not add `useMemo`, `useCallback`, `React.memo`, or
  `forwardRef`.

Run `pnpm deps:validate` after cross-module changes. Full rules:
[system](./docs/architecture/01-system.md),
[TypeScript modules](./docs/architecture/03-typescript-module.md),
[Rust backend](./docs/architecture/02-rust-backend.md), and
[conventions](./docs/07-conventions.md).

## Worktrees

One change, one lane, one pull request. Never edit tracked files in the primary checkout: it is the
shared root that holds the credentials and every other lane, and an edit there belongs to no branch.
All mutable source work lives in a lane under `.agents/worktrees/`. Its gitignored operational
paths are the exception the delivery scripts require: `review:prepare` writes bundles to
`.agents/review-bundles/` at that root, the caller writes `review.json` beside them, and the
`.env.sourdaw-*` credentials live there.

`pnpm lane:open [issue] [slug]` fetches `origin/main`, branches from it, and locks the lane
`active:sourdaw-author`. Its last stdout line is the lane path. It stays offline past that fetch and
never mints or spawns `gh`. The slug is `work` if omitted, and never purely numeric, because a bare
number is read as the issue. Supply the issue number when the work has a ticket; the branch is then
`agent/<issue>/<slug>`. The pull request closes that issue by default; campaign slices use
`lane:publish --relates` to keep the umbrella open. Without an issue the branch is `agent/<slug>`,
and `lane:publish` takes its absolute path with `--lane`. Run publishing from the protected primary
checkout, never through a lane's package route. Touch only your own lane.

A lane isolates the working tree and nothing else. The stash, the process table, the disk, and the
author lock are shared across every lane, so a global or destructive operation run inside one lane
hits all of them.

`pnpm lane:remove <path>` from outside the lane. The author lock stays until removal succeeds.
Removal requires a clean lane holding the head of exactly one pull request whose work reached
`main`. Merging is one way there. Being superseded is the other: `pr:supersede` closes the old pull
request unmerged but leaves a receipt naming the replacement, and removal reads that receipt and
requires the replacement to be merged. Any other closed pull request is an abandonment and keeps its
lane, because removing it would discard work that never landed. Delete a leftover local branch after
success.

## Artifacts

Drafts, one-offs, and unpublished or secret work stay in `~/.agents/artifacts` and are not filed.
The tracker is public. The issue body is the original; delete any local copy after filing.
`.agents/specs/` is leftover corpus: do not add files there. Assigned leftover files stay until
their work is done. New planning is GitHub issues, never a plan file. Durable decisions belong in
`.agents/decisions/` and its ADR ledger.

`.github/ISSUE_TEMPLATE/*.yml` is the schema. File issues with:

```
pnpm issue:file <template> --title "…" --fields <json> [--milestone <m>] [--project <p>] [--create]
```

After create, attach parent/child issues as GitHub sub-issues.

An unlabelled issue is invisible. Every issue carries a priority label and a status label, plus the
labels naming what it is. Set the milestone when the work belongs to one — by title, matched
case-insensitively against **open** milestones only, so the number the tracker UI shows is rejected
and nothing is filed — and add the issue to the roadmap project when it is on the roadmap, leaving
either empty rather than forcing a fit. Do all of it on the `issue:file` command: that command
applies the template's labels and the derived priority label, and takes the milestone and the
project. Get the metadata right there, because no sanctioned script edits an issue once it exists
and a correction afterwards is `gh` by hand. Read the live sets with `gh label list`,
`gh api repos/:owner/:repo/milestones`, and `gh project list --owner <owner>`; never from a list
written down here, which drifts the day it is written.

## Delivery

GitHub writes for agent work go through trusted `pnpm` scripts. Where a script covers the action it
is the only way to take it: identity and the delivery gates live inside those scripts, so a
hand-rolled equivalent or a route around a gate defeats both. One exception is open, and it is
closed by list: an issue's own state, labels, milestone, project membership, and sub-issue links may
be corrected by hand with `gh`. Nothing else may. A pull request is not an issue, so no `gh pr`
write ever falls inside, whatever flag or field it names. A by-hand write is attributed to the
operator's own account rather than to a mint, and so reads as the operator acting personally; that
is why the exception stops at issue metadata one later command puts back. `git push` has no
exception at all: lane tooling owns every push, because a push from anywhere else destroys the
review anchor and can strand a lane. Read-only `gh` stays unrestricted and is how you check live
tracker state. Identity for a script-covered write is the App that script mints, not a persona.

| Need                        | Command                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Open a lane                 | `pnpm lane:open [issue] [slug]`                                                             |
| Push; open or update the PR | `pnpm lane:publish <issue \| --lane <absolute-path>> [--relates] [--test "<instructions>"]` |
| Write the review bundle     | `pnpm review:prepare <pr>`                                                                  |
| Post `review.json`          | `pnpm review:publish <pr>`                                                                  |
| Reply `Done` and resolve    | `pnpm review:resolve <pr> --thread <id> --head <sha>`                                       |
| Squash-merge                | `pnpm deliver <pr>`                                                                         |
| Close a superseded PR       | `pnpm pr:supersede <old> --head <old-sha> --replacement <merged>`                           |
| Remove a spent lane         | `pnpm lane:remove <path>`                                                                   |

Credentials sit at the primary root (parent of `git rev-parse --git-common-dir`), gitignored:
`.env.sourdaw-author` for `lane:publish`, `review:resolve`, `deliver`, and `pr:supersede`;
`.env.sourdaw-reviewer` for `review:prepare` and `review:publish`. Do not commit them. Do not load
the other role's file. Author mint is `jcosta33-author[bot]`. Reviewer mint is
`jcosta33-reviewer[bot]`. `deliver` does not mint the reviewer.

The protected primary checkout is the launcher trust boundary for snapshot-backed GitHub writes.
Run `lane:publish`, `deliver`, and `issue:reconcile` through its package route. The launcher and the
command's whole script closure must match one pinned `origin/main` commit and are read only from the
primary repository; lane files are data, never executable delivery code. A lane that predates the
launcher contract or merely trails `main` therefore publishes or delivers without merging first.

This boundary isolates lane-controlled files, not arbitrary code already running as the operator.
The operator environment before the primary launcher starts is trusted, and processes under that
same account can read its credential files. Snapshot and token-bearing children discard Node
loader/preload settings and Git, GitHub CLI, GitHub Actions, and App overrides, then use the launcher
resolved `git` and `gh` executables.

Hosted checks run. `.github/workflows/health-gates.yml` has two lanes: a fast one on every push to
a pull request, and a heavy one on an approving review, on a nightly schedule, and on dispatch. Only
`gate` is required by the ruleset, and only `gate` may be — it depends on every other job and passes
when each either succeeded or was skipped, so a pull request that skips a path-filtered leg still
reports a conclusion. Requiring a filtered job by name would leave it pending forever. Do not rename
`gate`.

Hosted checks exist so that nobody runs those checks on this machine. Lanes share one machine, and
several agents each running a repository-wide typecheck, lint, or suite exhaust it and stall each
other — which is the cost the resource guard was invented to ration and CI removes outright.

So run locally only what is genuinely cheap and genuinely yours: the spec you just wrote or changed,
lint on the files you touched. Push, and let the pipeline run the rest. Do not run `lint:full`,
`typecheck`, `deps:validate`, the unit suite, cargo, wasm, or end-to-end locally to satisfy a gate —
the pipeline runs all of them on every push, and a second copy on this machine buys nothing but
contention.

`main` is covered by a ruleset. Read what it actually does: it blocks deletion and non-fast-forward,
forces a squashed pull request, and demands resolved threads. Whether it also requires `gate` is
repository configuration, not something this file can promise.

Some crates compile to wasm packages that ship as committed artifacts. `scripts/wasm-artifacts.ts`
is the list, and it carries each package's build script because that name is not derivable from the
crate — guess it and you run a script that does not exist. A non-test edit anywhere in such a
package's path-dependency closure, a comment included, changes its hash: run that package's own
build script, then `pnpm wasm:manifest`, then stage the rebuilt artifacts and verify after staging
rather than after building. Rebuilding the wrong package is worse than rebuilding nothing, because
`wasm:manifest` preserves the recorded hash of every package the run has no evidence it rebuilt —
the manifest agrees and the artifact is stale. `pnpm wasm:all` covers all of them when in doubt. A
rebase can merge cleanly and still leave wasm stale; `pnpm wasm:verify` is the only proof of
freshness.

`lane:publish` names the lane it resolved, then prints the PR number last. Invoke it from the
protected primary checkout. An issue number resolves an issue lane by branch prefix; `--lane` takes
the absolute worktree root of an issueless or off-convention lane. It pushes without `--force`, and
refuses any lane with uncommitted changes: commit the work yourself with a conventional subject
first.

A conforming `agent/` lane also gets a written pull request: `lane:publish` titles it with the
newest non-merge commit the lane holds above `origin/main` (`type(scope): subject`), so merging
`origin/main` in never retitles it, keeps the required headings in
[`.github/pull_request_template.md`](./.github/pull_request_template.md) nonempty and within 4000
bytes. A new pull request requires explicit `--test` instructions. For product changes, How to test
states user- or reviewer-observable steps and the expected result; automated author or CI checks are
not a substitute. Developer-facing or internal changes may name their actual validation interface.
Later publishes preserve a valid existing How-to-test section when `--test` is omitted and replace
it when `--test` is supplied. Screenshots is offered rather than required: it is written, and the
template keeps it, but a body without it still merges, because a section whose canonical content is
`None.` gates nothing. Issue lanes use `Closes #<issue>` by default; campaign slices use `--relates`
to write `Related #<issue>` without closing the campaign. Later publishes preserve that relationship.
Related tickets reads `None.` only for a lane whose branch carries no issue. It refuses a
conforming lane carrying no non-merge commit above `origin/main`, for the same reason it needs one
to title the pull request. It does not enable auto-merge or post a review.

An author-locked, off-convention branch may also publish through `--lane <absolute-path>`, but only
once the repository already has an open pull request for that exact branch, which is what proves the
worktree a genuine, if stranded, lane rather than one locked for an unrelated purpose. That path
never writes a title or body: pushing is the whole of what publishing it means, so it leaves the
pull request exactly as its owner wrote it, and it refuses outright if that pull request is no longer
open by the time the push lands.

Write the pull request for a teammate who was not in the session. Under the template headings,
say what changed, why, and how to test. Leave session diaries, unpublished rounds, and mutation
tables off the pull request.

`review:prepare` prints a bundle path on the primary root: `manifest.json`, `diff.patch`, `pr.md`,
and base-commit `contracts/`. The caller writes `review.json` for **this** head. A reviewer agent
gets that bundle, not the author transcript. `review:publish` prints the review id and posts as
`jcosta33-reviewer[bot]` only while GitHub's head still matches the bundle.

Review the diff as that teammate. Read every changed line. If a hunk is not enough to judge, read
the surrounding code. When something is wrong, comment on that line: what is wrong, why it matters,
what done looks like. One problem per comment. Talk about the code, not the author.

Request changes when this head must not merge, and post every blocking comment with that review. The
summary is a short pointer to those comments, not a report.

Approve when the change improves the system, even if it is not perfect. Do not approve a change that
makes it worse. Style-guide violations block; personal style does not. Leave the approval empty or
write one sentence about the code.

Keep an approval free of inline comments. Every inline comment opens a review thread, the ruleset
refuses to merge while one is unresolved, and `review:resolve` clears a thread only by replying
`Done` on it — so a note meant not to block is exactly what blocks, and clearing it asserts a repair
that never happened. Put a non-blocking observation in the approval body, prefixed `Nit:` or
`Optional:`, or file it. Inline comments belong to a `CHANGES_REQUESTED` review, where the thread is
meant to stop the merge and a new head clears it.

When answering, push the fix first; `review:resolve` then posts a bare `Done` as the author bot and
resolves the thread, pinned to that head. The reply body is fixed and no script writes free-form
thread text, so a finding you judge wrong has no route on the thread: only a new head that addresses
it clears one, which is why a finding is validated before it is ever posted. Clarify the code, not
the thread. File out-of-scope feedback; do not grow the PR. Resolve a conversation only when the
current head actually addresses it. A new head needs a new review.

Before merge the orchestrator does its own final check on the current head: read the diff, confirm
the change does what it was specified to do, confirm every finding it accepted is actually addressed
there, and read the pipeline's result for that head. The checks are the pipeline's job, not a second
local run of the same commands — that is what `Gate` reports, and a green `Gate` on this head is the
evidence. Formatting is the exception worth doing locally, because it rewrites rather than reports:
run it on the changed files and stage what it rewrote.

What the orchestrator still owns is the judgement no check makes. A green pipeline says the gates
passed, not that the change does what it was specified to do, that a test observes what its name
claims, or that a finding was addressed rather than silenced. Read the diff for those.

Unrelated `origin/main` movement does not by itself stale a review. Re-review when the feature head
changes in a way that touches the reviewed surface, and when you resolve conflicts. Base
compatibility is GitHub's ordinary mergeability gate: if the pull request is no longer `CLEAN` or
its base branch changes, the pipeline runs again on the head that will actually merge.

An approval alone is weak evidence, so every consequential claim carries discriminating proof — a
test that fails when the change is reverted, a measurement at the boundary users experience. That
proof stays in the session; it is not the GitHub review.

`pnpm deliver` squash-merges only after `jcosta33-reviewer[bot]` `APPROVED` the current head, the
pull request is not a draft, merge state is `CLEAN`, and threads are resolved. It merges into `main`
and nothing else: `lane:publish` opens every pull request there, so any other base is a retarget the
delivery scripts did not make, and `deliver` refuses it rather than squashing onto a branch the
change was never reviewed against. Do not merge any other way.

Keep batches small, live lanes few, merges prompt. A finished change waits only on that GitHub
review. Enable hooks: `git config core.hooksPath .githooks`.

## Safety

- Preserve unrelated changes. Stage only files you changed.
- Never run destructive git, force-push, amend published history, or delete branches without
  explicit authority.
- Never install packages or edit CI/build controls unless the task requires it.
- Never widen a formatter, codemod, or autofix past the files your change owns. Always pass explicit
  file targets to `pnpm format` and `pnpm cargo:fmt`; repository-wide formatting is `format:full`
  and runs only when explicitly requested.
- Reproduce behavioral defects before repair. After three failed attempts, stop and change strategy.
