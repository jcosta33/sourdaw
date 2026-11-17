# Sourdaw Agent Rules

Read any nested `AGENTS.md` before editing its subtree. It overrides this file there.

- **Before changing files** — survey ownership, open an owned [worktree](#worktrees), and read the
  applicable [repository skills](./.agents/skills/) for the paths and behavior you will touch.
- **Before running checks** — use [Resource Safety](#resource-safety) and the exact affected
  [Checks](#checks). PR CI owns broad validation.
- **Before orchestrating a change or running any review or delivery script** — load
  [delivery-orchestration]. Run trusted GitHub writes through the protected primary package route.
- **Before dispatching reviewers or approving** — apply [Review](#review), including independent
  blind stances and a global review of the exact head.

## Ownership

The top-level agent owns code, architecture, quality, tests, docs, tooling, tracker, and hygiene.
Report outcomes and exceptions. [ADR 0026](./.agents/decisions/0026-ownership-by-exception.md)

Escalate only costly-to-reverse decisions that change the product for users, including security, data
loss, legal exposure, and spend. Present researched options and one recommendation. Decide other
questions using live code, primary sources, standards, and DAW practice. Make reversible calls at
roughly 70% of desired information. Irreversible acts without product consequence require full
information and a durable record. Missing access is a blocker.

Fix or hand off every defect you encounter, including misbehavior, broken invariants, and documented
contract contradictions. Give sizeable defects their own lane and batch small unrelated defects in
a hygiene lane. The lane and PR claim the work you take on. File a tracker issue only for work you
leave behind, with enough detail for a new session to act.

## Safety

- Preserve unrelated changes and stage only files you changed. Another agent's lane, branch, and
  PR are read-only.
- Never run destructive Git commands, force-push, amend published history, or delete branches
  without explicit authority.
- Install packages or edit CI/build controls only when the task requires it.
- Pass explicit file targets to `pnpm format` and `pnpm cargo:fmt`. Keep formatter, codemod, and
  autofix scope to owned files. Run `format:full` only on explicit request.
- Reproduce behavioral defects before repair. After three failed attempts, stop and change strategy.
- Keep secrets and sensitive log data out of public reviews. Compose credential-shaped and
  armored-key fixtures at runtime from parts. The required PR diff secret scan matches literals.

## Worktrees

One change, one owned lane under `.agents/worktrees/`, one PR. Edit tracked files only in that lane.
The protected primary hosts credentials and gitignored operations, including review bundles and
their caller documents. Stash, processes, disk, and author locks are shared across worktrees.

- Survey live lanes, PRs and overlaps before opening. Open with
  `pnpm lane:open [issue] [slug] --type <type> --model <model>`. Use the actual author model and a
  conventional PR title type. The command locks the new lane as `active:sourdaw-author` without
  minting an App token or running `gh`. Claim bound issues immediately with
  `pnpm issue:claim <issue>` from the protected primary. Bound PRs close their issue by default.
  Campaign slices use `lane:publish --relates` to leave the umbrella open.
- Stack only on a clean, committed, owned parent in the same repository. Publish parents first.
  Synchronize a child through `lane:sync-parent` before main-only delivery. Preserve exact parent
  lineage and verify the combined outcome on the final head. [Stack procedure](./.agents/skills/delivery-orchestration/references/lane-publication.md#stack-synchronization)
- Stage and commit with `node scripts/gitCheckpoint.ts add -- <paths>` and
  `node scripts/gitCheckpoint.ts commit <git arguments>` in the lane. Retain private receipts on
  failure. Enable hooks with `git config core.hooksPath .githooks`. Use a conventional
  `type(scope)!: subject` subject with at most 100 characters, free of control characters and
  closing keywords. `lane:open` stamps the author App identity. `pnpm lane:identity` restamps it.
  [Checkpoint receipts](./.agents/skills/delivery-orchestration/references/lane-operations.md#checkpoint-receipts)
- Give browser verification a lane-unique `SOURDAW_E2E_PORT` derived from the slug. Warmup and
  UI scripts verify the server belongs to your checkout.
- Delivery queues guarded local cleanup. Consult `pnpm lane:cleanup --status` for pending work.
  Use native proof before removal, and strand abandoned work to preserve its tip.
  [Cleanup and preservation procedure](./.agents/skills/delivery-orchestration/references/lane-operations.md#local-cleanup-after-delivery)

## Resource Safety

All lanes share this machine. Run costly verification in the pipeline's per-job runners, not
locally at other lanes' expense.

- Run the exact affected tests and formatting locally when the changed files can fail those checks.
  PR CI owns lint, every TypeScript typecheck, module-boundary validation, barrel-mock coverage,
  repository builds, broad unit and Rust suites, and release inventory. Do not run these broad
  checks locally; inspect the pull request's CI results as their verification evidence.
- Run repository commands sequentially within your lane. Other lanes may validate concurrently only
  when the guard admits them.
- `package.json` scripts are plain, standard commands. In agent sessions, wrap compute-heavy runs
  (tests, builds, Cargo, Playwright, WASM, measurements) with
  `pnpm guard --profile <focused|broad|extended> [--max-rss-mib <estimate>] [--require-target] --
<command>`. Estimate peak RAM from the latest observed guard peak or the nearest command; without
  an estimate the guard applies the profile ceiling, raised to the measured budget it records for
  known heavy scripts, and an RSS kill prints the budget it applied — record a budget above the
  observed peak in the guard's `measuredScriptBudgets`, never in a note. The guard waits until free
  RAM covers active reservations, this command, and the system reserve. Never bypass it. A timeout,
  RSS kill, or memory-monitor failure is a stop. The guard keeps only the tail of a command's
  output; `--show-output` keeps all of it. A stop leaves a guard-failure receipt that refuses further
  guarded runs in the lane until a relevant commit lands or `pnpm guard:recover`, run inside the
  lane, re-executes the recorded command and clears the receipt on success.
- Run only checks that can fail because of the changed files. Do not run repository-wide tests, lint, coverage, E2E, builds, Cargo, WASM, boundaries, barrel
  mocks, release inventory, or measurements locally; use PR CI for those checks unless an explicit
  targeted debugging need requires a local diagnostic.
- Name exact affected test files. Shared code never justifies guessed or expanded test scope.
- Never use watch mode for verification. Start a server only when the task needs it.

## Checks

| Need                                                                                     | Command or evidence                                                          |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Focused tests                                                                            | `pnpm guard --profile focused -- pnpm test:run <changed-spec>`               |
| Focused E2E diagnostic                                                                   | `pnpm guard --profile broad -- pnpm test:e2e <spec>`                         |
| Focused format                                                                           | `pnpm format <changed-files>`                                                |
| Focused Rust tests                                                                       | `pnpm guard --profile focused -- pnpm cargo:test --package <crate> <filter>` |
| Focused Rust format                                                                      | `pnpm cargo:fmt --package <crate>`                                           |
| Broad unit/Rust suites, lint, types, builds, boundaries, barrel mocks, release inventory | Pull request CI                                                              |
| Generate one affected WASM package                                                       | `pnpm guard --profile broad -- pnpm <that package's wasm:* script>`          |
| Rewrite WASM manifest after generation                                                   | `pnpm wasm:manifest`                                                         |
| Verify generated WASM surface                                                            | `pnpm wasm:verify` after generation                                          |
| Restamp the wasm surface                                                                 | `pnpm release:restamp:wasm`                                                  |
| Restamp a tracked set                                                                    | `pnpm release:restamp:tracked-set`                                           |
| Restamp a dependency bump                                                                | `pnpm release:restamp`                                                       |

`pnpm release:restamp:tracked-set` rewrites only the content-pinned Grand Boule boundaries: the admitted DSP source and ADR 0036.

Structural code search uses the pinned read-only `ast-grep` (`pnpm exec ast-grep run`) per [`.agents/skills/ast-grep/`](./.agents/skills/ast-grep/); rewrite modes are forbidden.

Tests use at most two workers. Playwright uses one. See [testing](./docs/06-testing.md).

Never rerun a failed check to obtain green, bump a head to reroll it, or treat retry passes as
clean. Infrastructure retries discharge nothing: a retry-dependent pass is a flaky result with the
same duty as failure. Without relevant change, a vanished failure is a defect (race, ordering,
isolation, leaked state, or environment); fix it, open a lane, or file it. Green-by-retry launders
failure like weakened tests. DAW concurrency and scheduling make flakes likely real timing defects.
For a pull request blocked by a filed failure, use the
[failed-Gate recovery procedure](./.agents/skills/delivery-orchestration/SKILL.md#recovering-a-blocked-gate);
a retry never authorizes delivery. GitHub's ruleset counts the newest run of `Gate`, so a green
retry satisfies the ruleset; `deliver` itself refuses a head on which any non-draft `health-gates.yml`
attempt failed, and the remedy is a new push.

## Delegation

The orchestrator specifies and dispatches all implementation. It owns the outcome, findings,
global review, and approval and merge decisions. Each agent executes one precise task and returns
evidence to the orchestrator. Agents neither contact the user nor own those decisions.

Use the cheapest adequate tier for the task, independent of the orchestrator's model. Economy
fits bounded mechanical work with a decisive check. Standard fits ordinary behavior and
integration work. Strongest fits architecture, real-time audio, security, data loss, irreversible
work, and consequential ambiguity. Diagnose blockers before changing tiers. Repair or report
missing credentials, dependencies, access, capacity, and deterministic environment failures.
Escalate genuine reasoning failures or disputed interpretations for the affected subproblem,
then return to the cheapest adequate tier. Reviewers have the separate ceiling below.

At dispatch, explicitly select an available model and supported reasoning setting. Use deployment
profiles for mappings. Without one, give the capability basis and mark the choice provisional.
Use the harness default where it cannot set reasoning effort. Diversify among equally adequate
models at the cheapest adequate tier. Apply the reviewer diversity rule below.

Design the whole outcome before dispatch. Specify the objective, lane, branch, paths, exclusions,
dependencies, preservation guarantees, acceptance conditions, integration observable, and exact
checks for each independently safe slice. Trace each observable to its producer and each required
mechanism to all its routes. For handwritten paths under `src/modules/`, `src/components/`, or
`electron/`, specify user-observable How to test steps. Give reviewers only neutral conditions
from the request and governing contract with the fixed head, bundle, and stance. Brief authors
and repair agents on the approach, code, and sequence. Keep that reasoning away from reviewers
and PR bodies. [Dispatch briefs](./.agents/skills/delivery-orchestration/SKILL.md#briefs)

Default to one PR for a cohesive change, including callers and tests. Split independently useful
outcomes when review benefits and each slice can land safely. Stack only on a real dependency.
Size alone never decides a split. When distinct outcomes must land together, name the invariant
or dependency. Reassess scope before a repair introduces a new mechanism or outcome. Parallelize
only write-disjoint tasks within a lane and follow [Delivery](#delivery) for overlaps across lanes.

## Review

### Stances and models

Keep each reviewer blind. Give them the fixed head, bundle and one stance. Exclude other reports,
author transcripts, and orchestrator reasoning. Reviewers report to the orchestrator and never
confer. Use the most specific matching [stance reference](./.agents/skills/review-stances/README.md)
when one exists.

Enumerate the material risks introduced by the diff. Assign one stance to each independent
failure mode, named for the input or state that breaks. Correctness is every reviewer's baseline.
A different file, role, or label does not make a stance independent, and separate paths sharing
one probe library still count as one stance. Multiple draws on one stance may diversify models.

Require at least **three distinct stances** unless the change is absolutely tiny and harmless.
The exception applies only if the change cannot alter what the product does, what a test proves,
what a rule, procedure, contract or decision requires or records, which document or section a
requirement points at, a persisted or generated artifact, or a build or delivery path. Such a
change may use one stance, subject to the machine floor. If the plan falls short, dispatch the
missing independent stances before running the round.

`review:prepare` derives `risk-plan.json` from the same path classification as the size report.
Weigh every applicable risk class, including specialist rules for playback timing, persisted
project state, and trusted GitHub-write closure paths, regardless of size. Fresh plan-carrying
publication counts distinct stance names before any remote write. Its machine floor is one for
`docs-only` and `test-only`, two for `small` (handwritten product code under `src/` only), and
otherwise three or every stance the classes earn when fewer. The orchestrator judges independence
and the human minimum. [Risk classes](./.agents/skills/delivery-orchestration/references/review-records.md#risk-classes)

Use fast, low-cost mid-tier models or below for every stance, including real-time audio, security,
data loss, irreversible change, and disputed findings. Use economy or standard. Fable, Astra,
Opus and all Sol models are excluded. Record public model names. Prefer a permitted model
different from the author's and diversify equally adequate models. If a reviewer matches an
author, explain the unavailability of every eligible alternative in `modelExhaustion` and name
the matching model in the published body. The script checks tier and author diversity. Choosing
a model within the cost ceiling remains the orchestrator's duty.

### Evidence and adjudication

Every reviewer tries to break the change and reports the strongest surviving failure with concrete
input, state, or mutation and observed result, or reports none. For each existing check, determine
what should make it fail and whether it observes its claim. Name and run a mechanical probe
against the applicable spec by reverting the behavioral hunk or applying one targeted mutation.
A probe that stays green fails the round. This is a reviewer duty even though publication does
not gate on it. Read the fixed commit and bundle. Run probes only after exclusive handoff of the
clean, committed author lane. Reviewers never create a worktree or clone. When a probe cannot run,
return the exact mutation, named check, and limitation. An unrun probe records no pass.
[Reviewer isolation](./.agents/skills/review-stances/README.md#reviewer-isolation)

For UI specs, remove the required entry point and require the check to fail. A body guarded by
`if (await locator.isVisible().catch(() => false))` can pass without assertions when the locator
changes or the UI fails to mount (#4441, introduced by #1531). Enforce unconditional admission or
remove the duplicate and name the obligation in the spec that owns it.

Before reading any stance report in each round, review the whole exact head yourself against the
request, architecture, product, and scope. Check that tests observe their claims and previous
findings are repaired. Decide whether you would merge it. This global review stays out of
`draws` and has no reviewer cost ceiling. Green `Gate` establishes only the checks and scopes it ran.

Adjudicate against the live head and surrounding code. Require concrete reproduction and observed
results for blockers. For a check-validity finding, identify the mutation that should fail the
named check. Discard incorrect, out-of-scope, personal-style, and unsubstantiated findings.
File out-of-scope defects. If only the global review finds a blocker, dispatch a fresh blind
stance on the failure mode without sharing the finding. Publish it only if a draw reproduces it.
Otherwise hold approval, post nothing, and re-brief for a new head, respin, or close. An unfit head
never earns approval.

### Publication and repair

Use only `review.json` as caller input. Include a `draws` entry for every completed blind draw
and record discarded candidates privately. Publication derives the head-bound record that
`deliver` reads. Keep recorded values single-line, trimmed, bounded, and free of credential
shapes, private-key headers, JWTs, bearer tokens, and raw transcript markers. Keep private
reviewer prose out of the record. [Schema, replay, legacy admission and freeze](./.agents/skills/delivery-orchestration/references/review-records.md)

Publish all validated blockers in a reviewer-App `REQUEST_CHANGES` against the reviewed head
**before** dispatching repairs. Restate findings for the author. Authors never adjudicate their
own work. Push the fixes through `lane:publish`. The author App uses `review:repair` to record
each fix on the live head and leave the thread open. The reviewer App alone uses `review:confirm`
to resolve threads whose recorded repairs validate. Both act only on reviewer-App or owner
roots. A confirmation refusal resolves nothing. No free-form thread write can clear a wrongly
posted finding. `review:resolve` is retired. Obtain fresh review on the new head.

Request changes when the head must not merge, including style-guide or code-craft violations.
Approve a head that improves the system and is fit to merge. One blind reviewer-App APPROVE
with recorded delivery authorization binds the current head. Approvals carry no inline
comments. Put non-blocking observations in the body as `Nit:` or `Optional:`, or file them.
Write a nonempty body for a teammate describing what changed, what was attacked, what held, and
material exceptions. Keep discriminating checks in structured evidence. Omit routine CI
narration, inventories, check-status links, role announcements, hash footers, and tool-generated
provenance. Disclose material failed, skipped, or incomplete verification in approvals,
delivery summaries, and closing comments. Skip closing comments that only repeat merged state.

When the [review freeze](./.agents/skills/delivery-orchestration/references/review-records.md#review-bundles-and-publication)
refuses fresh publication, respin the change as one consolidated PR and use `pr:supersede` after
its replacement merges. Repairs and confirmations remain available. For an obsolete PR without
a truthful merged replacement, follow the
[retirement requirements](./.agents/skills/delivery-orchestration/references/closure-and-retirement.md).
For defects reaching `main`, fix or hand off under [Ownership](#ownership), trace the introducing
PR and missing, mis-tiered, or mis-prompted stance, and record the escape in every standing stance
file whose probes could have caught it. Use the behavior-and-invariant file when nothing more
specific applies, or add a file for an uncovered defect class.

## Docs

Document durable contracts: rules, invariants, and reasons. Exclude counts, inventories, and
current-state enumerations that drift with ordinary work. Fix or file defects before deleting
"gotcha" or "known drift" notes. Retain deliberately accepted, test-guarded states as contracts.

## DAW Standard

Protect DAW essentials: real-time audio, timing accuracy, latency-aware monitoring, non-destructive
editing, deterministic automation, project integrity, dependable undo, and fast musician workflows.
Research established DAWs before inventing interaction or audio semantics; follow professional
convention unless Sourdaw deliberately differs.

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

PR CI checks module boundaries after cross-module changes; inspect that check on the pull request.
Full rules:
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

## Artifacts

Drafts, one-offs, scratch clones and checkouts, dependency installs, and unpublished or secret work
stay in `<root>/.agents/artifacts/sourdaw/`, outside every checkout, and are not filed. `<root>` is
the mount point of the drive holding the primary checkout, printed by
`df -P . | awk 'NR==2{match($0, /[0-9]+% +/); print substr($0, RSTART + RLENGTH)}'` run there. It
reads the text after the capacity column because filesystem names and mount points can contain
spaces; quote the result. When the same command run on `~` prints the same mount point, `<root>` is the home
directory. When `<root>` is the primary checkout itself, ask the owner for a directory on that drive
outside the checkout. Never place this work on another drive or under `~/.agents/artifacts` when
the checkout's drive differs.
The tracker is public. The issue body is the original; delete any local copy after filing.
`.agents/specs/` is leftover corpus: do not add files there. Assigned leftover files stay until
their work is done. Planning handed to future agents lives in GitHub issues, never a plan file.
Durable decisions belong in `.agents/decisions/` and its ADR ledger.

`.github/ISSUE_TEMPLATE/*.yml` is the schema. File issues with:

```
pnpm issue:file <template> --title "…" --fields <json> [--milestone <m>] [--project <p>] [--create]
```

After create, attach parent/child issues as GitHub sub-issues.

Use live labels, open milestone titles, and applicable roadmap projects. See
[issue filing and reconciliation](./.agents/skills/delivery-orchestration/references/lane-publication.md#issue-filing-and-reconciliation)
for routes, metadata, and when to use an operator correction.

## Delivery

[delivery-orchestration]: ./.agents/skills/delivery-orchestration/SKILL.md

Use trusted `pnpm` scripts for covered GitHub writes. Lane tooling owns every push. Run trusted
GitHub-write scripts and `review:prepare` from the protected primary checkout. Scripts read lane
files as data. A refusal requires fixing its named cause and using the same route. Read-only
`gh` is unrestricted for live evidence.

- Manual `gh` writes are limited to operator corrections of an issue's state, labels, milestone,
  project membership or sub-issue links and backfilling a PR's labels, milestone or project
  membership when it predates the publisher's metadata assertion.
- Only the designated script role loads its gitignored `.env.sourdaw-author` or
  `.env.sourdaw-reviewer` from the primary root, the parent of `git rev-parse --git-common-dir`.
  Authenticate App roles by immutable actor node IDs in `scripts/githubAppIdentity.ts`.
  Mutable slugs and logins are display only. Never load the other role's credentials or commit
  credentials. `deliver` never mints the reviewer.
- The verified `jcosta33` credential serves the trusted ruleset change, `issue:claim` tracker
  claim, `lane:publish` project membership reads and edits, and legacy `review:accept` and its
  recovery. The ruleset command selects it on `github.com` and verifies actor type `User` and
  immutable node ID `MDQ6VXNlcjg5NzgyNzA=` in an isolated API session. Never add credentials or
  grant this role to workers. Merge, receipts, and tracker completion retain the author App's identity.
  [Launcher trust boundary](./.agents/skills/delivery-orchestration/references/trust-boundary.md)

Preserve workflow separation. Only `health-gates.yml` mints `Gate`, on the pull-request events
it already handles. Keep `always()` on the gate job and assertion, require successful selected
checks and the exact selected CodeQL result, and fail drafts, cancellation, and unexpectedly
skipped checks. A skipped required check can pass GitHub's ruleset. Keep heavy checks reusable,
nightly unconditional and the sole production web deploy. Review workflow changes for ways a head
can weaken its own gate. [Workflow separation](./.agents/skills/delivery-orchestration/references/delivery-checks.md#workflow-separation)

Inspect the live non-strict `main` ruleset. Honor squash-only PRs, current-head approval,
resolved threads, and GitHub Actions' exact-head `Gate`. Only `pnpm ruleset:harden` may change the
four approved controls. Keep the shadow status and other CI contexts non-required. Attribute
unexplained failures to the change or a named pre-existing defect. A filed cause or retry alone
never clears red. Require the whole `Health gates` workflow on the exact head and fresh review
after a head change. Unrelated `origin/main` movement alone does not require a merge or stale the
review. Take main for a real conflict or mergeability requirement, or to acquire the actual fix
for a blocked Gate under its recovery procedure.
[Ruleset controls](./.agents/skills/delivery-orchestration/references/delivery-checks.md#ruleset-and-shadow-status)

Settle generated artifacts in the lane before publishing, including WASM, evidence digests, and
release inventory rewrites when triggered. [Affected generators](./.agents/skills/delivery-orchestration/references/delivery-checks.md#generated-artifacts-before-publication)

`pnpm deliver` is the only merge route. It serves non-draft structurally mergeable PRs targeting
`main`. It verifies the immutable reviewer Bot's APPROVE of the exact live head and that review's
recorded authorization, with every thread resolved, and squash-merges as the immutable author App.
[Validation, admission and retry semantics](./.agents/skills/delivery-orchestration/references/delivery-checks.md#validation-order)

Keep at most five live lanes. Keep batches small and merge each once CI and review permit.
Sequence changes to the same handwritten file or a contract another lane relies on. Waits on CI
or review leave room for independent work. If reviewers cannot attack the whole diff, reassess
scope under [Delegation](#delegation).

Compare live diffs and trace each changed generator input to the fields and digests it feeds,
including outputs still awaiting regeneration. Separate lanes may share a generated file when
their changes affect distinct, deterministically regeneratable fields from independent inputs.
Use the scoped generators in your own lane and check mergeability before delivery. Sequence
changes that affect the same input or output field, or that edit a hand-curated record or measured
baseline in the shared file.

Resolve generated conflicts in your own lane. Regenerate the affected fields from the merged inputs
and preserve hand-curated evidence and measured baselines. Publish the resolved head for fresh
`Gate` and review.
