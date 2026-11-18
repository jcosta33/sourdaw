# Delivery checks

## Watching Health gates

- Wait for the entire `Health gates` workflow on the exact head to conclude `SUCCESS`; a green
  `Plan required checks` job alone is not the workflow result. A draft fails `Gate` without running
  the heavy jobs.
- Use one observer per PR; back off on read failures or use a connected reader that returns complete
  checks. Job pages can omit results: establish completion from the whole exact-head workflow or a
  complete check rollup, never a green subset, and do not rerun CI because a status read failed.
- A head that conflicts with its base gets no GitHub merge ref, so no `pull_request` workflow run is
  created and no check can ever appear: waiting on it waits forever. When `lane:publish` reports a
  conflicted head, read `gh pr view <pr> --json mergeable` and resolve the reported paths with a push
  before waiting; an `UNKNOWN` answer is GitHub still computing, so check it again rather than
  treating it as a conflict.

## Workflow separation

Workflow separation is a security boundary. Owner-required `Gate` must pass on the PR head;
GitHub accepts `skipped` required checks and prefers the newest same-name run, so an event that
skips `Gate` can pass a red head (a `pull_request_review` trigger did, in production). Preserve:

- `.github/workflows/health-gates.yml` answers to `pull_request` `opened`, `synchronize`, `reopened`,
  `ready_for_review`, and `converted_to_draft`, and mints `Gate`. Its `gate` job and its assertion
  step carry `always()` so cancellation cannot skip the verdict. A draft still fails `Gate`: a
  skipped required check passes. Heavy checks run only when the pull request is not a draft.
  The assertion requires successful scope, shared E2E build, validation and affected checks, plus
  the exact selected CodeQL result; cancelled or unexpectedly skipped checks fail. Do not add a
  trigger to this file, and do not rename `gate`. A later event in the same concurrency group
  cancels the in-progress run, and that cancelled `Gate` fails; a new push is that event.
- `.github/workflows/validation.yml` runs types, lint, boundaries, unit matrix, build, Rust,
  native checks, scoped smoke, release inventory, PR diff secret scanning and dependency review
  for every non-draft pull request. Nightly and `release:proof:assemble` also run release inventory;
  the release owner still assembles proof before `release:cut` as described in `docs/release.md`.
- `.github/workflows/heavy-gates.yml` is reusable only, called by the required PR workflow.
  Its explicit affected E2E matrix and selected Browser AI hardware proof decide `Gate`, and run
  only for a non-draft pull request. CodeQL has a separately permissioned required
  job in `health-gates.yml`; full-history secret scanning remains in the nightly.
- `.github/workflows/nightly.yml` owns the schedule and dispatch events: the full train and the
  nightly failure report. It is the only production web deploy — `vercel.json` disables the Git
  integration, so reaching `main` deploys nothing by itself.

No job outside `health-gates.yml` may be named `Gate`.

`scripts/prValidationScope.ts` records the affected browser plan with reasons. A clean integration
checkout may narrow feature-presentation changes through the resolved file dependency graph and
explicit suite owners in `scripts/e2eSuiteOwners.json`; unowned suites remain selected. Otherwise, product edits that lie only inside function bodies run just the specs the fresh nightly coverage map saw execute those files, failing closed to the full suite. Unknown,
shared, deleted, renamed, and unsupported graph inputs select the complete browser suite. Direct
browser spec changes select those specs, and a changed test-side module selects the specs that import it. Documentation and explicitly known review tooling avoid
browser runs. Other `scripts/**`, `.agents/**`, `release/*.json`, non-product Markdown, Rust sources and Cargo
manifests, `evidence/**`, root lint, format and boundary configs, and `nightly.yml` select no
browser suite but keep broad non-browser validation: scripts and Rust reach the browser only through outputs
under `src/` or `public/`, which select it themselves, and nightly runs the full train. Smoke runs separately for every browser plan; Browser AI hardware admission follows
selected browser-AI suites. Required selected jobs must succeed, and scope resolution or missing
evidence fails closed. Nightly remains the unconditional full-load gate. The maintenance contract is
in [affected E2E](../../../../docs/affected-e2e.md).
The ruleset requires the single `Gate`; review must catch heads weakening their own workflow.

