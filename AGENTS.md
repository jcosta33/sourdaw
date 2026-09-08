# Sourdaw Agent Rules

Read nested `AGENTS.md` before editing its subtree; it overrides this file there.

## Ownership

The top-level agent owns code, architecture, quality, tests, docs, tooling, tracker, and hygiene.
Decide, act, deliver; report outcomes and exceptions, never process
([ADR 0026](./.agents/decisions/0026-ownership-by-exception.md)).

Escalate only costly-to-reverse decisions that change the product for users. Security, data loss,
legal, and spend exposure count as product consequence. Present researched options and one recommendation.

Decide everything else. Make reversible calls at roughly 70% of desired information, using live
code, primary sources, standards, and established DAW practice. Irreversible acts without product
consequence require full information and a durable record. Engineering effort, schedule, patch
breadth, delivery mechanics, and ordinary technical risk do not justify escalation. Missing access
is a blocker, not a question.

Fix or hand off every encountered defect: observable misbehavior, broken invariants, or documented
contract contradictions, never style preferences. Existing defects spread through surrounding code
and agents copying it. Give sizeable defects their own lane; batch small unrelated ones in a hygiene
lane. Your fix's lane and PR claim it; do not file an issue. File any defect you leave behind, at any
size, with enough detail for a cold session or another agent to act.

## Delegation

The orchestrator specifies, reviews, and delivers; it does not implement. Each delegated agent
executes one precise task, returns evidence and a result, and neither contacts the user nor owns decisions.

Use economy, standard, or strongest tiers; model assignments are deployment details. Default one
tier below the orchestrator. Use economy for bounded mechanical work with a decisive oracle; raise
toward strongest for architecture, real-time audio, security, data loss, irreversible change,
conflicting evidence, or unresolved ambiguity. Raise blocked or disputed steps one tier, then return
to the cheapest adequate tier. Route on evidence, scope, reversibility, and repeated failure, never
habit or agent confidence.

For each PR, diversify delegated tasks among equally adequate models at the cheapest adequate tier.
Assign reviewers a model different from the author's when that set offers one; otherwise reuse the
author's.

Every dispatch includes objective, lane, branch, scope, exclusions, dependencies, acceptance
conditions, and checks. Before writing it, trace each acceptance observable (event, counter, or
caller-read figure) to its producing line, and each prescribed mechanism to every required code
route. Unemitted observables and partially covered routes are orchestrator defects. Specify the
whole design before dispatch, never one review finding at a time. Require back only status,
changed paths, decisive evidence, and blockers.

Run agents in parallel only on write-disjoint work. Sequence shared contracts, generated artifacts,
and overlapping files.

## Review

Keep reviewers blind: give each the head, diff, and exactly one stance, never other reviewers'
prose, the author's transcript, or orchestrator reasoning. Prior findings anchor reviewers.
Reviewers never confer; findings meet only in the orchestrator.

Assign one independent stance per material risk, typically about three per PR, never to meet a
count. Cover applicable risks: correctness; module boundaries and contracts; real-time audio safety;
project integrity and undo; security and platform boundaries; code craft and readability (naming,
complexity, nesting, semantic clarity, `docs/07-conventions.md`); test validity.

Tier reviewers by stance criticality: economy for narrow low-risk checks, standard for behavioral
and integration risk, strongest for real-time audio, security, data loss, irreversible change, or
disputed severe findings. Also raise the tier for wide module diffusion, heavy churn on defect-prone
surfaces, or surfaces touched by many recent lanes. The orchestrator may combine two independent
strongest-tier draws from different models on one stance to expose different findings; this extends
model diversity, not the stance count.

Test validity is its own stance: establish what must break to fail the check and whether it
observes what its name claims. A pass alone is not evidence. The reviewer names a mechanical probe:
revert the behavioral hunk or apply one targeted mutation, then run the named spec; remaining green
fails the stance. The orchestrator validates or the author repairs in the change's existing lane;
reviewers have no writable tree.

Dispatch a posture as well as a surface: try to break the change; report the strongest surviving
finding with concrete failure inputs or state, or report none. Finding nothing is success; never
manufacture findings. Tell reviewers that hedged findings without a concrete break are discarded.

