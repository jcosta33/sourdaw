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
- Use guarded `package.json` scripts. A busy lock, memory refusal, timeout, or RSS kill is a stop.
  Never bypass it with raw tool commands.
- Run only checks that can fail because of the changed files. Never expand to repository-wide
  tests, lint, coverage, E2E, builds, Cargo, WASM, or measurements unless explicitly requested.
- Name exact affected test files. Shared code never justifies guessed or expanded test scope.
- Never use watch mode for verification. Start a server only when the task needs it.

## Checks

| Need                | Command                                       |
| ------------------- | --------------------------------------------- |
| Focused tests       | `pnpm test:run <file-or-narrow-directory>`    |
| Focused E2E         | `pnpm test:e2e <spec>`                        |
| Focused lint        | `pnpm lint <changed-files>`                   |
| Focused format      | `pnpm format <changed-files>`                 |
| App types           | `pnpm typecheck`                              |
| Test types          | `pnpm typecheck:test`                         |
| Script types        | `pnpm typecheck:scripts`                      |
| E2E types           | `pnpm typecheck:e2e`                          |
| Focused Rust tests  | `pnpm cargo:test --package <crate> <filter>`  |
| Focused Rust format | `pnpm cargo:fmt --package <crate>`            |
| Module boundaries   | `pnpm deps:validate`                          |
| Barrel mocks        | `pnpm test:barrel-mocks`                      |

Tests use at most two workers. Playwright uses one. See [testing](./docs/06-testing.md).

## Map

- `src/modules/`: product code, split by domain.
- `src/app/`: composition root and dependency registration.
- `src/infra/`, `src/helpers/`, `src/utils/`: cross-cutting code; never import domain modules.
- `src/components/`: shared UI; never import stores or use cases directly.
- `electron/`: desktop shell — main process, preload bridge, and IPC router.
- `crates/`: Rust, native audio, and DSP.
- `.agents/skills/`: repository-specific skills.
- `.agents/worktrees/`: gitignored worker lanes.

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

One change, one worktree. Never implement or review mutable work in the shared root checkout.
Create its lane from `origin/main` and lock it with
`git worktree lock --reason active:<owner> <path>`. Touch only your lane. Never disturb another
owner’s worktree or changes. A merged PR means its worktree is dead: unlock it and immediately run
`node --experimental-strip-types scripts/removeLane.ts <path>` from elsewhere. Delete the local
branch if the remover leaves it behind.

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

- Keep batches small, live lanes few, and merges prompt. A finished change waits on nothing but its
  review.
- Run affected checks before delivery. Use `pnpm deliver <pr-number>` only to validate PR state and
  merge. Never bypass it with raw merge or branch deletion.
- Follow `.github/pull_request_template.md`. PR descriptions stay under 4000 bytes. State what
  changed, why, and what deserves attention.
- Put review findings on the relevant diff line. Use one short paragraph: defect, consequence,
  required outcome. Use a general comment only for a cross-cutting defect; keep it under 2000 bytes.
- Use three review stances by default and five at most. Split the PR when five cannot cover it. At
  ten subagents or one hour, stop expanding review; reconcile, fix, and finish or split the PR.
- Use conventional commit titles: `type(scope): subject`. Enable hooks with
  `git config core.hooksPath .githooks`.

## Safety

- Preserve unrelated changes. Stage only files you changed.
- Never run destructive git, force-push, amend published history, or delete branches without
  explicit authority.
- Never install packages or edit CI/build controls unless the task requires it.
- Never widen a formatter, codemod, or autofix past the files your change owns. `pnpm format`
  requires a target; never route around it with a raw `prettier --write` or `cargo fmt --all`.
- Reproduce behavioral defects before repair. After three failed attempts, stop and change strategy.
