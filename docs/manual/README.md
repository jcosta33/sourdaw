# Sourdaw User Manual

How to use Sourdaw: every panel, every device, every shortcut. This manual describes what the
application does and how to operate it. It does not describe how it is built.

> **Note**: For architecture and contribution documentation, see [the developer docs](../README.md).
> Different audience, different book.

## Start here

- [Concepts](./02-concepts.md) — the ideas the rest of the manual assumes

## Device reference

Organized by what a device does, not by its name.

**EQ & Filter** — [EQ](./devices/20-eq.md) (three-band equalizer)

**Dynamics** — [Gluten](./devices/07-gluten.md) (compressor), [Crust](./devices/08-crust.md) (limiter)

**Mastering** — [Proof](./devices/10-proof.md) (mastering chain)

**Time & Space** — [Dutch Oven](./devices/09-dutch-oven.md) (reverb)

**Amp and distortion** — [Grinder](./devices/11-grinder.md) (guitar amp and cabinet)

**Tuning** — [Scoring](./devices/12-scoring.md) (tuner)

**Creative multi-FX** — [Bacteria](./devices/13-bacteria.md) (multi-band mangler)

**MIDI FX** — [Yeast](./devices/14-yeast.md) (MIDI rack)

**Orchestra** — [Levain](./devices/15-levain.md) (sampled orchestra)

**Drums** — [Toaster](./devices/16-toaster.md) (drum pads and sequencer)

**Synth** — [Fermenter](./devices/17-fermenter.md) (wavetable and analog synth)

**Sample** — [Crumbs](./devices/18-crumbs.md) (drag-and-drop sampler)

**Pitch** — [Knead](./devices/19-knead.md) (clip pitch correction)

## Conventions used in this manual

Sourdaw is in active development. Where a feature is incomplete, this manual says so at the point
you would otherwise be confused, using one of two markers.

> [!NOTE]
> **Alpha.** The feature works and does what this page describes, but it is incomplete and will
> change.

> [!WARNING]
> **Not yet active.** The control is on screen and remembers its value, but has no effect yet. The
> marker states exactly which cases are affected.

Anything with no marker works as written. Features with no usable entry point are left out entirely
rather than promised — this is a manual, not a roadmap.

## Reading a device page

Every device page follows the same shape, so you can skip to what you need:

- **At a glance** and **First moves** get you a result in under a minute.
- One section per panel section, in the order the panel presents them, each a table of
  **Control · Range · Default · What it does**.
- Notes under a table cover only controls where the label and range do not tell the whole story.
- **Meters and readouts**, **Presets**, and **Automation and control** close the page.

Ranges and defaults are the real ones. Where a control behaves differently depending on another
control, the table says which.

## Names

This manual uses the names printed on screen.

The devices are named after baking. The interface does not explain why, and neither does this
manual, so every device page states its category next to its name and the reference above is
grouped by what things do rather than what they are called. You will not have to know that Gluten
is a compressor to find a compressor.

Internal names occasionally surface where the interface has no say — inside a saved project file,
for instance. When the manual gains a glossary, those go there.

--- Rules in scope for this file ---
[From: .agents/worktrees/agent--builtin-eq-manual/CLAUDE.md]

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
lane; small unrelated ones batch into one hygiene lane; work you cannot take now is filed at any
size, written so a cold session can execute it. "Worth noting" is not an outcome — a thing worth
noting is a thing worth fixing or filing.

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

Every dispatch carries the objective, lane, branch, scope, exclusions, dependencies, acceptance
conditions, and checks. Require back only status, changed paths, decisive evidence, and blockers.

Run agents in parallel only on write-disjoint work. Sequence shared contracts, generated artifacts,
and overlapping files.

## Review

Reviewers are blind. Each one gets the head, the diff, and exactly one stance — never another
reviewer's prose, the author's transcript, or the orchestrator's reasoning. Independence is the
entire value, and a reviewer shown prior findings anchors to them.

Derive stances from the risk surface the change actually touches, and stop once every material risk
is covered. No count is required. The recurring surfaces are correctness, module boundaries and
contracts, real-time audio safety, project integrity and undo, security and platform boundaries,
and test validity.

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
and `lane:publish` must run from inside that lane because the working directory identifies it. Touch
only your own lane.

A lane isolates the working tree and nothing else. The stash, the process table, the disk, and the
author lock are shared across every lane, so a global or destructive operation run inside one lane
hits all of them.

`pnpm lane:remove <path>` from outside the lane. The author lock stays until removal succeeds.
Removal requires a clean lane holding the merged head of exactly one pull request. Delete a leftover
local branch after success. A superseded lane therefore cannot be removed: `pr:supersede` closes the
old pull request unmerged, so that lane and the author lock it holds persist until the tooling gains
a path.

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

| Need                                                                                                | Command                                 |
| --------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Open a lane                                                                                         | `pnpm lane:open [issue] [slug]`         |
| Push; open or update the PR                                                                         | `pnpm lane:publish [issue] [--relates]` |
| Write the review bundle                                                                             | `pnpm review:prepare <pr>`              |
| [… truncated at ~4210 of 6472 tokens — use ctx_read with lines= parameter to see specific sections] |
