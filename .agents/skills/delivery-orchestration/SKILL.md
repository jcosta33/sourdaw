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

Root [AGENTS.md](../../../AGENTS.md) owns the policy: trusted scripts only, identity immutability,
workflow boundaries, review blindness, post-before-repair. This skill is the procedure an
orchestrator follows from claim to cleanup, in the order it runs, with the briefs it gives the agents
it dispatches. Every step below runs on every delivery; the references hold the rare modes.

## Command reference

| Need                                                        | Command                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open a lane                                                 | `pnpm lane:open [issue] [slug] --type <type> --model <model> [--stack-on <absolute-parent-lane>]`                                                                                                                                |
| Claim the lane's issue                                      | `pnpm issue:claim <issue>`                                                                                                                                                                                                       |
| Sync a dependent lane                                       | `pnpm lane:sync-parent --lane <absolute-child-lane>`                                                                                                                                                                             |
| Push; open or update the PR                                 | `pnpm lane:publish <issue \| --lane <absolute-path>> [--relates] [--title "<conventional-subject>"] [--summary "<text>"] [--test "<instructions>"] [--model <model>] [--milestone <title>] [--project <title>] [--label <name>]` |
| Adopt a released PR into a new lane                         | `pnpm lane:publish --adopt-pr <pr> --expected-head <full-lowercase-sha> --model <model>`                                                                                                                                         |
| Write the review bundle                                     | `pnpm review:prepare <pr>`                                                                                                                                                                                                       |
| Post `review.json`                                          | `pnpm review:publish <pr>`                                                                                                                                                                                                       |
| Post final `acceptance.json` (legacy pre-policy heads only) | `pnpm review:accept <pr>`                                                                                                                                                                                                        |
| Record a repair, leave open                                 | `pnpm review:repair <pr> --thread <thread-id> --head <full-sha> --commit <full-sha> --summary "<one line>" [--evidence <path-to-json>]`                                                                                          |
| Confirm repairs, resolve                                    | `pnpm review:confirm <pr> --head <full-sha>`                                                                                                                                                                                     |
| Rebuild rounds; shadow-compare                              | `pnpm review:reconstruct <pr>`                                                                                                                                                                                                   |
| Squash-merge                                                | `pnpm deliver <pr>`                                                                                                                                                                                                              |
| Recover a crashed delivery                                  | `pnpm deliver --recover-lock <pr> --owner <oid>`                                                                                                                                                                                 |
| Recover a wedged review post                                | `pnpm review:publish:recover <pr> --owner <oid> [--attest-absent]`                                                                                                                                                               |
| Reconcile a tracker issue at delivery                       | `pnpm issue:reconcile <issue> --expected-body-sha256 <64-hex> (--edits-file <json> \| --superseded-by <issue>)`                                                                                                                  |
| Close a superseded PR                                       | `pnpm pr:supersede <old> --head <old-sha> --replacement <merged> [--superseded-parent <closed-unmerged-parent> [--parent-replacement <merged-parent-replacement>]] --lineage <path-to-json>`                                     |
| Retire an obsolete PR with confirmed repairs                | `pnpm pr:retire <pr> --head <head-sha> --record <path-to-json>`                                                                                                                                                                  |
| Prune spent remote branches                                 | `pnpm branch:prune [--apply] [--limit <n>]`                                                                                                                                                                                      |
| Retry/discover pending post-merge cleanup                   | `pnpm lane:cleanup [--status]`                                                                                                                                                                                                   |
| Install/refresh macOS cleanup job                           | `pnpm lane:cleanup:install`                                                                                                                                                                                                      |
| Remove a spent lane                                         | `pnpm lane:remove <path>`                                                                                                                                                                                                        |
| Strand an abandoned lane                                    | `pnpm lane:strand <path> --reason "<text>"`                                                                                                                                                                                      |
| Prune lane artifacts                                        | `pnpm lane:prune <path> \| --all \| --stale-days <days>`                                                                                                                                                                         |
| Restamp author identity on lanes                            | `pnpm lane:identity`                                                                                                                                                                                                             |

`review:resolve` is retired: valid invocations refuse before authentication or GitHub access, and
`pnpm review:resolve --help` explains the replacement — the author records each repair with
`review:repair` and the distinct reviewer confirms it with `review:confirm`.

`review:accept <pr>` remains only for legacy pre-policy heads: a plan-carrying bundle whose dossier
already carries the reviewer-recorded delivery authorization refuses the duplicate. New deliveries
never call it.