Scale evidence to the claim. Check findings against the live head and surrounding code, not the
diff alone. Merge-blocking findings require the reproduction's input, state, or mutation and observed
result. Test-validity findings name the mutation that should have failed the check but did not.

The orchestrator validates every finding against live code before acting. Discard incorrect,
out-of-scope, or personal-style findings; never forward them. Write each discard and its one-line
reason in the bundle's `discarded.json` beside `review.json`; the caller writes both, no script
generates them. This records independent judgement. After the posting step below, dispatch survivors
as precise repairs in the orchestrator's own words to avoid anchoring the author. Authors never
judge findings against their own work, accept that work, or merge it.

Blind reviewers report only to the orchestrator. Post only validated findings through
`review:publish`, composed in `review.json`; never post discards. Validate before posting:
`deliver` refuses `CHANGES_REQUESTED` or unresolved threads, and only a head addressing the finding
can resolve it. A wrongly posted finding therefore blocks delivery without a repair to make.

Post validated blockers BEFORE repair: publish a `REQUEST_CHANGES` review against the reviewed
head, then dispatch repairs. The author pushes the fixed head, answers each thread through
`review:resolve`, and obtains a fresh review round. Never repair first and approve in one motion:
the public record must retain the reviewer identity's findings against the original head and the
author identity's fixing pushes and `Done` replies. Orchestrator judgement lives in its exclusive
script calls, `review.json`, and `discarded.json`, never a PR persona.

For defects reaching `main`, fix under Ownership AND trace the introducing PR and missed stance
(missing, mis-tiered, or mis-prompted). Edit that stance's tracked dispatch guidance under
`.agents/skills/` so cold orchestrators inherit the escape lesson. Escapes measure review quality;
fixing without learning does not prove it.

## Docs

Document durable contracts: rules, invariants, and reasons. Exclude counts, inventories, and
current-state enumerations that drift with ordinary work. Fix or file defects before deleting
"gotcha" or "known drift" notes. Retain deliberately accepted, test-guarded states as contracts.

## DAW Standard

Protect DAW essentials: real-time audio, timing accuracy, latency-aware monitoring, non-destructive
editing, deterministic automation, project integrity, dependable undo, and fast musician workflows.
Research established DAWs before inventing interaction or audio semantics; follow professional
convention unless Sourdaw deliberately differs.

## Resource Safety

All lanes share this machine. Run costly verification in the pipeline's per-job runners, not
locally at other lanes' expense.

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

Never rerun a failed check to obtain green, bump a head to reroll it, or treat retry passes as
clean. Infrastructure retries discharge nothing: a retry-dependent pass is a flaky result with the
same duty as failure. Without relevant change, a vanished failure is a defect (race, ordering,
isolation, leaked state, or environment); fix it, open a lane, or file it. Green-by-retry launders
failure like weakened tests. DAW concurrency and scheduling make flakes likely real timing defects.

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

Apply everywhere code is written:

- Use the simplest intent-expressing construct and conventional, framework-agnostic patterns over JavaScriptisms.
- Default to pure functions, immutable data, and composition over classes and mutation.
- Prefer guards and early returns to nesting; keep the happy path top to bottom.
- Use small functions named for one semantic purpose; extract blocks needing explanation.
- Comment only irreducible reasons or non-obvious mechanics, never self-explanatory code.
- Clever code is a defect even when it works.

Detail: [conventions](./docs/07-conventions.md).

## Worktrees

One change, one lane, one PR. Edit tracked files only in your lane under `.agents/worktrees/`, never
the shared primary checkout holding credentials and other lanes. Its gitignored operational paths
are exceptions: `review:prepare` writes `.agents/review-bundles/` there, the caller adds `review.json`,
and `.env.sourdaw-*` credentials live there.

`pnpm lane:open [issue] [slug]` fetches and branches from `origin/main`, locks the lane
`active:sourdaw-author`, then stays offline without minting or spawning `gh`. Slugs cannot be purely
numeric: bare numbers mean issues. Supply the ticket number for `agent/<issue>/<slug>`; otherwise
use `agent/<slug>`. PRs close their issue by default; campaign slices use `lane:publish --relates`
to keep the umbrella open. Touch only your lane.

