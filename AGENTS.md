# Sourdaw Agent Rules

`CLAUDE.md`, `GEMINI.md`, `CODEX.md`, `KIMI.md`, and `ZCODE.md` point here. A nested `AGENTS.md` (with
companion provider symlinks) overrides this file inside its subtree. Read the local one before
editing that tree.

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
conditions, and checks. An acceptance condition names an observable — an event, a counter, a
figure a caller reads — traced to the line that produces it before the dispatch is written, and
a prescribed mechanism is traced to every code route it has to cover: a spec that asserts an
observable nothing emits, or a mechanism that reaches only one of the routes it has to cover, is
an orchestrator defect the author will faithfully implement. Specify the whole design before
dispatching, never one review finding at a time. Require back only status, changed paths, decisive
evidence, and blockers.

Run agents in parallel only on write-disjoint work. Sequence shared contracts, generated artifacts,
and overlapping files.

## Review

Reviewers are blind. Each one gets the head, the diff, and exactly one stance — never another
reviewer's prose, the author's transcript, or the orchestrator's reasoning. Independence is the
entire value, and a reviewer shown prior findings anchors to them. Reviewers never confer: findings
meet only in the orchestrator.

Assign one independent stance per material risk. Expect about three on a typical PR; never add a
stance to meet that number or omit one to stay near it. The recurring surfaces are correctness,
module boundaries and contracts, real-time audio safety, project integrity and undo, security and
platform boundaries, code craft and readability (naming quality, local complexity, nesting,
semantic clarity, conformance to `docs/07-conventions.md`), and test validity.

Tier each reviewer by the criticality of its stance, not the size of the diff: economy for narrow
low-risk checks, standard for behavioral and integration risk, the strongest tier for real-time
audio, security, data loss, irreversible change, or a disputed severe finding. The shape of the
change escalates too: wide diffusion across modules, heavy churn on a defect-prone surface, or a
surface many recent lanes have touched raises the tier whatever the diff is about. A stance at the
strongest tier may be drawn twice, from different models, and merged by the orchestrator, because
independent draws surface different findings; that extends the model-diversity rule and licenses no
extra stance to reach a number.

Review test validity as its own stance. A passing check is not evidence. Ask what would have to
break for this check to fail, and whether it observes the thing its name claims. The standard probe
is mechanical — revert the behavioural hunk, or apply one targeted mutation, and run the named
spec; a spec that stays green has failed the stance. The reviewer names that probe; performing it
belongs to the orchestrator's validation or the author's repair, inside a lane that exists for the
change, because a reviewer holds no writable tree.

Each reviewer's stance names a posture, not only a surface. A reviewer's job is to try to break the
change and report the strongest thing it found — with a concrete failure scenario, the inputs or
state that produce the wrong behaviour — or to report that nothing survived its attempts. Nothing
surviving is a successful review, not a wasted one, and a reviewer must never manufacture a finding
to justify its run. A hedged finding — one that says a thing might or could be a problem without
naming what breaks — is discarded on arrival, and reviewers are told so when dispatched.

The evidence a finding owes scales with what it claims. A finding is checked against the live head,
not inferred from the diff alone — a hunk shows what changed, not what the code now does, and a
finding reasoned only from it guesses at surrounding code never read. A finding that would block a
merge carries the reproduction that produced it: the input, the state, or the mutation, and the
result observed. A test-validity finding names the mutation that should have failed the check and
did not.

The orchestrator owns every finding. Validate each one against the live code before acting on it:
discard what is wrong, out of scope, or personal style, and never forward it. Send the survivors to
the implementing agent as a precise repair task, in the orchestrator's own words: reviewer prose
anchors the author exactly as it anchors another reviewer. An implementing agent never judges a
finding against its own work, never accepts that work, and never merges it. The orchestrator writes a
discarded finding, with its one-line reason, into the review bundle as `discarded.json`, beside
`review.json` — the same way the caller writes `review.json` itself; no script produces either file.
Discarding is the orchestrator's own judgement about a blind reviewer's work, and an unrecorded
discard is indistinguishable from never having read the finding.

