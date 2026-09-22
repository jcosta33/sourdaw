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
lane. Your fix's lane and PR claim it; do not file an issue.

The tracker exists to hand work to other agents in the future. File only what you leave behind:
defects, follow-ups, and designs you are not taking into a lane now, each with enough detail for a
cold session or another agent to act. Never file an issue for work your own session is about to do,
and never offer to file or ask whether to file: file it or do it.

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
author's, recording the fallback in the review document: the published body names the reviewer
model, and a draw on an authoring model records its own exhaustion; a document-level whole-round
`modelExhaustion` covers every draw; per-draw exhaustion excuses the document-level field in a
mixed round.

Design the whole requested outcome before dispatch, then give each agent one independently safe
behavior or behavior-preserving preparation with its required tests. Every dispatch includes the
objective, lane, branch, paths, exclusions, dependencies, applicable preservation guarantees,
acceptance conditions, integration observable, and exact checks. Before writing it, trace each
acceptance observable (event, counter, or caller-read figure) to its producing line, and each
prescribed mechanism to every required code route. Unemitted observables and partially covered routes
are orchestrator defects. Derive the concise PR what/why from the bounded outcome; do not copy path,
check, or dispatch inventories into it, and do not require another plan file or issue for work the
session owns. Require back only status, changed paths, decisive evidence, and blockers.

Default to one PR for a cohesive change; keep its implementation, required caller changes, and tests
together. Split distinct outcomes when separate review materially helps, provided each slice can land
safely and final integration stays coherent. Stack only separately useful slices with a real dependency.
A size report alone never requires a split, and no numeric threshold decides one. When distinct
outcomes must land together, name the invariant or dependency that requires joint landing; a feature
name or changed-line target is insufficient. If a review repair introduces a new mechanism or outcome,
reassess the PR scope before dispatching more author work.

Run agents in parallel only on write-disjoint work. Sequence shared contracts, generated artifacts,
and overlapping files.

## Review

Keep reviewers blind: give each the head, diff, and exactly one stance, never other reviewers'
prose, the author's transcript, or orchestrator reasoning. Prior findings anchor reviewers.
Reviewers never confer; findings meet only in the orchestrator.

Derive the stances from the task, never from a menu or habit: enumerate the material risks this
diff creates, then assign one independent stance to each, named for the specific risk it attacks.
A stance any diff would admit — "correctness" above all — is the baseline every reviewer already
holds, not a stance. Independence is distinct failure modes, never distinct files: stances pinned
to different touched paths that share one probe library are one stance. Three is a minimum, not a
target: fewer than three named risks means the enumeration was too narrow. Record the dispatched
set in the bundle's `stances.json` before dispatch, one line per stance naming the failure mode
that admits it — the input or state that breaks — never the path the diff touches; as each draw
reports, its baseline probe and its exhaustion when it fell back are recorded beside its stance.
The caller writes it, no script generates it, and the orchestrator confirms its presence and
substance before acceptance. `pnpm stances:check <bundle>` tests each admission line with a typed
judgment and fails lines that name touched paths instead of failure modes. Run it before dispatch
when the TypeSafe credential and service are available, and repair the lines it fails when it runs;
its inability to run — a missing key, an unavailable or degraded service, or a malformed response —
is a disclosed limitation, never a stop, and the orchestrator's substance duty stands either way.

Tier reviewers by the criticality of the risk each stance attacks: economy for narrow low-risk
checks, standard for behavioral and integration risk, strongest for real-time audio, security,
data loss, irreversible change, or disputed severe findings. Also raise the tier for wide module
diffusion, heavy churn on defect-prone surfaces, or surfaces touched by many recent lanes.
The orchestrator may combine two independent strongest-tier draws from different models on one
stance to expose different findings; this extends model diversity, not the stance count, and each
draw records its own completed entry and baseline probe.

Every reviewer carries the baseline posture regardless of stance: establish what must break for
each existing check to fail and whether it observes what its name claims. A pass alone is not
evidence. The reviewer names a mechanical probe: revert the behavioral hunk or apply one targeted
mutation, then run the named spec; remaining green fails the round. Each draw reports its
baseline probe — the spec it ran, the mutation it applied, the observed result — and its
exhaustion when it fell back to an authoring model, and the orchestrator records these in
`stances.json` beside the stances. The orchestrator validates or the
author repairs in the change's existing lane; reviewers have no writable tree.