Lanes isolate only working trees. Stash, process table, disk, and author lock are shared;
global or destructive operations from any lane affect all lanes.

Run `pnpm lane:remove <path>` outside the lane; its author lock remains until removal succeeds.
Removal requires a clean lane holding exactly one PR's head whose work reached `main`, either
merged directly or through `pr:supersede`'s receipt naming a merged replacement. Other closed PRs
are abandonments: use `lane:strand` to preserve their unlanded work. It refuses open PRs or
uncommitted work and records the abandoned tip in the primary checkout for recovery; it refuses
to overwrite a same-lane receipt with a different head. Delete any leftover local branch after
`lane:remove`.

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

Every issue needs priority, status, and descriptive labels. On `issue:file`, set an applicable
milestone by title, never UI number (validation against **open** milestones rejects it before filing),
and roadmap project membership when applicable; leave either empty rather than force a fit.
No sanctioned script edits existing issues; later corrections require manual `gh`. Read live metadata
with `gh label list`, `gh api repos/:owner/:repo/milestones`, and `gh project list --owner <owner>`,
never a recorded list.

## Delivery

Use trusted `pnpm` scripts for every covered GitHub write; their App identity and delivery gates
exclude hand-rolled equivalents or bypasses. The only manual `gh` write exception is correcting an
issue's own state, labels, milestone, project membership, or sub-issue links. Manual writes use the
operator account; script-covered writes must use the minted App, never a persona. No `gh pr` write
qualifies. Lane tooling owns every `git push`: other pushes break review anchors and can strand lanes.
Use `branch:prune` for remote deletion; it defaults to dry run and deletes only branches whose every
PR is merged or closed. Read-only `gh` is unrestricted; use it for live tracker state.

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

Gitignored `.env.sourdaw-author` and `.env.sourdaw-reviewer` live at the primary root (parent of
`git rev-parse --git-common-dir`). Each script loads its own role's file; never load the other role's
file or commit credentials. Authenticate roles by immutable bot actor node IDs in
`scripts/githubAppIdentity.ts`, never interchangeable. Mutable App slugs and logins are display only.
`deliver` does not mint the reviewer.

`deliver` serializes each PR with a protected-primary Git ref pointing to a strict owner blob.
Acquire with zero-ref Git compare-and-swap; release requires the acquired object ID. Hold ownership
from before authentication through merge or already-merged recovery and tracker completion. Validate
and refuse existing owners without waiting or automatic takeover, regardless of liveness. Crashes
leave the ref; only `deliver --recover-lock` clears it. Recovery refuses a live recorded process
fence, adopts the lock under its own fence before reading anything, then requires two matching remote
reads. It never merges, retargets, posts, or closes, and refuses PRs merged by anyone but the author
App. Clearing records a dead-owner-keyed receipt; repeat recovery replays it without GitHub access.

Already-merged recovery requires GitHub's immutable merged-by actor to be the author App.
Same-head delivery receipts preserve the issue-comment REST endpoint's ascending comment-ID order
for adjacency and newest authority; timestamps only prove App-owned comments remained unedited.

Run `lane:publish`, `deliver`, and `issue:reconcile` through the protected primary checkout's
package route. This is the snapshot-backed write trust boundary: launcher and whole script closure
must match one pinned `origin/main` commit and come only from the primary repository. Lane files
are data, never executable delivery code. Lanes predating the launcher or trailing `main` can
publish and deliver without first merging.

This isolates lane-controlled files, not operator-running code. The pre-launcher operator
environment is trusted; same-account processes can read credentials. Snapshot and token-bearing
children discard redirecting overrides (Node loaders/preloads; Git, GitHub CLI, GitHub Actions, and
App configuration) and use launcher-resolved `git` and `gh`.

Workflow separation is a security boundary. Owner-required `Gate` must pass on the PR head.
GitHub accepts `skipped` required checks and prefers the newest same-name run; an event that skips
`Gate` can therefore pass a red head. A `pull_request_review` trigger caused this in production.
Preserve these boundaries:

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