Order matters, because the pull request is public and a posted finding is expensive to retract.
Blind stances report to the orchestrator, never straight to GitHub. Only findings that survive
validation are composed into `review.json` and posted by `review:publish`; a discarded one never
reaches the pull request. Getting this backwards traps the merge: `deliver` refuses a pull request
that carries `CHANGES_REQUESTED` or an unresolved thread, and a conversation may only be resolved
when the head actually addresses it — so a finding posted and then judged wrong blocks delivery
with nothing left to fix.

Validation is a filter, not a substitute for the record. A validated blocking finding is posted
before it is repaired: the orchestrator composes the survivors into a `REQUEST_CHANGES` review and
posts it through `review:publish` on the head they were found against, then dispatches the repair.
The author answers each thread with a fixed head and `review:resolve`, and the repaired head gets a
fresh round. Repairing a validated blocker first and approving the repaired head in one motion is
forbidden, however much faster it is: it erases the review from the public record, and a pull
request that merges with no visible finding is indistinguishable from one nobody attacked. Every
pull request that drew a validated blocker therefore carries the exchange on its public record —
the reviewer identity's findings standing against the head that earned them, and the author
identity's answering pushes and `Done` replies — while the orchestrator's judgement is evidenced by
the scripts only it runs and by `review.json` and `discarded.json` in the bundle, never by a
persona on the pull request.

