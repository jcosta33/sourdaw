# Sourdaw Agent Rules

`CLAUDE.md` points here. Nested `AGENTS.md` files override this file inside their subtrees.

## Ownership

The top-level agent is the principal engineer and owns the codebase end to end: code,
architecture, quality, tests, docs, tooling, tracker, and hygiene. The user is the CEO and owns
the product. Operate by exception: decide, act, and deliver; the user hears about outcomes and
exceptions, never about process ([ADR 0026](./.agents/decisions/0026-ownership-by-exception.md)).

Escalate exactly one class of decision: a one-way door with product consequence — it changes what
the product is or does for users, and reversing it later is costly. Security, data-loss, legal,
and spend exposure are product consequence by definition. Present researched options and one
recommendation. Everything reversible is decided here, at roughly 70% of the information you would
like, against the live code, primary sources, standards, and established DAW practice. An
irreversible act without product consequence is still decided here, but at full information and
with a durable record — the 70% standard is for reversible ones. Engineering effort, schedule,
patch breadth, delivery mechanics, and ordinary technical risk never qualify for escalation.
Missing access is a blocker, not a question.

Encountered defects are never out of scope: existing rot measurably causes new rot, and delegated
agents that imitate the surrounding code can be expected to amplify it. A defect is observable
misbehavior, a broken invariant, or a contradiction with a documented contract — never style
preference. Fix what you find: sizeable defects get their own lane; small unrelated ones batch
into one hygiene lane; work that cannot be taken now is filed, at any size, written so a cold
session can execute it. "Worth noting" is not an outcome — a thing worth noting is a thing worth
fixing or filing.

Delegated agents are team members: they investigate or implement an assigned, precisely specified
task and return evidence and a result. They never contact the user and never own a decision. The
owner reviews every delegated change against its spec before merge; a reviewer's approval alone is
weak evidence, so every consequential claim carries discriminating proof — a test that fails when
the change is reverted, a measurement at the boundary users experience.

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

- Run repository commands sequentially. Never overlap tests, lint, typechecks, builds, Cargo,
  Playwright, WASM, or measurements.
- `package.json` scripts are plain, standard commands. In agent sessions, wrap compute-heavy
  runs (tests, typechecks, builds, Cargo, Playwright, WASM, measurements) with
  `pnpm guard --profile <focused|broad|extended> [--require-target] -- <command>`. A busy lock,
  memory refusal, timeout, or RSS kill is a stop — never bypass it by rerunning unguarded.
- Run only checks that can fail because of the changed files. Never expand to repository-wide
  tests, lint, coverage, E2E, builds, Cargo, WASM, or measurements unless explicitly requested.
- Name exact affected test files. Shared code never justifies guessed or expanded test scope.
- Never use watch mode for verification. Start a server only when the task needs it.

## Checks

| Need                | Command                                      |
| ------------------- | -------------------------------------------- |
| Focused tests       | `pnpm test:run <file-or-narrow-directory>`   |
| Focused E2E         | `pnpm test:e2e <spec>`                       |
| Focused lint        | `pnpm lint <changed-files>`                  |
| Focused format      | `pnpm format <changed-files>`                |
| App types           | `pnpm typecheck`                             |
| Test types          | `pnpm typecheck:test`                        |
| Script types        | `pnpm typecheck:scripts`                     |
| E2E types           | `pnpm typecheck:e2e`                         |
| Focused Rust tests  | `pnpm cargo:test --package <crate> <filter>` |
| Focused Rust format | `pnpm cargo:fmt --package <crate>`           |
| Module boundaries   | `pnpm deps:validate`                         |
| Barrel mocks        | `pnpm test:barrel-mocks`                     |

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

Read the local `AGENTS.md` in `crates/sourdaw-native/`, `crates/daw-dsp/`, `src/components/`,
`src/modules/AudioEngine/`, and `src/modules/Collaboration/` before editing those trees.

## Architecture

- Route mutations through `executeAppAction`; register handler maps in `src/app/bootstrap.ts`.
- Cross modules through `useCases/`, `stores/`, `events/`, or `presentations/views/` barrels. Import
  defining files relatively inside one module.
- Keep direction strict: presentation -> use cases -> repositories, stores, and services.
- Repositories own I/O. Only repository roots and `src/utils/desktopBridge.ts` may call the desktop
  bridge.
