# Sourdaw Web App — Agent Guidelines

Tool-neutral guidance for AI coding agents (Cursor, Codex CLI, Windsurf, Cline, Copilot Coding Agent, Claude Code). `CLAUDE.md` is a symlink to this file.

## Checks

See `package.json` for all scripts.

- **Tests:** `pnpm test:run <path/to/file.spec.ts>` — always pass a file (or narrow path). `pnpm test` is watch mode; do not use it for verification. See `docs/06-testing.md`.
- **Lint:** `pnpm exec eslint <path/to/file.ts>` — always specify the touched files. Do not run whole-tree `pnpm lint` unless the task is a repo-wide lint pass. CI uses `pnpm lint --quiet` (errors only; **warns do not fail**).
- **Type check (app):** `pnpm typecheck` — base `tsconfig.json`; **excludes** `*.spec.ts(x)`.
- **Type check (tests):** `pnpm typecheck:test` — currently scoped to Yeast processors (`tsconfig.test.json`); do not claim “all specs typecheck” from `pnpm typecheck` alone.
- **Module boundaries:** `pnpm deps:validate` (main + causal reachability + type-edge + test-inclusive cruises). New **error** edges and stale baseline rows fail; known debt is exact and reviewable.

After cross-module moves or bulk import changes, re-run `pnpm deps:validate` before claiming done (at least every ~10 files during large refactors).

## Codebase layout

- **`src/modules/`** — DDD domain modules (Arrangement, Transport, AudioEngine, …). Default place for new product code.
- **`src/infra/`**, **`src/helpers/`**, **`src/utils/`**, **`src/shared/`** — cross-cutting infrastructure and utilities (not domain modules). Must not import from `src/modules/`.
- **`src-tauri/`** + workspace crates **`daw-core`**, **`daw-engine`**, **`daw-dsp`**, **`daw-io`** — thin Tauri bridge and RT/native audio. Commands live only in `src-tauri`.
- **`.agents/skills/`** — domain agent skills (architecture, web-audio, …).
- **`.agents/worktrees/<name>/`** — isolated git worktrees for parallel agent work (gitignored). Create with `git worktree add .agents/worktrees/<name> -b <branch>`. Operate only inside the assigned worktree; do not edit the main checkout for that work.

Checked-in product specs live under `.agents/specs/`; unnormalized source material lives under `.agents/specs/intake/`. Accepted decisions live under `.agents/decisions/`.

## Path aliases

| Alias | Source | Notes |
| ----- | ------ | ----- |
| `#/...` | `src/*` | Modules, infra, helpers, utils — e.g. `#/modules/Arrangement/useCases` |

Prefer `#/` for cross-module and cross-folder imports. Inside a module, use **relative** paths to the defining file (never that module’s own contract barrels).

## Layer boundaries

Hard gate via `pnpm deps:validate` (main **error** rules + causal reachability + types + tests cruises). New **error** edges fail; stale baseline rows fail when debt is retired. **Warn** rules stay visible without failing the gate.

- Cross-module imports target **only** contract-folder barrels: `useCases/`, `stores/`, `events/`, `presentations/views/` (each folder’s `index.ts`). No module-root `index.ts`. No deep imports into private folders (`models/`, `repositories/`, `handlers/`, `engine/`, …). (**error**)
- Same module: relative imports only — not `#/modules/<Self>/…`. (**error**)
- Direction: presentation → use cases → repositories / stores / services. Business/IO must not import `presentations/`. Only `useCases/` orchestrate `repositories/`. Repositories must not import business/event contracts or foreign stores; same-module stores remain an existing adapter pattern. Models, events, services, validators, and transformers stay pure. (**error**)
- Leaf `presentations/components/` and shared `src/components/`: no **direct** business-store or use-case imports (**error**, main cruise). No **transitive** reach of use cases (**error**, reachability cruise). Transitive store reach is **not** reachability-gated — still avoid via props/hooks (**policy**).
- Worklets stay isolated from app/helpers/Tauri. (**error**)
- **Tauri IPC only from `repositories/`** — policy; depcruise **`warn`** (`tauri-ipc-only-in-repositories`), not an error gate.
- Tests cruise: cross-module **barrel** + **no relative cross-module** for module tests, external tests, and global test setup (not the full production layer suite).

Deep module anatomy: [docs/architecture/03-typescript-module.md](./docs/architecture/03-typescript-module.md). Rust/Tauri: [docs/architecture/02-rust-backend.md](./docs/architecture/02-rust-backend.md).