A defect that reaches `main` is fixed under Ownership, but never only fixed. The orchestrator
traces it to the pull request that introduced it and the stance that should have caught it —
missing, mis-tiered, or mis-prompted. The lesson has a durable home: a stance's dispatch guidance
lives as a tracked file under `.agents/skills/`, and an escape lesson is an edit to that stance's
file, so a cold orchestrator inherits every prior escape. Escapes are the only measure a review
architecture has; one that never learns from them is unmeasured, not proven.

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
<command>`. Estimate peak RAM from the latest observed guard peak or the nearest command; without
  an estimate the guard applies the profile ceiling, raised to the measured budget it records for
  known heavy scripts, and an RSS kill prints the budget it applied — record a budget above the
  observed peak in the guard's `measuredScriptBudgets`, never in a note. The guard waits until free
  RAM covers active reservations, this command, and the system reserve. Never bypass it. A timeout,
  RSS kill, or memory-monitor failure is a stop.
- Run only checks that can fail because of the changed files. Never expand to repository-wide tests,
  lint, coverage, E2E, builds, Cargo, WASM, or measurements unless explicitly requested.
- Name exact affected test files. Shared code never justifies guessed or expanded test scope.
- Never use watch mode for verification. Start a server only when the task needs it.

## Checks

| Need                      | Command                                      |
| ------------------------- | -------------------------------------------- |
| Focused tests             | `pnpm test:run <file-or-narrow-directory>`   |
| Focused E2E               | `pnpm test:e2e <spec>`                       |
| Focused lint              | `pnpm lint <changed-files>`                  |
| Focused format            | `pnpm format <changed-files>`                |
| App types                 | `pnpm typecheck`                             |
| Test types                | `pnpm typecheck:test`                        |
| Script types              | `pnpm typecheck:scripts`                     |
| E2E types                 | `pnpm typecheck:e2e`                         |
| Focused Rust tests        | `pnpm cargo:test --package <crate> <filter>` |
| Focused Rust format       | `pnpm cargo:fmt --package <crate>`           |
| Module boundaries         | `pnpm deps:validate`                         |
| Barrel mocks              | `pnpm test:barrel-mocks`                     |
| Rebuild one wasm pkg      | that package's own `wasm:*` script           |
| Rebuild every wasm        | `pnpm wasm:all`                              |
| Rewrite wasm manifest     | `pnpm wasm:manifest`                         |
| Prove wasm freshness      | `pnpm wasm:verify`                           |
| Restamp a dependency bump | `pnpm release:restamp`                       |

Tests use at most two workers. Playwright uses one. See [testing](./docs/06-testing.md).

Rerun-to-green is forbidden as a response to failure: never re-run a failed check to make it pass,
never bump a head to reroll one, and never read a pass produced by a retry as clean. Committed test
infrastructure may retry on its own and report the run green; that reporting discharges nothing — a
result that needed a retry is a flaky result, and it creates the same duty a failure does. A
failure that vanishes on retry with no relevant change is a defect with a name — a race, an
ordering or isolation dependency, leaked state, or environment — and it gets a fix, a lane, or an
issue; green-by-retry launders a failure exactly as a weakened test does. In a DAW the retried
"flake" is disproportionately likely to be a real timing defect, because concurrency and scheduling
are where flakiness and product risk coincide.

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

## Code craft

Universal rules, wherever code is written:

- Simplest construct that expresses the intent. Conventional, framework-agnostic
  patterns over JavaScriptisms.
- Functional by default: pure functions, immutable data, composition over classes and
  mutation.
- Guard clauses and early returns over nesting; the happy path reads top to bottom.
- Break code down semantically: small functions named for the one thing they do. A block
  that needs a comment to be understood gets extracted and named instead.
- Comment only what cannot be made self-explanatory — the why, or non-obvious mechanics.
  A comment narrating what simple code does is a smell.
- Clever code is a defect even when it works.

Detail: [conventions](./docs/07-conventions.md).

## Worktrees

One change, one lane, one pull request. Never edit tracked files in the primary checkout: it is the
shared root that holds the credentials and every other lane, and an edit there belongs to no branch.
All mutable source work lives in a lane under `.agents/worktrees/`. Its gitignored operational
paths are the exception the delivery scripts require: `review:prepare` writes bundles to
`.agents/review-bundles/` at that root, the caller writes `review.json` beside them, and the
`.env.sourdaw-*` credentials live there.

`pnpm lane:open [issue] [slug]` fetches `origin/main`, branches from it, and locks the lane
`active:sourdaw-author`. It stays offline past that fetch and never mints or spawns `gh`. A slug is
never purely numeric, because a bare number is read as the issue. Supply the issue number when the
work has a ticket; the branch is then `agent/<issue>/<slug>`, and without an issue `agent/<slug>`.
The pull request closes that issue by default; campaign slices use `lane:publish --relates` to keep
the umbrella open. Touch only your own lane.

A lane isolates the working tree and nothing else. The stash, the process table, the disk, and the
author lock are shared across every lane, so a global or destructive operation run inside one lane
hits all of them.

`pnpm lane:remove <path>` from outside the lane. The author lock stays until removal succeeds.
Removal requires a clean lane holding the head of exactly one pull request whose work reached
`main`. Merging is one way there. Being superseded is the other: `pr:supersede` closes the old pull
request unmerged but leaves a receipt naming the replacement, and removal reads that receipt and
requires the replacement to be merged. Any other closed pull request is an abandonment, and removing
it would discard work that never landed — so an abandonment leaves through `lane:strand`, a receipted
exit rather than a weakened gate. `lane:strand` refuses a lane holding an open pull request or
uncommitted work, and writes a receipt under the primary checkout recording the abandoned tip so it
stays recoverable; a receipt already naming the same lane with a different head is refused, never
overwritten. Delete a leftover local branch after a `lane:remove`.

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
labels naming what it is. Set the milestone when the work belongs to one — by title, never the
number the tracker UI shows, which is rejected against **open** milestones so nothing is filed — and
add the issue to the roadmap project when it is on the roadmap, leaving either empty rather than
forcing a fit. Do all of it on the `issue:file` command, and get the metadata right there, because
no sanctioned script edits an issue once it exists and a correction afterwards is `gh` by hand. Read
the live sets with `gh label list`, `gh api repos/:owner/:repo/milestones`, and
`gh project list --owner <owner>`; never from a list written down here, which drifts the day it is
written.

## Delivery

GitHub writes for agent work go through trusted `pnpm` scripts. Where a script covers the action it
is the only way to take it: identity and the delivery gates live inside those scripts, so a
hand-rolled equivalent or a route around a gate defeats both. One exception is open, and it is
closed by list: an issue's own state, labels, milestone, project membership, and sub-issue links may
be corrected by hand with `gh`. Nothing else may. A pull request is not an issue, so no `gh pr`
write ever falls inside, whatever flag or field it names. A by-hand write is attributed to the
operator's own account rather than to a mint, and so reads as the operator acting personally; that
is why the exception stops at issue metadata one later command puts back: identity for a
script-covered write is the App that script mints, never a persona. `git push` has no exception at
all: lane tooling owns every push, because a push from anywhere else destroys the review anchor and
can strand a lane. Remote branch deletion is likewise script-covered: `branch:prune` removes only
branches whose every pull request is merged or closed, and a dry run is its default. Read-only `gh`
stays unrestricted and is how you check live tracker state.

| Need                        | Command                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Open a lane                 | `pnpm lane:open [issue] [slug]`                                                                                  |
| Push; open or update the PR | `pnpm lane:publish <issue \| --lane <absolute-path>> [--relates] [--summary "<text>"] [--test "<instructions>"]` |
| Write the review bundle     | `pnpm review:prepare <pr>`                                                                                       |
| Post `review.json`          | `pnpm review:publish <pr>`                                                                                       |
| Reply `Done` and resolve    | `pnpm review:resolve <pr> --thread <id> --head <sha>`                                                            |
| Squash-merge                | `pnpm deliver <pr>`                                                                                              |
| Recover a crashed delivery  | `pnpm deliver --recover-lock <pr> --owner <oid>`                                                                 |
| Close a superseded PR       | `pnpm pr:supersede <old> --head <old-sha> --replacement <merged>`                                                |
| Prune spent remote branches | `pnpm branch:prune [--apply] [--limit <n>]`                                                                      |
| Remove a spent lane         | `pnpm lane:remove <path>`                                                                                        |
| Strand an abandoned lane    | `pnpm lane:strand <path> --reason "<text>"`                                                                      |
| Prune lane artifacts        | `pnpm lane:prune <path> \| --all \| --stale-days <days>`                                                         |

Two gitignored credential files sit at the primary root (parent of `git rev-parse --git-common-dir`):
`.env.sourdaw-author` and `.env.sourdaw-reviewer`. Each script loads its own role's file. Do not
commit them. Do not load the other role's file. Delivery authenticates the author and reviewer roles
by their immutable bot actor node IDs in `scripts/githubAppIdentity.ts`; mutable App slugs and bot
logins are display only. The two role IDs are never interchangeable. `deliver` does not mint the
reviewer.

`deliver` serializes each pull request through a per-PR Git ref in the protected primary checkout.
The ref points to a strict owner blob; acquisition is a zero-ref Git compare-and-swap and release
requires the acquired object ID. Delivery holds that ownership from before authentication through
merge or already-merged recovery and tracker completion. Any existing owner is validated and then
refused without waiting or automatic takeover, regardless of process liveness. A crashed delivery
leaves its ref in place, and `deliver --recover-lock` is the only route that clears one: it refuses
while the owner's recorded process fence still probes live, adopts the lock under its own fence
before reading anything, and then reads the remote twice and requires the two observations to
agree. Recovery never merges, retargets, posts, or closes, and it refuses a pull request merged by
any actor other than the author App. Clearing the ref records a receipt keyed by the dead owner, so
repeating the recovery replays that receipt instead of reaching GitHub again.

Already-merged recovery proceeds only when GitHub's immutable merged-by actor is the author App.
Same-head delivery receipts retain the issue-comment REST endpoint's ascending comment-ID order;
that immutable response order decides adjacency and newest authority, while timestamps only prove
that an App-owned comment remained unedited.

The protected primary checkout is the launcher trust boundary for snapshot-backed GitHub writes.
Run `lane:publish`, `deliver`, and `issue:reconcile` through its package route. The launcher and the
command's whole script closure must match one pinned `origin/main` commit and are read only from the
primary repository; lane files are data, never executable delivery code. A lane that predates the
launcher contract or merely trails `main` therefore publishes or delivers without merging first.

This boundary isolates lane-controlled files, not arbitrary code already running as the operator.
The operator environment before the primary launcher starts is trusted, and processes under that
same account can read its credential files. Snapshot and token-bearing children discard the
environment overrides that could redirect them — Node loader and preload settings, and Git, GitHub
CLI, GitHub Actions, and App configuration — and use the launcher-resolved `git` and `gh`.

Hosted checks run across four workflow files, and the split between them is a security boundary
rather than an organising preference. `Gate` is a required status check on `main`, by owner
decision: it must pass on the pull-request head. The ruleset is non-strict, so the head need not
carry `main` first — taking `main` is required only on a real conflict or when mergeability
demands it. GitHub counts a check run whose conclusion is `skipped` as satisfying a required
check, and prefers the newest run of that name — so any event that can reach the file minting `Gate`
and legitimately skip it mints a passing `Gate` over a red head. A `pull_request_review` trigger did
exactly that in production. Therefore:

- `.github/workflows/health-gates.yml` answers to `pull_request` alone and mints `Gate`. Its `gate`
  job carries `!cancelled()` and no other predicate, because any predicate that can be false is the
  hole. Do not add a trigger to this file, and do not rename `gate`.
- `.github/workflows/validation.yml` is the shared lane — types, lint, boundaries, the unit matrix,
  build, Rust, the natives, the offline smoke set, the diff secret scan, dependency review — called
  by `health-gates.yml` and `heavy-gates.yml` so there is one definition rather than two that drift.
- `.github/workflows/heavy-gates.yml` owns the review event and the jobs that cannot fit a push
  budget: the end-to-end matrix, the Browser AI hardware proof, CodeQL, and the full-history secret
  scan. Its summary is `HeavyGate` and is deliberately not ruleset-required.
- `.github/workflows/nightly.yml` owns the schedule and dispatch events: the full train, and the
  nightly failure report. It is the only production web deploy — `vercel.json` turns the Git
  integration off, so reaching `main` deploys nothing by itself.

No job outside `health-gates.yml` may be named `Gate`.

So `unit` decides the required check, through the validation lane it lives in, on every run that
touches the web scope. The end-to-end suite does not: no pull-request run executes it, so naming it
in `Gate` would have listed an always-skipped job and claimed coverage the check never had. It
decides `HeavyGate` on approving-review runs and gates hard on the nightly train. The ruleset
requires one approving review, and that review triggers the heavy lane, but no required check makes
the merge wait for the lane's verdict, so nothing today forces that suite to have passed against a
head before it lands; its merge enforcement arrives when `deliver`'s required-CI admission
is armed, which is a separate change. The earlier policy of keeping pull-request-editable workflows
out of merge authority is superseded — a head that softens its own gate is caught by review of that
file like any other reviewed code — but note what that leaves: the ruleset is the only CI merge
authority while `deliver`'s admission stays advisory.

Those checks exist so that nobody runs them on this machine. Never run a repository-wide check
locally to satisfy a gate the pipeline already runs on every push; Resource Safety governs what
stays local.

`main` is covered by a ruleset. Read the live one rather than trusting a copy here — it blocks
deletion and non-fast-forward, forces a squashed pull request, requires one approving review with
the last push approved, demands resolved threads, and requires `Gate` on the pull-request head, but
the enforcement that actually holds is repository configuration, not something this file can
promise. The ruleset is non-strict: the head need not
carry `main` before it can merge, so a lane that has fallen behind still delivers without merging
`origin/main` — unless there is a real conflict or GitHub cannot merge the head, and taking `main`
then produces a new head, which needs a fresh `Gate` and a fresh review.

Some crates compile to wasm packages that ship as committed artifacts. `scripts/wasm-artifacts.ts`
is the list, and it names each package's build script because that name is not derivable from the
crate — guess it and you run a script that does not exist. A non-test edit anywhere in such a
package's path-dependency closure, a comment included, changes its hash: rebuild that package,
rewrite the manifest, stage the artifacts, and verify after staging rather than after building.
The workspace-root `Cargo.toml` is the one exception: it contributes only its profile tables, its
workspace package table, its patch and replace tables, the resolver line, and the workspace
dependency entries the closure resolves, rendered canonically, so a new member, a comment, or an
unrelated workspace dependency there does not move the hash. Rebuilding the wrong package is worse
than rebuilding nothing, because `wasm:manifest` preserves the recorded hash of every package the
run has no evidence it rebuilt — the manifest agrees and the artifact is stale; `pnpm wasm:all`
covers all of them when in doubt. A rebase can merge cleanly and still leave wasm stale, so
`pnpm wasm:verify` is the only proof of freshness.

`lane:publish` pushes without `--force`, and refuses any lane with uncommitted changes: commit the
work yourself with a conventional subject first. An issue number resolves its lane by branch prefix;
`--lane` names an exact absolute lane root, which is what disambiguates write-disjoint lanes sharing
one issue.

A conforming `agent/` lane also gets a written pull request. `lane:publish` titles it, when opening,
from the newest non-merge commit the lane holds above `origin/main`, and never retitles it
afterwards, so a follow-up commit or a merge of `origin/main` cannot rewrite the title. The body
follows [`.github/pull_request_template.md`](./.github/pull_request_template.md), and the script is
authoritative about that format: it refuses a malformed body, a new pull request requires explicit
`--summary` and `--test`, and supplying either later replaces that section while omitting it
preserves what is already there. It refuses a conforming lane carrying no non-merge commit above
`origin/main`, for the same reason it needs one to title the pull request. It does not enable
auto-merge or post a review.

An author-locked, off-convention branch may also publish through `--lane <absolute-path>`, but only
once the repository already has an open pull request for that exact branch, which is what proves the
worktree a genuine, if stranded, lane rather than one locked for an unrelated purpose. That path
never writes a title or body: pushing is the whole of what publishing it means, so it leaves the
pull request exactly as its owner wrote it, and it refuses outright if that pull request is no longer
open by the time the push lands.

Write the pull request for a teammate who was not in the session. Under the template headings, say
what changed and why — not the title again — and how to test it: for a product change, user- or
reviewer-observable steps and the expected result, never an automated author or CI check standing in
for them; developer-facing or internal work may name its actual validation interface. Leave session
diaries, unpublished rounds, and mutation tables off the pull request.

`review:prepare` prints a bundle path on the primary root: `manifest.json`, `diff.patch`, `pr.md`,
and merge-base `contracts/`. The bundle's `baseSha` records the merge-base between `origin/main` and
the pull request head, and `diff.patch` captures the diff against that merge-base so that advances on
`main` never appear as deletions the pull request makes. The caller writes `review.json` for **this**
head, and later `discarded.json` beside it. The bundle path is keyed by head sha, so re-preparing
for that same head replaces only the generated files and never discards what the caller wrote there.
A reviewer agent gets that bundle, not the author transcript. `review:publish` prints the review id
and posts through the reviewer App only while GitHub's head still matches the bundle.

Review the diff as that teammate. Read every changed line. If a hunk is not enough to judge, read
the surrounding code. When something is wrong, comment on that line: what is wrong, why it matters,
what done looks like. Supply that as three fields keyed literally `defect`, `consequence`, and
`done` — the retired single `body` key is refused, and the error names the replacement. Each field
is a single line, non-empty, with no leading or trailing whitespace. The tooling joins the three
with a space, appending a period to any field that does not already end in terminal punctuation, and
the composed comment must fit within 600 bytes, measured in bytes rather than characters. The
contract caps length rather than demanding a minimum: padding a comment to reach a length is not a
virtue, and one precise sentence per field is the target. One problem per comment. Talk about the
code, not the author.

Request changes when this head must not merge, and post every blocking comment with that review. The
summary is a short pointer to those comments, not a report.

Approve when the change improves the system, even if it is not perfect. Do not approve a change that
makes it worse. Style-guide and code-craft violations block; personal style does not. An approval is
never empty: its body states what the reviewer attacked and what held.

Keep an approval free of inline comments. Every inline comment opens a review thread, the ruleset
refuses to merge while one is unresolved, and `review:resolve` clears a thread only by replying
`Done` on it — so a note meant not to block is exactly what blocks, and clearing it asserts a repair
that never happened. `review:publish` refuses an APPROVE document that carries any comments: the
contract does not depend on reviewer discipline to keep one out. Put a non-blocking observation in
the approval body, prefixed `Nit:` or `Optional:`, or file it. Inline comments belong to a
`CHANGES_REQUESTED` review, where the thread is meant to stop the merge and a new head clears it.

When answering, push the fix first; `review:resolve` then posts a bare `Done` as the author bot and
resolves the thread, pinned to that head. The reply body is fixed and no script writes free-form
thread text, so a finding you judge wrong has no route on the thread: only a new head that addresses
it clears one, which is why a finding is validated before it is ever posted. Clarify the code, not
the thread. File out-of-scope feedback; do not grow the PR. Resolve a conversation only when the
current head actually addresses it. A new head needs a new review.

Before merge the orchestrator does its own final check on the current head: read the diff, confirm
the change does what it was specified to do, that a test observes what its name claims, and that
every accepted finding is actually addressed there rather than silenced. On the push lane no leg
is softened any more, so a red suite there reports as a red `Gate` rather than as a warning
annotation, and `Gate` is required — a failure in that lane now blocks the merge instead of
merely informing it. The heavy-lane suites — the end-to-end matrix, the Browser AI admission,
CodeQL, and the secret scan — report into `HeavyGate`, which is deliberately not
ruleset-required: they inform the merge rather than block it until `deliver`'s required-CI
admission arms. That raises rather than lowers what the orchestrator owes: a green `Gate` says
the gates passed, not that the change does
what it was specified to do, that a test observes what its name claims, or that a finding was
addressed rather than silenced. Read the diff for those. An unexplained failure is still attributed
to the change, or to a named pre-existing defect and filed. The checks are the pipeline's job, not a
second local run of the same commands. Formatting is the exception worth doing locally, because it
rewrites rather than reports: run it on the changed files and stage what it rewrote.

Unrelated `origin/main` movement does not by itself stale a review. Re-review when the feature head
changes in a way that touches the reviewed surface, and when you resolve conflicts. Base
compatibility is GitHub's independent structural mergeability gate. Delivery retries one transient
`UNKNOWN` result and refuses a conflict or a second `UNKNOWN`; CI's aggregate merge-state label does
not substitute for that structural answer.

An approval alone is weak evidence, so every consequential claim carries discriminating proof — a
test that fails when the change is reverted, a measurement at the boundary users experience. That
proof stays in the session; it is not the GitHub review.

`pnpm deliver` squash-merges only after the immutable reviewer actor `APPROVED` the current head at
both validation points, the pull request is non-draft and structurally mergeable, and every review
thread is resolved at both points. Head, head branch, base branch, body, canonical closing target,
and stacked dependents must remain stable between those reads. CI admission is snapshot-backed and
currently advisory: successful, failed, pending, absent, cancelled, malformed, and unavailable CI
evidence do not block an otherwise valid delivery. The live `main` ruleset's required `Gate` check is
enforced by GitHub itself regardless of this script's own CI admission mode, so `deliver` reads a
`BLOCKED` merge state and refuses before any remote write — never posting the receipt or attempting
the merge — rather than discovering that refusal from the merge endpoint after mutating. The dormant
required-CI path retains the pinned workflow-derived gate and complete-rollup rules the trusted
launcher reads from the pinned
`origin/main` workflow copy for a future authority change; a lane cannot select it or reshape it.
Delivery merges into `main` and nothing else: `lane:publish` opens every pull request there, so any
other base is a retarget the delivery scripts did not make, and `deliver` refuses it rather than
squashing onto a branch the change was never reviewed against. Do not merge any other way.

Keep batches small, live lanes few, merges prompt. A diff too large for its reviewers to attack
whole is too large to merge whole, and splitting it is the author's obligation, not the reviewer's
burden. Drain before filling: open no new lane while a finished head waits only on review or merge.
A finished change waits only on that GitHub review. Enable hooks:
`git config core.hooksPath .githooks`.

## Safety

- Preserve unrelated changes. Stage only files you changed.
- Never run destructive git, force-push, amend published history, or delete branches without
  explicit authority.
- Never install packages or edit CI/build controls unless the task requires it.
- Never widen a formatter, codemod, or autofix past the files your change owns. Always pass explicit
  file targets to `pnpm format` and `pnpm cargo:fmt`; repository-wide formatting is `format:full`
  and runs only when explicitly requested.
- Reproduce behavioral defects before repair. After three failed attempts, stop and change strategy.