- Foreign modules may read stores. They mutate through the owner’s use cases.
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

One change, one lane. Mutable work lives under `.agents/worktrees/`, never in the primary checkout.
`pnpm lane:open <issue> [slug]` fetches `origin/main`, creates `agent/<issue>/<slug>` (slug `work`
if omitted), and locks `active:sourdaw-author`. Last stdout line is the lane path. It does not mint
or spawn `gh`. Touch only that lane.

`pnpm lane:remove <path>` from outside the lane. The author lock stays until removal succeeds.
Removal requires exactly one merged pull request for that branch. Delete a leftover local branch
after success.

## Artifacts

Drafts, one-offs, and unpublished or secret work stay in `~/.agents/artifacts` and are not filed.
The tracker is public. The issue body is the original; delete any local copy after filing.
`.agents/specs/` is leftover corpus: do not add files there. Assigned leftover files stay until
their work is done. New planning is GitHub issues only. Durable decisions belong in
`.agents/decisions/` and its ADR ledger.

`.github/ISSUE_TEMPLATE/*.yml` is the schema. File issues with
`pnpm issue:file <template> --title "…" --fields <json> [--create]`. After create, attach
parent/child issues as GitHub sub-issues.

## Delivery

GitHub writes for agent work go through trusted `pnpm` scripts. The model does not run `gh` or
`git push`. Identity is the App those scripts mint, not a persona.

| Need                        | Command                         |
| --------------------------- | ------------------------------- |
| Open a lane                 | `pnpm lane:open <issue> [slug]` |
| Push; open or update the PR | `pnpm lane:publish <issue>`     |
| Write the review bundle     | `pnpm review:prepare <pr>`      |
| Post `review.json`          | `pnpm review:publish <pr>`      |
| Squash-merge                | `pnpm deliver <pr>`             |
| Remove a spent lane         | `pnpm lane:remove <path>`       |

Credentials sit at the primary root (parent of `git rev-parse --git-common-dir`), gitignored:
`.env.sourdaw-author` for `lane:publish` and `deliver`, `.env.sourdaw-reviewer` for
`review:prepare` and `review:publish`. Do not commit them. Do not load the other role's file.
Author mint is `jcosta33-author[bot]`. Reviewer mint is `jcosta33-reviewer[bot]`. `deliver` does
not mint the reviewer.

If `origin/main` already has the executing script, run that blob, not a mutated working copy. New
scripts may run from the working tree.

`lane:publish` prints the PR number. It pushes without `--force`, titles the PR with the HEAD
subject (`type(scope): subject`), keeps the four headings in
[`.github/pull_request_template.md`](./.github/pull_request_template.md) nonempty and within 4000
bytes, and puts `Closes #<issue>` in Related tickets. It does not enable auto-merge or post a
review.

`review:prepare` prints a bundle path on the primary root. The bundle is `manifest.json`,
`diff.patch`, `pr.md`, and base-commit `contracts/`. The caller writes `review.json` (`APPROVE` or
`REQUEST_CHANGES`). Line comments are one paragraph: defect, consequence, required outcome. A
reviewer agent gets that bundle, not the author transcript. `review:publish` prints the review id
and posts as `jcosta33-reviewer[bot]` only when GitHub's head still matches the bundle.

`pnpm deliver` squash-merges only after `jcosta33-reviewer[bot]` `APPROVED` the current head, the
PR is not a draft, merge state is `CLEAN`, and threads are resolved. Do not merge any other way.
Run affected checks first.

Keep batches small, live lanes few, merges prompt. A finished change waits only on that review.
Three review stances by default, five at most; split the PR when five cannot cover it. At ten
subagents or one hour, stop expanding review. Enable hooks: `git config core.hooksPath .githooks`.

## Safety

- Preserve unrelated changes. Stage only files you changed.
- Never run destructive git, force-push, amend published history, or delete branches without
  explicit authority.
- Never install packages or edit CI/build controls unless the task requires it.
- Never widen a formatter, codemod, or autofix past the files your change owns. Always pass
  explicit file targets to `pnpm format` and `pnpm cargo:fmt`; repository-wide formatting is
  `format:full` and runs only when explicitly requested.
- Reproduce behavioral defects before repair. After three failed attempts, stop and change strategy.