## Ruleset and shadow status

Read the live `main` ruleset; repository configuration, not this text, enforces it. It blocks
deletion and non-fast-forward, requires squashed PRs, one approving review and approval of the
last push, resolved threads, and `Gate` on the PR head. It is non-strict: unrelated `origin/main`
movement requires no merge; take `main` only for real conflicts or mergeability, and the new head
then requires fresh `Gate` and review.

Dismissing stale reviews on push, requiring approval of the last push, the one-approval count, and
the source the required `Gate` check must come from are ruleset configuration, and only the trusted
ruleset command, `pnpm ruleset:harden`, may change them. It is a dry run that prints the planned
change unless `--apply` is passed. It plans against the live ruleset, refuses a change outside the
approved set — stale-review dismissal, last-push approval, `required_approving_review_count` = 1,
and `Gate` pinned to GitHub Actions, `integration_id` 15368, so no other identity's check or status
named `Gate` satisfies it — or one that adds a required context, captures the live ruleset's
canonical bytes as the rollback before writing, applies as the verified orchestrator User, and
reads back, failing unless all four are shown. It has no
throwaway-ruleset mode; the canary evidence #3002 requires for such a change is a live pull request
— a red `Gate` blocking a merge, fresh approvals required after each push, unresolved threads
blocking, and reviewer App confirmations resolving threads. Read the live ruleset rather than
assume any control is on. The reviewer's shadow status
(`pnpm review:shadow-status <pr> --head <full-sha>`) is deliberately non-required: it attests only immutable commit facts about the exact head, never a
verdict that another commit or a later push can inherit. No wave may make a CI context or a shadow
status context required, because a required context converts an observation into merge authority —
for the shadow status, that would erase the reason it exists.

## Validation order

`pnpm deliver` squash-merges only non-draft, structurally mergeable PRs after BOTH validation points
confirm the immutable reviewer Bot `APPROVED` the current head, with its recorded delivery
authorization binding that live reviewer approval, and all threads resolved. Approval counts or
matching logins cannot substitute for that actor identity. Merge executes as the immutable author
App; receipt and tracker writes retain their author App identities.

At both validation points `deliver` also holds the live pull-request title to the subject contract
`lane:publish` enforces (`assertConventionalSubject` in `scripts/prContract.ts`): it refuses a title
that is not conventional or that carries an issue-closing reference, because the title becomes the
squash commit subject and GitHub closes every issue a closing keyword names in a commit on `main`.
A title edited after publication is caught here. On a conforming lane, replace it with
`lane:publish --title` and keep the relationship in the body; typed and legacy `agent/` branches
are both conforming. `lane:publish` refuses `--title` on an off-convention legacy lane, one whose
branch matches neither form, which stays push-only, so such a pull request cannot be retitled
through the scripts: respin it as a conforming lane and close it with `pr:supersede` once the
replacement merges.

Head, head branch, base branch, body, canonical closing target, and stacked dependents must stay
stable between reads. `deliver` remains main-only and refuses any other base; reconcile a landed
parent through `lane:sync-parent`, republish the child against main, and obtain fresh review before
delivery. Do not merge any other way.

## CI admission

Snapshot-backed CI admission is advisory: successful, failed, pending, absent, cancelled, malformed,
or unavailable rollup evidence does not itself block delivery. GitHub still enforces the live
ruleset's required `Gate`; `deliver` refuses `BLOCKED` before any remote write, including receipts or
merge attempts. Independently of admission mode, `deliver` proves which `Gate` it relies on
(`validateGateProvenance` in `scripts/deliverPullRequest.ts`): no commit status may be named
`Gate`, every `Gate` check run must be the GitHub Actions job of a `health-gates.yml`
`pull_request` run on the exact head, the newest must be the successful `Gate` job of the newest
run, and no non-draft attempt on the head may have failed. A later green rerun never retires such
a failure; push a new commit. The squash commit message is the validated PR body. Dormant required-CI admission retains pinned workflow-derived gate and complete-rollup
rules from the launcher's pinned `origin/main` workflow copy; lanes cannot select or reshape it.