`unit` decides `Gate` for web-scope runs. E2E never runs on pull requests; including it in `Gate`
would claim always-skipped coverage. It decides `HeavyGate` on approving-review runs and gates the
nightly train. The required approval triggers the heavy lane, but no required check waits for its
verdict before merge. Its enforcement awaits arming `deliver`'s required-CI admission, a separate
change. The ruleset alone has CI merge authority while that admission is advisory. The old ban on
PR-editable workflows holding merge authority is superseded: review must catch heads weakening
their own gates.

Resource Safety governs local checks; never rerun repository-wide pipeline gates locally.

Read the live `main` ruleset; repository configuration, not this text, enforces it. It blocks
deletion and non-fast-forward, requires squashed PRs, one approving review approving the last push,
resolved threads, and `Gate` on the PR head. It is non-strict: unrelated `origin/main` movement
requires no merge. Take `main` only for real conflicts or mergeability; the resulting new head
requires fresh `Gate` and review.

For committed wasm artifacts, consult `scripts/wasm-artifacts.ts` for packages and build scripts;
script names cannot be derived from crate names. Any non-test edit in a package's path-dependency
closure, including comments, changes its hash: rebuild that package, rewrite the manifest, stage
artifacts, then verify after staging. Exception: root `Cargo.toml` contributes only canonical
profile tables, workspace package table, patch/replace tables, resolver line, and closure-resolved
workspace dependencies; new members, comments, and unrelated dependencies do not change the hash.
`wasm:manifest` retains hashes for packages without rebuild evidence, so rebuilding the wrong package
can leave a matching manifest over stale artifacts; use `pnpm wasm:all` when unsure. Clean rebases
can leave wasm stale; only `pnpm wasm:verify` proves freshness.

`lane:publish` pushes without `--force`, and refuses any lane with uncommitted changes: commit the
work yourself with a conventional subject first. An issue number resolves its lane by branch prefix;
`--lane` names an exact absolute lane root, which is what disambiguates write-disjoint lanes sharing
one issue.

For conforming `agent/` lanes, `lane:publish` opens a PR titled from the newest non-merge commit
above `origin/main`; it refuses lanes lacking one and never retitles existing PRs, including after
follow-up commits or merges. The body follows [`.github/pull_request_template.md`](./.github/pull_request_template.md);
the script controls format and rejects malformed bodies. New PRs require explicit `--summary` and
`--test`; later supplied flags replace their section, omitted flags preserve it. Publishing neither
enables auto-merge nor posts reviews.

Author-locked off-convention branches may publish via `--lane <absolute-path>` only with an already
open PR for that exact branch, proving it a genuine stranded lane. This path only pushes; it never
writes PR title or body and refuses if the PR is no longer open when the push lands.

Write for a teammate outside the session. Under template headings explain what changed and why,
without repeating the title, and how to test. Product changes require user/reviewer-observable steps
and expected results, not substituted author/CI checks; internal or developer work may name its
actual validation interface. Exclude session diaries, unpublished rounds, and mutation tables.

`review:prepare` prints a primary-root bundle path containing `manifest.json`, `diff.patch`,
`pr.md`, and merge-base `contracts/`. `baseSha` and `diff.patch` use the merge-base of `origin/main`
and PR head so advancing `main` is not shown as PR deletions. The caller adds head-specific
`review.json` and later `discarded.json`. Paths are keyed by head sha; re-preparing the same head
replaces only generated files, preserving caller files. Give reviewers the bundle and neutral
acceptance conditions from the request or governing contract, not author transcripts or conclusions.
`review:publish` prints the review id and posts as reviewer App only if GitHub's head still matches
the bundle.

Read every changed line and surrounding code as needed. Comment on the defective line with one
problem, discussing code rather than author. Use literal fields `defect`, `consequence`, and `done`
for what is wrong, why it matters, and the required result; retired `body` is refused with an error
naming the replacement. Each field is one non-empty line without edge whitespace; target one precise
sentence, never padding. Tooling space-joins fields and appends a period where terminal punctuation
is absent. The composed comment must fit 600 bytes, not characters; there is no minimum.

Request changes when this head must not merge, and post every blocking comment with that review. The
summary is a short pointer to those comments, not a report.

Approve when the change improves the system, even if it is not perfect. Do not approve a change that
makes it worse. Style-guide and code-craft violations block; personal style does not. An approval is
never empty: its body states what the reviewer attacked and what held.