`deliver` already closes the issue the pull request's body closes (not one a `--relates` PR only
references) as completed after the merge.
`issue:reconcile` performs the delivery-time reconciliation `deliver` does not perform itself, in two
modes: replacing exact text in an open issue's body (an `--edits-file` JSON array of 1–64
`{ "from", "to" }` entries, each `from` matching exactly once), or closing an issue as not planned
with one `Superseded by #<n>.` comment naming an open replacement issue. Both refuse unless
`--expected-body-sha256` equals the SHA-256 of the issue's current body. Later corrections to an
issue use manual `gh` under AGENTS.md [Artifacts](../../../AGENTS.md#artifacts).

### Protected primary package route

Run these package scripts with the protected primary checkout as the working directory, never from a
lane: `lane:publish`, `lane:sync-parent`, `review:publish`, `review:publish:recover`,
`review:repair`, `review:confirm`, `review:shadow-status`, `deliver`, `pr:supersede`, `pr:retire`,
`issue:claim`, `issue:reconcile`, and `ruleset:harden` (the trusted ruleset change);
`review:accept` remains only for legacy pre-policy heads, and `review:resolve` only explains its
retirement. Each routes through `scripts/trustedGithubWriteBootstrap.ts`, which refuses any other
launch location with `trusted GitHub writes must be launched from the protected primary checkout`
and runs the script closure from one pinned `origin/main` snapshot. Lane files are data, never
executable delivery code. Snapshot and environment controls: [trust boundary](references/trust-boundary.md).

Each script validates its own preconditions and refuses rather than repairs. Read the refusal, fix
its named cause, and run the same command again; never route around it.

## Delivery path

### a. Claim

Two agents taking the same work waste both. Before `lane:open`, survey for a lane or PR already on
the same issue or surface:

- `git worktree list` for existing lanes;
- `gh pr list --state open` for open PRs;
- `gh pr list --state open --json number,headRefName,files` for open PRs touching the files the
  change will touch.

A lane or PR you did not open is another agent's claim and is read-only for you. The lane cap and
the shared generated files and digests that force waiting or stacking are in AGENTS.md
[Delivery](../../../AGENTS.md#delivery).

Choose the author's model before opening the lane, then open it with
`pnpm lane:open [issue] [slug] --type <type> --model <model>`. `--model` is required and must be the
model the author agent will actually run on: `lane:open` records it in the primary checkout's git
config as `branch.<branch>.sourdaw-author-model`, `lane:publish` turns it into the PR's `Authored by`
label, and `review:publish` refuses a reviewer draw on that model unless the review document carries
`modelExhaustion`. When the author ends up running on a different model, publish with
`lane:publish --model <actual-model>`: an explicit `--model` wins, replaces the recorded value, and
the publication's label edit removes the superseded `Authored by` label. `--type` is the
conventional-commit type of the change; branch grammar and stacking are in
[lane publication](references/lane-publication.md).

Opening a lane stamps the worktree's git config with the author App's commit identity —
`hplovecraft208[bot]`, keyed to its immutable database id 318698904, unsigned — so lane commits
attribute to the App without any credential; `pnpm lane:identity` restamps lanes opened before that
stamp existed.

An issue-bound lane claims its issue in the same step: `lane:open` prints the command, and
`pnpm issue:claim <issue>` — run from the protected primary checkout — adds the `status:active`
label, removes every other `status:` label, and moves every board item holding the issue to In
progress, reading the project's field and option ids live. The script refuses an issue that already
carries `status:active`, making an existing claim visible before work starts; the check is
read-then-write, not atomic, so the survey before `lane:open` remains the guard against two claims
racing in one window.

An issueless lane's worktree and PR are the claim: choose a slug that names the change precisely and
publish early, before the head is final if needed. Work that outlives one lane or session — a
campaign, or a hand-off to another agent — is filed first so each lane binds to the issue that
carries it; a change one lane can land stays issueless.

### b. Brief and dispatch the author

Use the [author brief](#author-brief) below. Resolve the tier and model under AGENTS.md
[Delegation](../../../AGENTS.md#delegation) before writing it, and make sure the lane's `--model` is
that model. The author works only in the lane and commits there; it never pushes.

### c. Before publishing

- Read the whole lane diff yourself (`git diff origin/main...HEAD` in the lane) against the brief:
  specified behavior, tests observing their claimed subjects, nothing outside the stated paths.
- Run the exact affected specs (`pnpm test:run <changed-spec>`, wrapped in `pnpm guard`) and
  `pnpm format <changed-files>` under AGENTS.md [Checks](../../../AGENTS.md#checks). PR CI owns the
  broad suites.
- Settle every generated artifact the change moves, committed in the lane before publishing:
    - **wasm**: any non-test edit in a package's path-dependency closure moves its hash. Name the
      affected packages and build scripts from `scripts/wasm-artifacts.ts`, rebuild each, run
      `pnpm wasm:manifest`, stage the artifacts, then `pnpm wasm:verify`. AGENTS.md
      [Delivery](../../../AGENTS.md#delivery) holds the full rule.
    - **Agent evidence manifest**: `evidence/agent-campaign/manifest.json` pins the SHA-256 of every
      fixture its suites read, and `scripts/__tests__/agentCampaignHarness.spec.ts` fails in push
      Unit validation when a pinned file changes. `pnpm evidence:gate --manifest evidence/agent-campaign/manifest.json`
      lists stale digests; regenerate with
      `pnpm evidence:gate --manifest evidence/agent-campaign/manifest.json --write` and commit the
      rewrite.
    - **Release tracked sets**: `release/open-source-inventory.json` records digests over the
      `gitPathspecs` of `GRAND_BOULE_RELEASE_REGISTRY` in `scripts/checkReleaseInventory.ts`, which
      reach outside the Grand Boule module into Transport MIDI scheduling, AudioEngine runtime and
      worklet files, and the command handler maps and argument keys. After committing a change to any
      of those paths, run `pnpm release:restamp:tracked-set`: it refuses uncommitted tracked-set
      changes, prints `release inventory already current` or each moved digest, and rewrites the
      inventory for you to commit. PR CI's release inventory check fails on a stale digest.

### d. Publish

`pnpm lane:publish <issue | --lane <absolute-path>>` pushes the lane and opens or updates the PR. It
pushes without `--force` and refuses uncommitted changes: the work is committed in the lane with a
conventional subject first. Publishing neither enables auto-merge nor posts reviews.

- **Title.** For conforming lanes (typed or legacy `agent/`), a first publish titles the PR from
  the newest non-merge lane commit, excluding everything reached by resolved `origin/main` and stack
  parent heads; it refuses a lane lacking one. The title then stays frozen through follow-up commits
  and merges unless `--title "<conventional-subject>"` supplies the creation or replacement title.
  The same effective title governs body validation, derived metadata, and branch-type warnings.
  Every publish, follow-ups included, also checks that newest lane subject against `TITLE_PATTERN`
  in `scripts/prContract.ts` (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`,
  `ci`; never `style`) and refuses with `pull-request title is not conventional` when it fails, so
  the newest lane commit needs a conventional subject before every publish, and on the first
  publish it is the subject the PR should show.
- **Body flags.** The body follows [`.github/pull_request_template.md`](../../../.github/pull_request_template.md);
  the script controls format and rejects malformed bodies. A new PR requires explicit `--summary`
  and `--test`; on later runs a supplied flag replaces its section and an omitted flag preserves it.
- **Product-scope How to test.** A product-scope change — any handwritten path under
  `src/modules/`, `src/components/`, or `electron/` — refuses a `--test` in which any sentence,
  clause, or line narrates a command or names specs, suites, or CI; it must teach only
  user/reviewer-observable steps and their expected result, with an app launch folded into the step
  that uses it, while a body preserved from an existing pull request is not re-judged.

Write the PR body for a teammate outside the session. Under template headings explain what changed
and why, without repeating the title, and how to test. How to test is the reviewer's script in the
app: what to open, click, play, or export, and what they should see or hear. Product changes carry
only those steps — unit, E2E, typecheck, lint, and CI runs do not belong beside them, because the
reviewer does not re-run them and the checks list already shows them. Internal or developer work
with no app surface exercises the tool an operator runs and what it prints or refuses, not the specs
covering it; only a test-only change names its specs. The template has no Screenshots section;
agents never attach one. Exclude session diaries, unpublished rounds, mutation tables, and test-run
inventories. The author brief's approach and reasoning stay out of the body.

Branch grammar, issue resolution, stack targets, the authorship gate and its remedy, labels,
milestone and project mechanics, branch-type warnings, and off-convention lanes:
[lane publication](references/lane-publication.md).

### e. Wait for push checks and mergeability

- Wait for the entire `PR checks` workflow on the exact head to conclude `SUCCESS`; a green
  `Plan push checks` job alone is not the workflow result.
- A model-label event may trigger a pre-approval `Gate` failure; that separate run is expected and is
  not awaited before independent review and reviewer-App approval.
- Use one observer per PR; back off on read failures or use a connected reader that returns complete
  checks. Job pages can omit results: establish completion from the whole exact-head workflow or a
  complete check rollup, never a green subset, and do not rerun CI because a status read failed.
- A head that conflicts with its base gets no GitHub merge ref, so no `pull_request` workflow run is
  created and no check can ever appear: waiting on it waits forever. When `lane:publish` reports a
  conflicted head, read `gh pr view <pr> --json mergeable` and resolve the reported paths with a push
  before waiting; an `UNKNOWN` answer is GitHub still computing, so check it again rather than
  treating it as a conflict.

### f. Review round

`pnpm review:prepare <pr>` writes the head-bound bundle under the primary checkout's
`.agents/review-bundles/` with a manifest, diff, size report, risk plan, PR text, and merge-base
contracts, and prints its path. The manifest binds the PR, base, merge-base and head; reuse requires
matching base and merge-base context. Bundle internals and the risk-plan format:
[review records](references/review-records.md).

`review:prepare` does not go through the trusted launcher, so run it only from the protected primary
checkout. It reads the primary's `.env.sourdaw-reviewer` only after its `origin/main` blob check
passes, but that check covers only the script's relative-import closure and runs after the module
graph is evaluated: the executing checkout's import-time code runs before it, and the
`node_modules` it resolves are never checked. Launched from another checkout, that code runs
unverified beside the reviewer credential. When the primary's closure
differs from `origin/main` it refuses with `<path> does not match origin/main; refusing to run a
mutated copy` or `<path> has no blob on origin/main; refusing to run an unverifiable copy`. A primary
checkout lagging `origin/main` is a blocker to report to the owner; never work around it from a lane
or another checkout. The bundle lands under the primary checkout.

Derive the stances under AGENTS.md [Review](../../../AGENTS.md#review) and the
[review-stances README](../review-stances/README.md#stance-derivation-and-the-lesson-library). The
plan's classes name risk surfaces the stance enumeration must weigh and set the draw floor; they
never name the stances:

| Class                                                                                       | Earns                                                     | Draw floor |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| `docs-only` (every path Markdown outside `public/`)                                         | correctness                                               | 1          |
| `test-only` (every path a test)                                                             | test-validity                                             | 1          |
| `small` (no specialist surface, within the line budget, handwritten paths all under `src/`) | correctness, test-validity                                | 2          |
| `small-tooling` (the same, with handwritten paths outside `src/`)                           | correctness, module-boundaries, test-validity             | 3          |
| `ordinary` (no specialist surface, over the budget)                                         | correctness, code-craft, module-boundaries, test-validity | 3          |
| `cross-domain`                                                                              | correctness, module-boundaries, test-validity             | 3          |
| `realtime-audio`                                                                            | correctness, realtime-audio, test-validity                | 3          |
| `native-security`                                                                           | correctness, security-platform, test-validity             | 3          |
| `undo`                                                                                      | correctness, project-integrity-undo, test-validity        | 3          |

A plan of several classes needs three distinct stances, or every stance its classes earn when they
earn fewer. Specialist classes keep those stance and evidence obligations within the same reviewer
cost ceiling.

Before reading any stance report, review the whole head yourself under AGENTS.md
[Review](../../../AGENTS.md#review): no stance, against the request and the author brief. Read the
full lane diff and the code it touches. This global review is not a draw and is not recorded in
`draws`.

Give each blind reviewer exactly one stance with the [reviewer brief](#reviewer-brief) below; a
stance may take several draws on different permitted models.

### g. Validate findings

You adjudicate every finding; nothing reaches the author or the public record unvalidated.

- Check every finding against the live head and surrounding code, not the diff alone, and against
  your own global reading.
- Reproduce each merge-blocking finding: its input, state, or mutation and the observed result.
  Baseline-probe findings name the mutation that should have failed the check but did not.
- Discard incorrect, out-of-scope, or personal-style findings; record each as a `discarded` entry
  and never forward or post it. File out-of-scope defects instead of growing the PR.
- Merge duplicate findings into one comment whose `sources` names every draw that independently
  detected it.
- A blocker your global review found that no draw reported: dispatch a fresh blind draw whose
  stance names that failure mode, never your finding, and post the blocker once a draw reproduces
  it. Do not approve the head meanwhile. A judgement no draw can reproduce (scope, product fit, or
  the wrong approach) is never posted as a finding: withhold approval and reshape the change under
  AGENTS.md [Delegation](../../../AGENTS.md#delegation), re-briefing the author on a new head or
  respinning or closing the PR.

### h. Write `review.json`

`review.json` in the bundle directory is the round's only caller document. Field names come from
`scripts/reviewDocumentParser.ts`. `authorization` and a comment `body` key are refused, and
`draws`, `discarded` and `sources` entries refuse any key outside their exact set. A misspelled
required field (`reviewerModel`, `sources`, `evidence` on `APPROVE`) is refused as missing, but any
other unknown top-level or comment key is dropped silently, so a misspelled optional field such as
`modelExhaustion` has no effect; check every key against this table.

| Field             | Rule                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event`           | `APPROVE` or `REQUEST_CHANGES`.                                                                                                                                           |
| `body`            | Required and nonblank for both events.                                                                                                                                    |
| `comments`        | `REQUEST_CHANGES` requires at least one; `APPROVE` must carry none. Each entry: `path`, `line`, `side` (`LEFT`/`RIGHT`), `defect`, `consequence`, `done`, `sources`.      |
| `sources`         | Per comment: non-empty `{ stance, reviewerModel }` pairs naming the completed draws that independently detected the finding; required on fresh plan-carrying publication. |
| `reviewerModel`   | Required on fresh reviewer publication: a permitted Review-ceiling model, in `lane:open --model` token form.                                                              |
| `modelExhaustion` | Only when a reviewer model equals an authoring model: one line naming what made every other model unavailable; the body must then name that reviewer model.               |
| `draws`           | One `{ stance, reviewerModel, tier, outcome }` per completed blind draw; required on fresh plan-carrying publication.                                                     |
| `discarded`       | Optional; one `{ finding, reason }` per discarded candidate.                                                                                                              |
| `format`          | `compact-v1`, required on a new `APPROVE` and refused without approval `evidence`.                                                                                        |
| `evidence`        | Required on a new `APPROVE`, refused on `REQUEST_CHANGES`: `{ headSha, claims: [{ observable, verification, observed }] }`.                                               |

`authorization` is refused: delivery authorization belongs only to legacy `acceptance.json`.

**Inline comments (`REQUEST_CHANGES`).** Read every changed line and surrounding code as needed.
Comment on the defective line with one problem, discussing code rather than author; the line must be
a changed line on that side of the bundle's `diff.patch`. Use literal fields `defect`,
`consequence`, and `done` for what is wrong, why it matters, and the required result; retired `body`
is refused with an error naming the replacement. Each field is one non-empty line without edge
whitespace; target one precise sentence, never padding. Tooling space-joins fields and appends a
period where terminal punctuation is absent. The composed comment must fit 600 bytes, not
characters; there is no minimum. Request changes when this head must not merge, and post every
blocking comment with that review. The summary is a short pointer to those comments, not a report.

**Round record.** Several draws on one stance with distinct models count once toward the floor.
Fresh `tier` is `economy` or `standard`, and `outcome` is `clean` or `findings`. The fields are
exact; an unknown tier or outcome, a repeated stance-and-model pair, or an extra field is refused.
Discards are shape-checked and never posted or recorded. The accepted findings are the document's
own inline comments. Canonical historical parsers retain `strongest`; that metadata cannot
authorize a fresh publication and is preserved on published replay and recovery.

**Value safety.** Every draw, discard, and approval-claim value must be single-line, trimmed and
bounded, and is refused when it carries a credential-shaped value, a private-key header, a JWT, a
bearer token, or raw session-transcript markers. Private reviewer prose belongs nowhere in the
record.

**APPROVE: compact-v1 evidence.** Bind `evidence.headSha` to the reviewed bundle head. Supply at
least one claim, with every value a nonblank, trimmed, single-line string: `observable` is expected
behavior from the request or contract, `verification` is the exact command, check URL, or source
comparison, and `observed` is the decisive result or excerpt. Keep the body to a short conclusion.
Publication posts only that reviewer-written body; the structured evidence stays unpublished in
`review.json`/`acceptance.json`, bound to the head by `headSha`. `review:accept` validates only
`acceptance.json`'s own head-bound evidence; `review.json`'s evidence is read by the orchestrator,
not by any script. The posted body must fit 600 Unicode code points; reject excess and report the
actual and allowed lengths, never truncate. Record completeness and head binding do not prove
truthful execution; the orchestrator remains responsible for verifying the claims.
`REQUEST_CHANGES` must not carry approval evidence. Unknown fresh formats fail closed. Historical
unversioned documents remain readable only for exact reconstruction and recovery; never rewrite old
bundles or posted reviews. Keep detailed logs in the session and the concise head-bound
verification record in structured bundle evidence. The public approval carries only its short
conclusion; the structured evidence never leaves the bundle.

A minimal `REQUEST_CHANGES` on a `small` plan, with one finding and one clean draw:

```json
{
    "event": "REQUEST_CHANGES",
    "body": "One blocker: a zero tempo reaches the scheduler unclamped; see the inline comment.",
    "comments": [
        {
            "path": "src/modules/Transport/useCases/setTempo.ts",
            "line": 42,
            "side": "RIGHT",
            "defect": "setTempo accepts 0 BPM and stores it in the tempo map",
            "consequence": "secondsBetweenBeats divides by zero and the scheduler stops advancing",
            "done": "setTempo refuses non-positive tempi and a spec proves the refusal",
            "sources": [{ "stance": "non-positive-tempo-input", "reviewerModel": "claude-sonnet-4.5" }]
        }
    ],
    "reviewerModel": "claude-sonnet-4.5",
    "draws": [
        {
            "stance": "non-positive-tempo-input",
            "reviewerModel": "claude-sonnet-4.5",
            "tier": "standard",
            "outcome": "findings"
        },
        {
            "stance": "tempo-undo-restores-stale-map",
            "reviewerModel": "gpt-6-luna",
            "tier": "economy",
            "outcome": "clean"
        }
    ],
    "discarded": [{ "finding": "rename tempo to bpm in setTempo", "reason": "personal style, no defect" }]
}
```

A minimal `APPROVE` on the same plan:

```json
{
    "format": "compact-v1",
    "event": "APPROVE",
    "body": "setTempo now refuses non-positive tempi. Attacked zero, negative and NaN input and undo after a refused edit; all held. Nit: the refusal message could name the accepted range.",
    "reviewerModel": "claude-sonnet-4.5",
    "draws": [
        {
            "stance": "non-positive-tempo-input",
            "reviewerModel": "claude-sonnet-4.5",
            "tier": "standard",
            "outcome": "clean"
        },
        {
            "stance": "tempo-undo-restores-stale-map",
            "reviewerModel": "gpt-6-luna",
            "tier": "economy",
            "outcome": "clean"
        }
    ],
    "evidence": {
        "headSha": "0123456789abcdef0123456789abcdef01234567",
        "claims": [
            {
                "observable": "setTempo refuses a tempo of 0 BPM",
                "verification": "pnpm test:run src/modules/Transport/useCases/__tests__/setTempo.spec.ts with the guard reverted",
                "observed": "the zero-tempo case fails on revert and passes on the head"
            }
        ]
    }
}
```

### i. Before any APPROVE publish

- The whole `PR checks` workflow is `SUCCESS` on that exact head (step e).
- `gh pr view <pr> --json mergeable` reads `MERGEABLE`; wait out `UNKNOWN`, and resolve `CONFLICTING`
  with a new head and a fresh round.
- Zero unresolved review threads, CodeQL `github-advanced-security` threads included.
  `review:publish` counts every unresolved thread and refuses a fresh APPROVE over any of them before
  writing anything, because an approval over open threads can never authorize its head and its
  persisted publication would replay without one (#5436). Clear threads through
  [repair](#k-repair), never by approving over them.
- Your [global review](#f-review-round) of this exact head holds, and you would merge it; never
  approve a head you judge unfit, whatever the draws say.
- The document carries no inline comments and its body fits 600 Unicode code points; observations go
  in the body as `Nit:` or `Optional:`, or are filed.

### j. Publish the review

`pnpm review:publish <pr>` posts `review.json` as the reviewer App only when GitHub's live head
matches the bundle; a fresh approval also requires matching base context. It validates the plan and
the document, derives the head's canonical record, and refuses before any remote write when the
draws miss the floor, a model exceeds the review cost ceiling, a reviewer model matches an author
without `modelExhaustion`, or a value is unsafe. A bound published record replays exactly, without
another post. A legacy bundle without a risk plan retains its historical shape. The full refusal and
replay contract: [review records](references/review-records.md).

Post validated blockers as a `REQUEST_CHANGES` review BEFORE dispatching any repair.
`REQUEST_CHANGES` removes the `ci:approved` label.

On a clean round, the reviewer posts one APPROVE; that reviewer APPROVE on the current head records
the delivery authorization in the head's dossier, and `review:publish` then re-applies the
`ci:approved` label as the reviewer App, after its publication lock is released; a failed label write
exits nonzero naming the pull request, and a plain re-run replays the review and retries it. That
label event alone starts the heavy checks and `Gate`, so CI capacity is spent once per approved
head. Re-running `review:publish` on the same head replays the review and re-applies the label,
which restarts a `Gate` that a later label event failed or cancelled.

### k. Repair

1. Dispatch each validated finding with the [repair brief](#repair-brief). If a repair introduces a
   new mechanism or outcome, reassess the PR scope under AGENTS.md Delegation first.
2. The author commits the fix in the lane without pushing; read the diff yourself as in step c.
3. Push through `lane:publish` from the protected primary checkout. Lane tooling owns every push.
4. For each thread, record the repair as the author App:
   `pnpm review:repair <pr> --thread <thread-id> --head <full-sha> --commit <full-sha> --summary "<one line>"`.
   `--head` is the pull request's live head. `--commit` is the repairing commit: inside `base..head`
   and strictly descending the commit the thread's root finding reviewed (it may equal the live
   head). It refuses an already resolved thread, a stale `--head`, or a commit that predates or is
   the reviewed revision. It never resolves; re-running the same head and commit posts nothing.
5. The reviewer App confirms with `pnpm review:confirm <pr> --head <full-sha>`, resolving only the
   threads whose recorded repair validates; any refusal resolves nothing and names the ambiguity to
   fix before re-running.
6. Run a fresh `review:prepare` and a new blind round on the new head.

No script writes free-form thread replies, so wrongly posted findings have no discussion route;
clarify code, not threads. Full eligibility, ancestry, and crash-recovery mechanics:
[repair and lock recovery](references/repair-and-lock-recovery.md).

### l. Gate and deliver

Wait for the approval-triggered `Gate`. The merge is your decision: run `pnpm deliver <pr>` from the
protected primary checkout, and the script squash-merges as the immutable author App after the
reviewer APPROVE and a green `Gate`.

#### Validation order

`pnpm deliver` squash-merges only non-draft, structurally mergeable PRs after BOTH validation points
confirm the immutable reviewer Bot `APPROVED` the current head, with its recorded delivery
authorization binding that live reviewer approval, and all threads resolved. Approval counts or
matching logins cannot substitute for that actor identity. Merge executes as the immutable author
App; receipt and tracker writes retain their author App identities.

Head, head branch, base branch, body, canonical closing target, and stacked dependents must stay
stable between reads. `deliver` remains main-only and refuses any other base; reconcile a landed
parent through `lane:sync-parent`, republish the child against main, and obtain fresh review before
delivery. Do not merge any other way.

#### CI admission

Snapshot-backed CI admission is advisory: successful, failed, pending, absent, cancelled, malformed,
or unavailable evidence does not itself block delivery. GitHub still enforces the live ruleset's
required `Gate`; `deliver` refuses `BLOCKED` before any remote write, including receipts or merge
attempts. Dormant required-CI admission retains pinned workflow-derived gate and complete-rollup
rules from the launcher's pinned `origin/main` workflow copy; lanes cannot select or reshape it.

#### Refusals and retries

GitHub structural mergeability independently gates base compatibility: delivery retries one
transient `UNKNOWN`, refusing conflicts or a second `UNKNOWN`.

For a crashed delivery, repair, confirmation, closure, or review publication, follow the
operation-specific [lock recovery](references/repair-and-lock-recovery.md); recovery itself does not
perform the original operation.

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

- Verify the issue is closed and its board item reads Done; project automation may not move it.
- Delivery removes its own lane (below). When it reports cleanup pending, `pnpm lane:cleanup
--status` names the refusal and the scheduled job retries; `pnpm lane:remove <path>` from outside
  the lane remains the manual route, and its author lock remains until removal succeeds.
- Delete the leftover local branch, which neither route deletes (AGENTS.md
  [Worktrees](../../../AGENTS.md#worktrees)).

#### Local cleanup after delivery

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
refuses. It preserves other primary dirt and never depends on the author lane surviving. Install
then verifies the job's first launchd launch and, when launchd cannot initialize it, boots the job
out, removes the plist and fails with the remediation. On macOS a primary on an external volume needs
the pinned Node binary granted Full Disk Access (or Removable Volumes access). Consult
`lane:cleanup --status` from a current checkout, `.agents/lane-cleanup/worker*.log`, and
`launchctl print gui/$(id -u)/com.sourdaw.lane-cleanup` for retained work and scheduler status.

## Briefs

AGENTS.md [Delegation](../../../AGENTS.md#delegation) lists what every dispatch contains; these
templates add how to do the work. Keep each a checklist.

### Author brief

Why: an author who must rediscover the design, the code to imitate, and the area's traps re-decides
choices already made and spends its budget exploring; a senior engineer hands a junior the steps.

- **Delegation fields**: objective, lane, branch, paths, exclusions, dependencies, preservation
  guarantees, acceptance conditions, integration observable, exact checks, and, for a handwritten
  path under `src/modules/`, `src/components/`, or `electron/`, the user-observable How-to-test
  steps. Trace each observable to its producing line and each mechanism to every route first.
- **Approach**: the chosen approach and the rejected alternative with the reason, so the author does
  not re-decide the design.
- **Where to work**: the files and functions to change and the existing code to imitate, as
  `path:line`.
- **Step order**: first a failing spec that reproduces the behavior, then the change, then callers,
  then formatting.
- **Traps**: the domain skill under `.agents/skills/` and the module `AGENTS.md` to read, the
  architecture rules that bite in this area, and the generated artifacts the change will move
  ([step c](#c-before-publishing)).
- **Per-step verification**: the exact command for each step and its expected result — the new spec
  fails before the change and passes after.
- **Stop rule**: when the code contradicts the brief — a file differs, a route is uncovered, an
  observable is not emitted — stop and report instead of improvising. Brief errors are the
  orchestrator's defect.
- **Commit**: the author commits in the lane with the conventional subject that will title the PR,
  and never pushes.
- **Return**: status, changed paths, decisive evidence, blockers.

Depth limit: name the functions, patterns, and order; leave naming, local structure, and the code
itself to the author. Never write pseudo-code. Detail scales inversely with tier: an economy-tier
author gets more explicit steps, a strongest-tier author gets intent plus constraints.

### Repair brief

Why: a repair written from reviewer prose anchors the author on the reviewer's framing, and a repair
that loosens a check without naming what stays rejected silently widens it.

- The finding restated in your own words, never the reviewer's prose; authors never judge findings
  against their own work.
- The repair approach, with where to work and the step order as in the author brief.
- When the fix loosens a validator or check: the inputs that must still be rejected and the cases
  that must still fail, each with a spec.
- The stop rule from the author brief.
- Commit in the lane without pushing; return status, changed paths, decisive evidence, blockers.

### Reviewer brief

Why: a reviewer given anything but the head, the bundle, and one stance is anchored, and a reviewer
without a posture and a probe duty returns a pass that proves nothing.

- **Target**: the bundle path printed by `review:prepare` and the full head SHA.
- **Stance**: exactly one, named for the failure mode that admits it, plus the most specific
  matching file under [`.agents/skills/review-stances/`](../review-stances/README.md), never a
  broader one in addition, or none when no file matches.
- **Baseline probe**: establish what must break for each existing check to fail and whether it
  observes what its name claims; name a mechanical probe (revert the behavioral hunk or apply one
  targeted mutation, then run the named spec through
  `pnpm guard --profile focused -- pnpm test:run <spec>`). Remaining green fails the
  round.
- **Isolation**: read the fixed commit with `git show <sha>:<path>` and the bundle; never create a
  worktree or clone or install dependencies. Probes run only through an explicit exclusive handoff
  of the clean, committed author lane under
  [reviewer isolation](../review-stances/README.md#reviewer-isolation). If no handoff or execution
  is available, report the exact mutation, named check, and limitation; an unrun probe is never a
  pass.
- **Posture**: try to break the change and report the strongest surviving finding with concrete
  failure inputs or state, or report none. Finding nothing is success; hedged findings without a
  concrete break are discarded.
- **Report**: per finding `path`, `line`, `side`, `defect`, `consequence`, `done`, and the
  reproduction input, state, or mutation with its observed result; or `clean` plus the probe that
  ran and its result. Findings go only to the orchestrator.
- **Model**: economy or standard tier on a Review-ceiling model family, different from the PR's
  `Authored by` model when one is available, otherwise recorded through `modelExhaustion` (step h).
  A harness that cannot select models uses
  [headless reviewer dispatch](references/review-records.md#headless-reviewer-dispatch).

Never give reviewers other reviewers' prose, the author's transcript, or orchestrator reasoning. The
author brief's approach and reasoning never reach a reviewer, the bundle, or the PR body.

## Freeze

At five reviewer `REQUEST_CHANGES` rounds a PR is frozen to fresh publication under AGENTS.md
[Review](../../../AGENTS.md#review); mechanics in [review records](references/review-records.md).

## References

- [Lane publication and maintenance](references/lane-publication.md): open on a `lane:publish`
  refusal about the branch name, lane resolution, commit authorship, labels, milestone or project,
  on an off-convention lane, or before `branch:prune`.
- [Review records](references/review-records.md): open on a `review:prepare` or `review:publish`
  refusal, a classification question, a replay or reconstruction, a frozen PR, a harness that
  cannot select reviewer models, a stack-child approval, or a legacy `acceptance.json` head.
- [Repair and lock recovery](references/repair-and-lock-recovery.md): full repair and confirmation
  eligibility, the delivery lock, review-publication lock recovery, and receipts; open on any
  `review:repair` or `review:confirm` refusal or a crashed operation.
- [Closure and retirement](references/closure-and-retirement.md): open before `pr:supersede` or
  `pr:retire`.
- [Lane adoption](references/lane-adoption.md): open before taking custody of a released PR with
  `lane:publish --adopt-pr`.
- [Historical stack admission](historical-stack-admission.md): open when a stack child has neither
  descriptor nor fork marker and must recover its original parent.
- [Trust boundary](references/trust-boundary.md): open when a launcher snapshot or environment
  refusal needs explaining.