Conditional admission is a standing escape in UI specs (#4441, introduced by #1531): a case whose
whole body sits inside `if (await locator.isVisible().catch(() => false))` reaches its end without
any assertion when the entry point is absent, renaming its locator, or failing to mount. The
baseline probe for a UI case must show it fails when its required entry point is unavailable —
unconditional admission, or removal of the duplicate with the obligation named in the spec that
owns the behavior.

Dispatch a posture as well as a surface: try to break the change; report the strongest surviving
finding with concrete failure inputs or state, or report none. Finding nothing is success; never
manufacture findings. Tell reviewers that hedged findings without a concrete break are discarded.

Scale evidence to the claim. Check findings against the live head and surrounding code, not the
diff alone. Merge-blocking findings require the reproduction's input, state, or mutation and observed
result. Baseline-probe findings name the mutation that should have failed the check but did not.

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

`review:prepare` records the change's risk classes — `small`, `ordinary`, `test-only`,
`cross-domain`, `realtime-audio`, `native-security`, `undo` — in the head bundle's `risk-plan.json`,
derived from the same path classification as the size report beside it so the two cannot disagree.
The classification encodes semantic risk beyond size: playback-timing, project-persistence, and
every trusted GitHub-write closure path earn their specialist class however small the diff
(#3377). The plan is an input to the stance enumeration, never a stance requirement: its classes
and their standing stance mapping name risk surfaces the enumeration must weigh, and the derived
stances remain the orchestrator's judgement recorded in `stances.json`.

`pnpm review:semantic scan --pr <pr>` may be run before dispatch to surface risks the enumeration
should weigh, and `pnpm review:semantic verify --bundle <bundle> --findings <path>` after independent
findings are collected and before `review.json` is written. Both are advisory and optional: their
output is input to the orchestrator's own judgement, an unavailable provider or missing credential is
a disclosed limitation rather than a stop, and neither may count as a completed reviewer draw, waive a
deterministic check, or publish anything. Their sidecars live outside the review bundle, in gitignored
`.agents/semantic-review/`, so a blind reviewer is never handed a proposed verdict. They never
substitute for the reproduction and baseline-probe duties below, and no semantic result may approve,
request changes, resolve a thread, or merge
([ADR 0047](./.agents/decisions/0047-advisory-semantic-review-also-runs-in-ci.md)).

The same assessment also runs by itself as the non-required `Semantic review` check on every non-draft
same-repository pull request that targets `main`, so an orchestrator reviewing a lane it did not author
still gets it. Read it the same way: green means the assessment was delivered, never that the change is
clean, and a red check means no assessment was delivered at all — a coverage gap to disclose in the
review document, not a finding to weigh and not a blocker. A stacked lane whose base is another lane
branch is not assessed: it would run that branch's revision of the command rather than the default
branch's, which the command's own trusted-execution assertion refuses.

Write the caller-authored `dossier.json` beside `review.json` and `discarded.json`: one completed
entry per dispatched draw, each recording its stance, reviewer model, tier, and outcome; one stance
may carry several draws with distinct models, and a draw that fell back to an authoring model
records its exhaustion. Alongside the draw entries go the bounded evidence claims and the
limitations. Accepted findings are not declared there; they are the review document's own inline
comments. `review:publish` refuses a fresh reviewer publication before any remote write when the
dossier is missing, malformed, or rebound from the head the plan binds; when the bundle carries
`stances.json`, every dossier entry must match a recorded stance and every recorded stance an
entry (draws on one stance share its single recorded entry);
when its accepted findings do not match the document's comments one-to-one; or when its
recommendation disagrees with the document's event. It then persists the canonical append-only record bound to the head; re-publishing
the same head replays that record unchanged rather than minting a second one.

Evidence values — dossier evidence, limitations, and approval claims — are single-line, trimmed and
bounded, and are refused when they carry a credential-shaped value, a private-key header, a JWT, a
bearer token, or raw session-transcript markers. Private reviewer prose belongs nowhere in the record.

A lane that adds credential-shaped or armored-key fixtures composes them at runtime from their parts;
the pull-request diff secret scan is a required gate and matches those literals in source.

A bundle with no `risk-plan.json` predates this contract and publishes exactly as before. Historical
review and acceptance documents stay readable unchanged, and `review:accept` takes no dossier.

Post validated blockers BEFORE repair: publish a `REQUEST_CHANGES` review against the reviewed
head, then dispatch repairs. The author pushes the fixed head and records each repair through
`review:repair`, leaving the thread open; the reviewer App, a distinct identity, resolves only the
threads whose recorded repair validates through `review:confirm`, and a refusal resolves nothing.
`review:resolve` keeps its exact `Done` path for legacy roots. Never repair first and approve in
one motion: the public record must retain the reviewer identity's findings against the original
head and the author identity's fixing pushes and `Done` replies. Orchestrator judgement lives in its
exclusive script calls, `review.json`, `discarded.json`, and the final `acceptance.json`. The
reviewer App records independent review; the orchestrator records final acceptance through
`review:accept`, then merges through `deliver` as the verified orchestrator User.

For defects reaching `main`, fix under Ownership AND trace the introducing PR and missed stance
(missing, mis-tiered, or mis-prompted). Attach the escape to every standing file under
`.agents/skills/review-stances/` whose probes participate in what would have caught it — the
behavior-and-invariant file is the fallback home when no specific file matches — or mint a new
file for a defect class none covers, so cold orchestrators inherit the escape lesson. Escapes
measure review
quality; fixing without learning does not prove it.

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
| Restamp the wasm surface  | `pnpm release:restamp:wasm`                  |
| Restamp a tracked set     | `pnpm release:restamp:tracked-set`           |
| Restamp a dependency bump | `pnpm release:restamp`                       |

Structural code search uses the pinned read-only `ast-grep` (`pnpm exec ast-grep run`) per [`.agents/skills/ast-grep/`](./.agents/skills/ast-grep/); rewrite modes are forbidden.

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
are exceptions: `review:prepare` writes `.agents/review-bundles/` there, the caller adds review and acceptance documents,
and `.env.sourdaw-*` credentials live there.

`pnpm lane:open [issue] [slug]` fetches and branches from `origin/main`, locks the lane
`active:sourdaw-author`, then stays offline without minting or spawning `gh`. To create a dependent
lane, pass `--stack-on <absolute-parent-lane>`; the clean, committed, owned parent must belong to the
same primary repository, and the command records the exact parent lineage under
`.agents/lane-stacks/`. The selector asserts caller ownership within the existing same-account trust
boundary; role locks alone do not prove it. Slugs cannot be purely numeric: bare numbers mean issues.
Supply the ticket number for `agent/<issue>/<slug>`; otherwise use `agent/<slug>`. PRs close their
issue by default; campaign slices use `lane:publish --relates` to keep the umbrella open. Touch only
your lane. Claim the work when you open the lane: `pnpm issue:claim <issue>` swaps the issue onto
`status:active` and moves its board items to In progress; `lane:open` prints the command. The
issue-bound and issueless procedures are in [delivery-orchestration]. Lane worktrees carry the
author App's git commit identity (stamped at `lane:open`, restamped by `pnpm lane:identity`), and
`lane:publish` refuses lane-owned commits authored otherwise — commits the resolved bases (origin/main and any stack parent head) already reach are not the lane's to author.

A lane records its authoring model when opened: `--model <model>`, the lowercase public name of
the model itself, keeping every qualifier that distinguishes capability or edition within the
family (flash, mini, pro, air, codex, thinking) and dropping only deployment-routing prefixes and
date-snapshot suffixes. `lane:publish` labels the PR with the model's bare name and carries the
milestone and project membership of the bound issue;
`--milestone`/`--project` override those values by open title on any lane — left empty rather than
forced. Project membership is read and applied through the verified operator credential, because
installation tokens cannot reach user-owned Projects v2; without that credential the publish says
so and leaves membership to the operator backfill, while everything else stays under the author
App. An issueless lane derives its project from its derived type label, and applies it only when a
project of that name exists. The PR also carries the repository's descriptive
labels: the bound issue's labels minus the `priority:` and `status:` namespaces, or on an issueless
lane one type label derived from the conventional subject (`feat` → `enhancement`,
`fix` → `bug`, `docs` → `documentation`); `--label <name>` adds more by live canonical name, and
descriptive labels are never created on demand — only authorship labels are, identified by their
`Authored by ` description.

Publish a stack parent first. `lane:publish` validates the child descriptor as untrusted data and
targets the exact open parent head, or `main` after the recorded parent PR has merged. Landed-child
publication and approval require both the verified final parent head and its landed commit in the
child history. A moved, missing, ambiguous, closed-unmerged, or racing parent blocks publication.
`pnpm lane:sync-parent --lane <absolute-child-lane>` merges the verified current parent head into
only that clean owned child. After the parent squash lands, it merges the verified final parent head
first, then the exact parent squash commit, then fetched current `main`, preserving all parent and
child history while retaining later main edits and reversions. Resolve a conflict at any merge in
the child, commit normally, and rerun synchronization. Never rebase,
reset, force-push, cascade to siblings, or silently adopt a replacement parent. Deliver remains
bottom-up and main-only; sync the child, then publish and obtain fresh Gate, review, and acceptance.
Keep earlier slices related with `--relates` until closure is warranted, and verify the original
end-to-end outcome on the final combined head.

Lanes isolate only working trees. Stash, process table, disk, and author lock are shared;
global or destructive operations from any lane affect all lanes. Lanes running browser verification
export `SOURDAW_E2E_PORT` with a lane-unique value (derive it from the lane slug), and the
warmup and ui-scripts identity assertions refuse a dev server belonging to another checkout.

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
their work is done. Planning handed to future agents lives in GitHub issues, never a plan file.
Durable decisions belong in `.agents/decisions/` and its ADR ledger.

`.github/ISSUE_TEMPLATE/*.yml` is the schema. File issues with:

```
pnpm issue:file <template> --title "…" --fields <json> [--milestone <m>] [--project <p>] [--create]
```

After create, attach parent/child issues as GitHub sub-issues.

Every issue needs priority, status, and descriptive labels. On `issue:file`, set an applicable
milestone by title, never UI number (validation against **open** milestones rejects it before filing),
and roadmap project membership when applicable; leave either empty rather than force a fit.
No sanctioned script edits existing issues beyond the claim and reconciliation — `pnpm issue:claim
<issue>` swaps the status labels and moves the boards, and `pnpm issue:reconcile` applies
digest-guarded body edits and closures at delivery; later corrections require manual `gh`, as does
backfilling a pull request's own labels, milestone, or project membership when it predates
`lane:publish`'s metadata assertion. Read live metadata
with `gh label list`, `gh api repos/:owner/:repo/milestones`, and `gh project list --owner <owner>`,
never a recorded list.

## Delivery

Use trusted `pnpm` scripts for every covered GitHub write; their role identities and delivery
gates exclude hand-rolled equivalents or bypasses. The only manual `gh` write exceptions:
correcting an issue's own state, labels, milestone, project membership, or sub-issue links; and
backfilling a pull request's own labels, milestone, or project membership predating
`lane:publish`'s metadata assertion — these use the operator account. Scripts use their
designated App identities except final orchestrator acceptance and merge, `issue:claim`'s tracker
claim, and `lane:publish`'s project-membership read and `--add-project` edit, which use the
verified `jcosta33` user identity; no other manual `gh pr` write qualifies. Lane tooling owns
every `git push`: other pushes break review anchors and can strand lanes. Read-only `gh` is
unrestricted; use it for live tracker state.

The delivery procedure — command table, script order, flags, validation and refusal semantics,
locks, receipts, document formats, launcher boundary — lives in [delivery-orchestration]; ALWAYS
load it before running any review or delivery script.

[delivery-orchestration]: ./.agents/skills/delivery-orchestration/

Gitignored `.env.sourdaw-author` and `.env.sourdaw-reviewer` live at the primary root (parent of
`git rev-parse --git-common-dir`). Each script loads only its own role's file; never load the
other's or commit credentials. Authenticate roles by immutable bot actor node IDs in
`scripts/githubAppIdentity.ts`, never interchangeable; mutable App slugs and logins are display
only. `deliver` does not mint the reviewer.

Final acceptance and merge use the stored `gh` credential for `jcosta33` on `github.com`; the
login selects it, and an isolated API session must verify actor type `User` and immutable node ID
`MDQ6VXNlcjg5NzgyNzA=` before granting authority. Never add credentials or grant this role to
workers; receipt and tracker writes retain their author App identities. Lock, recovery, and
receipt procedure: [delivery-orchestration].

Run `lane:publish`, `review:accept`, `deliver`, `issue:claim`, and `issue:reconcile` through the
protected primary checkout's package route; lane files are data, never executable delivery code.
Launcher snapshot mechanics: [delivery-orchestration].

Workflow separation is a security boundary. Owner-required `Gate` must pass on the PR head;
GitHub accepts `skipped` required checks and prefers the newest same-name run, so an event that
skips `Gate` can pass a red head (a `pull_request_review` trigger did, in production). Preserve:

- `.github/workflows/health-gates.yml` answers to `pull_request` alone and mints `Gate`. Its `gate`
  job carries `!cancelled()` and no other predicate: any predicate that can be
  false is the hole. Do not add a trigger to this file, and do not rename `gate`.
- `.github/workflows/semantic-review.yml` is advisory and holds the provider key, so it answers to
  `pull_request_target` alone (plus dispatch) and runs the base revision's definition: it reads the
  reviewed head as Git objects and never checks out or executes it, and it mints the non-required
  `Semantic review` check. Its whole trust boundary is pinned by
  `scripts/semanticReviewWorkflowContract.ts`
  ([ADR 0047](./.agents/decisions/0047-advisory-semantic-review-also-runs-in-ci.md)).
- `.github/workflows/validation.yml` is the shared lane — types, lint, boundaries, unit matrix,
  build, Rust, natives, smoke set, secret scan, dependency review — shared by both gate workflows
  so one definition does not drift.
- `.github/workflows/heavy-gates.yml` owns the review event and the jobs that cannot fit a push
  budget — the E2E matrix, the Browser AI hardware proof, CodeQL, the full-history secret scan;
  its summary `HeavyGate` is deliberately not ruleset-required.
- `.github/workflows/nightly.yml` owns the schedule and dispatch events: the full train and the
  nightly failure report. It is the only production web deploy — `vercel.json` disables the Git
  integration, so reaching `main` deploys nothing by itself.

No job outside `health-gates.yml` may be named `Gate`.

`unit` decides `Gate` for web-scope runs. E2E never runs on pull requests; including it in `Gate`
would claim always-skipped coverage. It decides `HeavyGate` on approving-review runs and gates the
nightly train. The required approval triggers the heavy lane, but no required check waits for its
verdict; enforcement awaits arming `deliver`'s required-CI admission, leaving the ruleset alone
with CI merge authority while that is advisory. The old ban on PR-editable workflows holding
merge authority is superseded: review must catch heads weakening their own gates.

Resource Safety governs local checks; never rerun repository-wide pipeline gates locally.

Read the live `main` ruleset; repository configuration, not this text, enforces it. It blocks
deletion and non-fast-forward, requires squashed PRs, two approving reviews and approval of the
last push, resolved threads, and `Gate` on the PR head. It is non-strict: unrelated `origin/main`
movement requires no merge; take `main` only for real conflicts or mergeability, and the new head
then requires fresh `Gate` and review.

Dismissing stale reviews on push and requiring approval of the last push are ruleset configuration,
and only the trusted ruleset command may change them: it plans against the live ruleset, refuses a
change outside the approved pair or that adds a required context, captures the live ruleset's
canonical bytes as the rollback before writing, applies as the verified orchestrator User, and
reads back, failing unless both controls are shown. It has no throwaway-ruleset mode; the canary
evidence #3002 requires for such a change is a live pull request - a red `Gate` blocking a merge,
fresh approvals required after each push, unresolved threads blocking, and reviewer App
confirmations resolving threads. Read the live ruleset rather than assume either control is on. The reviewer's shadow status
is deliberately non-required: it attests only immutable commit facts about the exact head, never a
verdict that another commit or a later push can inherit. No wave may make a CI context or a shadow
status context required, because a required context converts an observation into merge authority —
for the shadow status, that would erase the reason it exists.

For committed wasm artifacts, consult `scripts/wasm-artifacts.ts` for package and build-script
names; they cannot be derived from crate names. Any non-test edit in a package's
path-dependency closure, including comments, changes its hash: rebuild the package, rewrite the
manifest, stage artifacts, then verify after staging. Exception: root `Cargo.toml` contributes
only canonical profile tables, the workspace package table, patch/replace tables, the resolver
line, and closure-resolved workspace dependencies; new members, comments, and unrelated
dependencies do not. `wasm:manifest` retains hashes for packages without rebuild evidence, so
rebuilding the wrong package can match a manifest over stale artifacts; use `pnpm wasm:all` when
unsure. Clean rebases can leave wasm stale; only `pnpm wasm:verify` proves freshness.

`lane:publish` pushes without `--force` and refuses uncommitted changes: commit the work yourself
with a conventional subject first. Titling, bodies, flags, stacks, and stranded lanes:
[delivery-orchestration].

Request changes when this head must not merge, posting every blocking comment with that review.
Approve when the change improves the system, even if imperfect — never when it makes it worse;
style-guide and code-craft violations block, personal style does not. An approval is never empty:
its body states what the reviewer attacked and what held.

Give reviewers the bundle and neutral acceptance conditions from the request or governing
contract, never author transcripts or conclusions; preserve blind dispatch and independently
inspect the final head before accepting it. Bundle, publication, acceptance, and thread
procedure: [delivery-orchestration].

Never fill approvals, acceptance, delivery summaries, or closing comments with routine
successful-CI narration, passed-check inventories, or links repeating required-check status;
always disclose material failed, skipped, or incomplete verification, keep discriminating checks
in structured evidence, and report the outcome and material exceptions; do not add a closing
comment that only repeats the merged state.

Write every approval, acceptance, and review body as a human reviewer would: what the change
does, what was attacked, what held, and any remaining concerns. Never announce your role,
identity, or authority chain — the posting identity already carries it. Never cite check
counts, hash footers, or tool-generated provenance artifacts in the body. The reader is a
teammate reviewing the work, not an auditor verifying the pipeline ran. If the sentence could
appear unchanged in a CI log, it does not belong in a review.

Approvals carry no inline comments; `review:publish` rejects APPROVE documents with comments.
Each inline comment opens a merge-blocking thread; `review:resolve` replies `Done`, asserting a
repair, so it cannot honestly clear a non-blocking note. Put observations in the approval body
with `Nit:` or `Optional:`, or file them — they belong to `CHANGES_REQUESTED` reviews and
require an addressing new head.

Push fixes before `review:resolve`; resolve a thread only once the current head addresses the
finding, then obtain a fresh review. No script writes free-form thread replies, so wrongly posted
findings have no discussion route. Clarify code, not threads. File out-of-scope feedback; do not
grow the PR.

Before merge, the orchestrator independently reads the current diff and confirms specified
behavior, tests observing their claimed subjects, and every accepted finding repaired rather than
silenced — green `Gate` and advisory `HeavyGate` do not prove these, and the advisory status
raises this duty. Push-lane failures yield required red `Gate`, never softened warnings. Attribute
every unexplained failure to the change or a named, filed pre-existing defect. Let the pipeline
run checks; locally format changed files and stage rewrites.

Unrelated `origin/main` movement does not stale reviews; re-review feature-head changes touching
the reviewed surface and conflict resolutions. CI's aggregate merge-state label cannot substitute.

Every consequential claim needs discriminating proof — a test failing on revert, a measurement at
the user boundary; approval alone is weak. Never include secrets or sensitive log data in the
public review.

`pnpm deliver` squash-merges only non-draft, structurally mergeable PRs after both the immutable
reviewer Bot's and orchestrator User's approval of the current head, final user acceptance after
reviewer approval, and all threads resolved; it is main-only — merge no other way. Validation
order, admission, and retry semantics: [delivery-orchestration].

Keep batches small, live lanes few, and merges prompt. If reviewers cannot attack a diff whole,
reassess its scope under Delegation before review. Drain before filling: open no lane while a
finished head waits only on review or merge.
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