## Tech stack

React 19 (Compiler), TypeScript, Vite, TanStack Query, vanilla `Store<T>` + `useStore`, React Hook Form + Zod, Vitest, Playwright (`pnpm test:e2e` local — **not** in CI health gates), Tauri 2, Rust audio crates (CPAL / RT paths).

## When a check blocks you

Checks are proxies for intent — never make one pass while its intent stays violated. Test: would the change be justified if the check didn't exist? Disable comments, `any` / unsafe casts, deleting or loosening tests, and editing checker configs or baselines are **evasion**, not fixes. Fix the cause or stop and report the blocking rule; blocked is acceptable, laundered green is not.

Do not use codemods, bulk `sed`/AST rewrites, or global formatters/`eslint --fix` across the tree unless the user explicitly asks. Edit files deliberately.

## Always-on rules

Agent must-follow subset of [docs/07-conventions.md](./docs/07-conventions.md) and architecture practice. **Hardness is not uniform** — hard gates, warn-only lint, and policy-only rules are labeled inline.

- **Contract barrels only cross-module.** (**error** via `deps:validate`) Up to four surfaces per module (`useCases`, `stores`, `events`, `presentations/views`) — create only those needed.
- **Stores are a public read contract.** Foreign modules may subscribe; they must not `store.set` (agent policy; ESLint `sourdaw/no-foreign-store-write` is **warn** only — CI `lint --quiet` ignores warns). Writes go through the owning module’s use cases or `executeAppAction`.
- **Use-case types stay private.** No `export type` from `useCases/index.ts` (**error** on type cruise). Consumers use `ReturnType` / `Parameters` or `events/` payloads. Models are never re-exported across modules — local shapes or intentional duplication.
- **One function per use-case and repository file** (house rule; ESLint `sourdaw/no-multiple-function-exports` is **warn** only). Handlers live under `handlers/` with `createHandler`; cross-module access only via `get<Module>Handlers` from `useCases/`. Presentation never imports raw handler maps.
- **Repositories touch metal; engine does not import repositories.** (**error**) I/O (Tauri, storage, audio setup) in `repositories/`; use cases orchestrate.
- **Async/server state:** TanStack Query — never `useEffect` for data fetching (**error** lint where configured). **Local form state:** RHF + Zod. **Local UI:** `useState` + Compiler. **Context:** only deeply local view state; prefer `use()` over `useContext` (convention; not eslint-hard).
- **React 19:** no `useMemo` / `useCallback` / `React.memo` (**error**); no `forwardRef` — `ref` is a prop (**error**). Prefer `cond ? <X /> : null` over render `&&` (**house**); leaky `&&` (e.g. `0 && …`) is **error** lint — boolean `&&` is not that rule.
- **Audio RT:** anything on the audio thread must not allocate, lock, or block. Prefer `AudioWorklet` + `AudioParam`; one live `AudioContext`. (**policy / review** — not CI-machine-gated)
- **TypeScript soundness:** types describe real data. No `any` except boundary + immediate narrowing (**error** in app; specs often **warn**). No `as any` / `as unknown as T` (**error** in app). Prefer not using bare `as T` to silence the checker (**policy**). No bare `@ts-expect-error` without a one-line reason (**error**). Prefer `unknown` + narrowing, `satisfies`, unions, `import type`, Zod at I/O (**policy**). Tests assert values/shape/errors — not just “defined” (**policy**).
- **Style (house):** prefer `type` over `interface`; `as const` over `enum`; named exports (no namespace imports); multi-arg module functions take one object param with `FunctionNameInput` / `FunctionNameOutput` adjacent to the function (convention); modules Capitalized; **filenames per `docs/07-conventions.md`** (PascalCase components/views/models; camelCase use cases/helpers — **not** repo-wide kebab-case); guard clauses + braced `if`; no chained ternaries.
- **Empirical proof:** failing reproduction before behaviour fixes; paste real command output for tests/typecheck/deps claims. Three failed fix attempts on the same approach → stop, reread contracts, change strategy.

## Safety (destructive actions)

- Do not delete, rename, or move files unless the task or user names them. Prefer targeted edits over full-file rewrites.
- Do not run destructive git (`reset --hard`, `clean`, force-push, discard, branch -D) or push/amend published history unless explicitly asked.
- Do not install/remove packages, edit CI/build config, or start long-lived background servers unless the task requires it.
- Stage only files you intentionally changed. When unsure whether an action is safe: stop and ask.
