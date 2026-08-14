# Sourdaw Agent Rules

`CLAUDE.md` points here. Nested `AGENTS.md` files override this file inside their subtrees.

## Decision Authority

Treat the user as CEO. Bring product decisions, not technical homework. Research technical doubt
to closure through the code, primary sources, standards, and the best proven industry examples.
Apply the strongest established answer. Never ask the user to resolve niche implementation details.

Ask only when the choice changes product vision, UX, feature scope, policy, risk tolerance, or
irreversible business direction. Present researched options and a recommendation.

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
| Focused Rust tests  | `pnpm cargo:test -- -p <crate> <test-filter>` |
| Focused Rust format | `pnpm cargo:fmt -- -p <crate>`                |
| Module boundaries   | `pnpm deps:validate`                          |
| Barrel mocks        | `pnpm test:barrel-mocks`                      |

Tests use at most two workers. Playwright uses one. See [testing](./docs/06-testing.md).

## Map

- `src/modules/`: product code, split by domain.
- `src/app/`: composition root and dependency registration.
- `src/infra/`, `src/helpers/`, `src/utils/`: cross-cutting code; never import domain modules.
- `src/components/`: shared UI; never import stores or use cases directly.
- `src-tauri/`: Tauri commands and bridge code.
- `crates/`: Rust, native audio, and DSP.
- `.agents/skills/`: repository-specific skills.
- `.agents/worktrees/`: gitignored worker lanes.

Read the local `AGENTS.md` in `src-tauri/`, `crates/daw-dsp/`, `src/components/`,
`src/modules/AudioEngine/`, and `src/modules/Collaboration/` before editing those trees.

## Architecture

- Route mutations through `executeAppAction`; register handler maps in `src/app/bootstrap.ts`.
- Cross modules through `useCases/`, `stores/`, `events/`, or `presentations/views/` barrels. Import
  defining files relatively inside one module.
- Keep direction strict: presentation -> use cases -> repositories, stores, and services.
- Repositories own I/O. Only repository roots and `src/utils/tauriBridge.ts` may call Tauri.
- Foreign modules may read stores. They mutate through the owner’s use cases.
- Keep use-case types and models private. Derive public shapes from callable or event contracts.
- Keep worklets isolated from app, helpers, and Tauri. Audio-thread code must not allocate, lock,
  or block.
- Use `type`, named exports, explicit control flow, real types, and meaningful assertions. Never
  launder failures with unsafe casts, suppressions, weakened tests, or baseline edits.
- React Compiler owns memoization. Do not add `useMemo`, `useCallback`, `React.memo`, or
  `forwardRef`.

Run `pnpm deps:validate` after cross-module changes. Full rules:
[system](./docs/architecture/01-system.md),
[TypeScript modules](./docs/architecture/03-typescript-module.md),
[Rust/Tauri](./docs/architecture/02-rust-backend.md), and
[conventions](./docs/07-conventions.md).

## Worktrees

One change, one worktree. Never implement or review mutable work in the shared root checkout.
Create its lane from `origin/main` and lock it with
`git worktree lock --reason active:<owner> <path>`. Touch only your lane. Never disturb another
owner’s worktree or changes. A merged PR means its worktree is dead: unlock it and immediately run
`pnpm lane:remove <path>` from elsewhere. Delete the local branch if the remover leaves it behind.

## Artifacts

Keep working specs outside the repository. Add one only when the owner explicitly promotes it.
Leave existing `.agents/specs/` material untouched unless assigned. Durable decisions belong in
`.agents/decisions/` and its ADR ledger.

## Delivery

- Run affected checks before delivery. Use `pnpm deliver <pr-number>` only to validate PR state and
  merge. Never bypass it with raw merge or branch deletion.
- Follow `.github/pull_request_template.md`. PR descriptions stay under 4000 bytes. State what
  changed, why, and what deserves attention.
- Put review findings on the relevant diff line. Use one short paragraph: defect, consequence,
  required outcome. Use a general comment only for a cross-cutting defect; keep it under 2000 bytes.
- Use three review stances by default and five at most. More means split the PR or ask. More than
  ten subagents or one hour on one PR requires approval.
- Use conventional commit titles: `type(scope): subject`. Enable hooks with
  `git config core.hooksPath .githooks`.

## Safety

- Preserve unrelated changes. Stage only files you changed.
- Never run destructive git, force-push, amend published history, or delete branches without
  explicit authority.
- Never install packages or edit CI/build controls unless the task requires it.
- Never run a whole-tree writer: `pnpm format`, `cargo fmt --all`, a codemod. Bulk-edit only files
  your change already owns.
- Reproduce behavioral defects before repair. After three failed attempts, stop and change strategy.