## Refusals and retries

GitHub structural mergeability independently gates base compatibility: delivery retries one
transient `UNKNOWN`, refusing conflicts or a second `UNKNOWN`.

Delivery refuses a pull request when `main` touched since their merge base a file the pull request
also touched and a lint ledger (`LINT_LEDGER_FILES` in `scripts/lintLedgerCrossing.ts`) binds that
file. The ledgers include the six dependency-boundary baselines
(`.dependency-cruiser-known-violations*.json`), which bind the `from` file of each row. A side touches a file by editing it or by changing what a ledger records for it, so a
ledger-only edit counts. A ledger that does not parse as JSON, or a boundary baseline that is not an array of rows with a `from` path, refuses delivery. The non-strict
ruleset's `Gate` never measured the two edits together. The initial check
refuses with no remote write. A crossing first seen at the final read refuses after the delivery
receipt is posted and leaves the delivery lock held; recover it with
`pnpm deliver --recover-lock <pr> --owner <oid>`. Merge current `main` into the lane and publish;
the fresh `Gate` decides.

For a crashed delivery, repair, confirmation, closure, or review publication, follow the
operation-specific [lock recovery](repair-and-lock-recovery.md); recovery itself does not
perform the original operation.

## Generated artifacts before publication

### Committed WASM

For committed wasm artifacts, consult `scripts/wasm-artifacts.ts` for package and build-script
names; they cannot be derived from crate names. Any non-test edit in a package's
path-dependency closure, including comments, changes its hash: rebuild the package, rewrite the
manifest, stage artifacts, then verify after staging. Exception: root `Cargo.toml` contributes
only canonical profile tables, the workspace package table, patch/replace tables, the resolver
line, and closure-resolved workspace dependencies; new members, comments, and unrelated
dependencies do not. `wasm:manifest` retains hashes for packages without rebuild evidence, so
rebuilding the wrong package can match a manifest over stale artifacts. Identify every affected
package from `scripts/wasm-artifacts.ts`; rebuild each affected package when its generated artifacts
must change, then rewrite and verify the manifest. PR CI checks committed WASM freshness; do not run
`pnpm wasm:all` as a broad local fallback. Clean rebases can leave wasm stale; only
`pnpm wasm:verify` proves freshness after generation or staging.

### Agent evidence manifest and release tracked sets

- **Agent evidence manifest**: `evidence/agent-campaign/manifest.json` pins the SHA-256 of every
  fixture its suites read, and `scripts/__tests__/agentCampaignHarness.spec.ts` fails in the
  pull request's unit validation when a pinned file changes. `pnpm evidence:gate --manifest evidence/agent-campaign/manifest.json`
  lists stale digests; regenerate with
  `pnpm evidence:gate --manifest evidence/agent-campaign/manifest.json --write` and commit the
  rewrite.
- **Release tracked sets**: the `gitPathspecs` of `GRAND_BOULE_RELEASE_REGISTRY` in
  `scripts/checkReleaseInventory.ts` reach outside the Grand Boule module into Transport MIDI
  scheduling, AudioEngine runtime and worklet files, and the command handler maps and argument
  keys. Two boundaries pin admitted bytes (`pinsAdmittedBytes`): the DSP source under
  `crates/daw-dsp/src/grand_boule` and ADR 0036. After committing an edit to either, run
  `pnpm release:restamp:tracked-set`: it refuses uncommitted changes in those boundaries, prints
  `release inventory already current` or each moved digest, and rewrites the inventory for you to
  commit. Editing a file in any other boundary needs no inventory edit: the inventory records only
  `tracked-set:<label>` for it, which moves when a boundary is added, removed, or renamed in
  `GRAND_BOULE_RELEASE_REGISTRY`. PR CI's release inventory check still refuses a boundary with
  no tracked, readable files.