New APPROVE publication requires `evidence: { headSha, claims: [{ observable, verification, observed }] }`
in `review.json`. Bind `headSha` to the reviewed bundle head. Supply at least one claim, with every
value a nonblank, trimmed, single-line string: `observable` is expected behavior from the request or
contract, `verification` is the exact command, check URL, or source comparison, and `observed` is the
decisive result or excerpt. `review:publish` appends this readable record to the public approval body
before journaling its payload digest. Record completeness and head binding do not prove truthful
execution; the orchestrator remains responsible for verifying the claims. REQUEST_CHANGES must not
carry approval evidence. Historical documents remain readable for exact publication recovery;
existing approvals are not invalidated, but new publication requires this record.

Approvals carry no inline comments; `review:publish` rejects APPROVE documents with comments.
Each inline comment opens a merge-blocking thread; `review:resolve` replies `Done`, asserting a
repair, so it cannot honestly clear a non-blocking note. Put observations in the approval body with
`Nit:` or `Optional:`, or file them. Inline comments belong to `CHANGES_REQUESTED` reviews and require
an addressing new head.

Push fixes before `review:resolve`, which posts only bare `Done` as author bot and resolves against
that head. No script writes free-form thread replies; wrongly posted findings have no discussion
route. Clarify code, not threads. Resolve only when the current head addresses the finding, then
obtain a new review. File out-of-scope feedback; do not grow the PR.

Before merge, the orchestrator independently reads the current diff and confirms specified
behavior, tests observing their claimed subjects, and every accepted finding repaired rather than
silenced. Green `Gate` and advisory `HeavyGate` do not prove these; the heavy lane's advisory status
raises this duty. Push-lane failures yield required red `Gate`, never softened warnings. Attribute
every unexplained failure to the change or a named, filed pre-existing defect. Let the pipeline run
checks; locally format changed files and stage rewrites.

Unrelated `origin/main` movement does not stale reviews. Re-review feature-head changes touching
the reviewed surface and conflict resolutions. GitHub structural mergeability independently gates
base compatibility: delivery retries one transient `UNKNOWN`, refusing conflicts or a second
`UNKNOWN`. CI's aggregate merge-state label cannot substitute.

Every consequential claim needs discriminating proof, such as a test failing on revert or a
measurement at the user boundary; approval alone is weak. Keep detailed logs in the session and put
the concise head-bound verification record in the approval. Never include secrets or sensitive log
data in the public review.

`pnpm deliver` squash-merges only non-draft, structurally mergeable PRs after BOTH validation points
confirm the immutable reviewer actor `APPROVED` the current head and all threads are resolved. Head, head
branch, base branch, body, canonical closing target, and stacked dependents must stay stable between
reads. Snapshot-backed CI admission is advisory: successful, failed, pending, absent, cancelled,
malformed, or unavailable evidence does not itself block delivery. GitHub still enforces the live
ruleset's required `Gate`; `deliver` refuses `BLOCKED` before any remote write, including receipts
or merge attempts. Dormant required-CI admission retains pinned workflow-derived gate and complete-rollup
rules from the launcher's pinned `origin/main` workflow copy; lanes cannot select or reshape it.
`lane:publish` targets only `main`; `deliver` refuses any other base as an unsanctioned retarget to an
unreviewed branch. Do not merge any other way.

Keep batches small, live lanes few, and merges prompt. Authors must split diffs reviewers cannot
attack whole. Drain before filling: open no lane while a finished head waits only on review or merge.
A finished change waits only on its GitHub review. Enable hooks: `git config core.hooksPath .githooks`.

## Safety

- Preserve unrelated changes. Stage only files you changed.
- Never run destructive git, force-push, amend published history, or delete branches without
  explicit authority.
- Never install packages or edit CI/build controls unless the task requires it.
- Never widen a formatter, codemod, or autofix past the files your change owns. Always pass explicit
  file targets to `pnpm format` and `pnpm cargo:fmt`; repository-wide formatting is `format:full`
  and runs only when explicitly requested.
- Reproduce behavioral defects before repair. After three failed attempts, stop and change strategy.
