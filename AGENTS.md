# Sourdaw Web App — Agent Guidelines

Tool-neutral guidance for AI coding agents (Cursor, Codex CLI, Windsurf, Cline, Copilot Coding Agent, Claude Code). `CLAUDE.md` is a symlink to this file.

## Checks

See `package.json` for all scripts.

- **Tests:** `pnpm test:run <path/to/file.spec.ts>` — always pass a file (or narrow path). `pnpm test` is watch mode; do not use it for verification. See `docs/06-testing.md`.
- **Lint:** `pnpm exec eslint <path/to/file.ts>` — always specify the touched files. Do not run whole-tree `pnpm lint` unless the task is a repo-wide lint pass.
- **Type check:** `pnpm typecheck`
- **Module boundaries:** `pnpm deps:validate` (main cruise + reachability edge gate + type-edge cruise + test-inclusive cruise)

After cross-module moves or bulk import changes, re-run `pnpm deps:validate` before claiming done (at least every ~10 files during large refactors).

## Codebase layout

- **`src/modules/`** — DDD domain modules (Arrangement, Transport, AudioEngine, …). Default place for new product code.
- **`src/infra/`**, **`src/helpers/`**, **`src/utils/`**, **`src/shared/`** — cross-cutting infrastructure and utilities (not domain modules). Must not import from `src/modules/`.
- **`src-tauri/`** + workspace crates **`daw-core`**, **`daw-engine`**, **`daw-dsp`**, **`daw-io`** — thin Tauri bridge and RT/native audio. Commands live only in `src-tauri`.
- **`.agents/skills/`** — domain agent skills (architecture, web-audio, …). Load when the description matches the work.
- **`.agents/worktrees/<name>/`** — isolated git worktrees for parallel agent work (gitignored). Create with `git worktree add .agents/worktrees/<name> -b <branch>`. Operate only inside the assigned worktree; do not edit the main checkout for that work.

Checked-in product specs (when present) live under `specs/`. Transient task/review scratch stays outside the repo or under gitignored `.agents/tasks/` unless the task names a checked-in path.

## Path aliases

| Alias | Source | Notes |
| ----- | ------ | ----- |
| `#/...` | `src/*` | Modules, infra, helpers, utils — e.g. `#/modules/Arrangement/useCases` |

Prefer `#/` for cross-module and cross-folder imports. Inside a module, use **relative** paths to the defining file (never that module’s own contract barrels).

## Layer boundaries

Enforced by [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) (`pnpm deps:validate`):

- Cross-module imports target **only** contract-folder barrels: `useCases/`, `stores/`, `events/`, `presentations/views/` (each folder’s `index.ts`). No module-root `index.ts`. No deep imports into private folders (`models/`, `repositories/`, `handlers/`, `engine/`, …).
- Same module: relative imports only — not `#/modules/<Self>/…`.
- Direction: presentation → use cases → repositories / stores / services. Business/IO must not import `presentations/`. Only `useCases/` orchestrate `repositories/`. Repositories must not import use cases/handlers/presentations. Models and events stay pure.
- Leaf `presentations/components/` must not import business stores or use cases (including transitively). Tauri IPC only from `repositories/`. Worklets stay isolated from app/helpers/Tauri.
- Tests are in the graph (`pnpm deps:validate` tests cruise): specs follow the same barrel rules as production.

Deep module anatomy: [docs/architecture/03-typescript-module.md](./docs/architecture/03-typescript-module.md). Rust/Tauri: [docs/architecture/02-rust-backend.md](./docs/architecture/02-rust-backend.md).

## Tech stack

React 19 (Compiler), TypeScript, Vite, TanStack Query, vanilla `Store<T>` + `useStore`, React Hook Form + Zod, Vitest, Playwright (CI E2E), Tauri 2, Rust audio crates (CPAL / RT paths).

## When a check blocks you

Checks are proxies for intent — never make one pass while its intent stays violated. Test: would the change be justified if the check didn't exist? Disable comments, `any` / unsafe casts, deleting or loosening tests, and editing checker configs or baselines are **evasion**, not fixes. Fix the cause or stop and report the blocking rule; blocked is acceptable, laundered green is not.

Do not use codemods, bulk `sed`/AST rewrites, or global formatters/`eslint --fix` across the tree unless the user explicitly asks. Edit files deliberately.

## Always-on rules

The must-follow subset of [docs/07-conventions.md](./docs/07-conventions.md) and architecture practice. Rules the tooling already enforces strongly are abbreviated here; these are the ones agents still get wrong without a reminder:

- **Contract barrels only cross-module.** Up to four surfaces per module (`useCases`, `stores`, `events`, `presentations/views`) — create only those needed. Run `pnpm deps:validate` after boundary work.
- **Stores are a public read contract.** Foreign modules may subscribe; they must not `store.set`. Writes go through the owning module’s use cases or `executeAppAction`.
- **Use-case types stay private.** No `export type` from `useCases/index.ts`. Consumers use `ReturnType` / `Parameters` or `events/` payloads. Models are never re-exported across modules — local shapes or intentional duplication.
- **One function per use-case and repository file.** Handlers live under `handlers/` with `createHandler`; cross-module access only via `get<Module>Handlers` from `useCases/`. Presentation never imports raw handler maps.
- **Repositories touch metal; engine does not import repositories.** I/O (Tauri, storage, audio setup) in `repositories/`; use cases orchestrate.
- **Async/server state:** TanStack Query — never `useEffect` for fetching. **Local form state:** RHF + Zod. **Local UI:** `useState` + Compiler. **Context:** only deeply local view state; consume with `use()`, not `useContext`.
- **React 19:** no `useMemo` / `useCallback` / `React.memo`; no `forwardRef` (`ref` is a prop); never render with `&&` — use `cond ? <X /> : null` or early return.
- **Audio RT:** anything on the audio thread must not allocate, lock, or block. Prefer `AudioWorklet` + `AudioParam`; one live `AudioContext`.
- **TypeScript soundness:** types describe real data. No `any` except at a boundary with immediate narrowing; no `as` / `as any` / `as unknown as` to silence errors; no bare `@ts-expect-error` without a one-line reason and removal path. Prefer `unknown` + narrowing, `satisfies`, discriminated unions, `import type`, Zod at I/O edges. Tests assert values/shape/errors — not just “defined”.
- **Style (house):** prefer `type` over `interface`; `as const` over `enum`; named exports (no namespace imports); multi-arg module functions take one object param with `FunctionNameInput` / `FunctionNameOutput` adjacent to the function; modules Capitalized; source files kebab-case; guard clauses + braced `if`; no chained ternaries.
- **Empirical proof:** failing reproduction before behaviour fixes; paste real command output for tests/typecheck/deps claims. Three failed fix attempts on the same approach → stop, reread contracts, change strategy.

## Safety (destructive actions)

- Do not delete, rename, or move files unless the task or user names them. Prefer targeted edits over full-file rewrites.
- Do not run destructive git (`reset --hard`, `clean`, force-push, discard, branch -D) or push/amend published history unless explicitly asked.
- Do not install/remove packages, edit CI/build config, or start long-lived background servers unless the task requires it.
- Stage only files you intentionally changed. When unsure whether an action is safe: stop and ask.
