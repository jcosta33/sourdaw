# Sourdaw Web App - AI Agent Guidelines

This document provides the canonical instructions and architectural rules that YOU, the AI agent, MUST follow at all times. By existing in this file, these rules are permanently injected into your system prompt.

---

## Documentation-first workflow

Before starting significant implementation work, read the shared process documentation:

| Document                       | What it covers                                                        |
| ------------------------------ | --------------------------------------------------------------------- |
| `docs/agents/01-process.md`    | Why documentation-first exists and the five document types            |
| `docs/agents/02-file-types.md` | Definitions, required sections, and completion criteria for each type |
| `docs/agents/03-workflow.md`   | Step-by-step execution flow for agent sessions                        |
| `docs/agents/04-standards.md`  | Writing quality for specs/audits/tasks; task focus vs opportunistic fixes (not TypeScript — see `docs/07-conventions.md`) |
| `docs/07-conventions.md`       | Coding patterns for humans; **TypeScript soundness** is canonical in **`AGENTS.md`** (see § TypeScript — soundness there) |
| `docs/06-testing.md`           | Vitest layout (`__tests__/` folders), mocks, DI in tests                   |
| `agents/templates/`            | Ready-to-use templates: `audit.md`, `spec.md`, `task.md`              |

Working artifacts for this repo live in:

| Directory           | Contains                                                    |
| ------------------- | ----------------------------------------------------------- |
| `.agents/audits/`   | Codebase state reports relative to a goal                   |
| `.agents/specs/`    | Feature specs, requirements, acceptance criteria            |
| `.agents/research/` | Technical findings from external sources                    |
| `.agents/skills/`   | Reusable domain knowledge — load before working in a domain |
| `.agents/tasks/`    | Active work items (gitignored, worktree-specific)           |

**Before implementing any non-trivial feature:** load `.agents/skills/documentation-gatekeeper/SKILL.md` — it encodes the sequencing invariants for this repo. Then check `.agents/specs/` for an existing spec and `.agents/audits/` for an existing audit of the area. Read relevant domain skills from `.agents/skills/` before touching their domains. Do not skip this step.

**Session completion — Self-review is mandatory.** Every task file has a `## Self-review` section with specific questions and a `### Verification outputs` block. A task is not complete until every question has a written answer directly beneath it, including pasted command output (`git status`, `pnpm deps:validate`, `pnpm typecheck`, etc.). Task files do not use a separate Handoff section — they are self-contained. Declaring the task done while any Self-review question is unanswered is an invalid session output. Checkboxes alone do not count — the review must leave a written trace in the task file.

Agent sandboxes (isolated worktrees) are managed by `docs/08-agents.md` — the launcher tool built into this repo.

---

## 🚨 MANDATORY REFLEX RULE (THE "SHOCK COLLAR")

When asked to perform cross-module refactoring, move files, or update imports across multiple files:

1. **You MUST run `pnpm deps:validate` constantly.** Run it after touching every 10 files.
2. You are **STRICTLY FORBIDDEN** from proceeding or declaring a task "done" until this validation passes with 0 zero architectural violations.
3. **NEVER use code mods** or AST-altering scripts to run refactors unless explicitly instructed by the user. Do the work manually, but validate it constantly.

## 🔒 SAFETY RULES — READ BEFORE TOUCHING ANYTHING

> **Why these exist:** You are running in bypass-permissions mode. There are no confirmation prompts. Every action you take is immediate and irreversible. These rules exist to prevent you from causing damage that cannot be undone by a simple undo.

### File system — what you may NOT do without explicit instruction

- **Do not delete any file.** Not source files, not config files, not generated files, not "obviously unused" files. If you believe a file should be deleted, note it in your task file and surface it as a finding. Deletion requires an explicit human instruction naming the file.
- **Do not rename or move files** unless the spec or task you are executing explicitly calls for it by name.
- **Do not overwrite a file with a full rewrite** when a targeted edit will do. Prefer Edit over Write for existing files.
- **Do not create new files outside your assigned scope.** If something new needs to exist outside the modules you own, surface it as a handoff item.

### Git — what you may NOT do

- **Do not run destructive git commands:** `git reset --hard`, `git clean`, `git push --force`, `git branch -D`, `git checkout -- .`, `git restore .`, or any command that discards uncommitted work.
- **Do not commit unrelated files.** Stage only the files you intentionally changed.
- **Do not amend published commits** or rebase commits that have already been pushed.
- **Do not push to any remote** unless the task explicitly says to.
- **Do not operate outside your worktree.** You are in an isolated git worktree on your own branch. Do not `cd` to the main repo or another worktree and make changes there.

### Commands — what you may NOT run

- **Do not run commands that alter source code automatically** — no codemods, no code formatters applied globally, no linters in `--fix` mode across the whole codebase.
- **Do not install or remove packages** (`npm install <pkg>`, `pnpm add`, `cargo add`, etc.) unless explicitly asked. Dependency changes affect every developer and require intentional review.
- **Do not modify `package.json` scripts, CI/CD files (`.github/`), or build configuration** unless it is the explicit subject of your task.
- **Do not start long-running background processes** (dev servers, watchers, daemons) that will outlive your session.
- **Do not run commands that require network access** to external services unless you are explicitly fetching a documented dependency.

### When in doubt

If you are unsure whether an action is safe: **do not take it.** Log it as an open question in your task file. The cost of pausing is zero. The cost of irreversible damage is high.

---

## 🚫 NO AUTOMATED CODE MUTATIONS — ABSOLUTE RULE

**You are STRICTLY FORBIDDEN from using any automated process to modify, rename, or move source files.** This applies unconditionally — no exceptions, no "just this once", regardless of how many files are involved.

Prohibited tools and techniques include, but are not limited to:

- Codemods (jscodeshift, ts-morph, ast-grep, or any AST-based script)
- Shell loops or scripts that batch-edit files (e.g. `for f in ...; do sed ... done`)
- `sed`, `awk`, `perl -pi`, or any command-line find-and-replace run across multiple files
- Automated file renaming or moving via scripts (`mv`, `rename`, `find -exec mv`)
- Any custom script written in this session for the purpose of bulk-editing files

**Every file change must be made individually, deliberately, using the Edit or Write tools.** If the scope of manual edits feels impractical, surface that as a blocker and discuss with the user — do not reach for automation as a shortcut.

## 🏛️ Frontend Domain-Driven Architecture

- **Contract Boundaries:** Cross-module imports MUST only target the destination module’s root **`index.ts`** (e.g. `#/modules/Arrangement`). Deep imports into `useCases/`, `events/`, `stores/`, `presentations/views/`, or any other path from outside the module are forbidden.
- **Same module — relative imports:** Files under `src/modules/<Name>/` MUST NOT import from **`#/modules/<Name>`** (their own barrel). Use **relative** paths to the defining file (`../stores/…`, `./useCases/…`, `../../models/…`, etc.). The root `index.ts` is for **other** modules; it is not an indirection layer for intra-module code.
- **Index exports — external consumers only:** Re-export from `index.ts` only what **another module** may import. Do not add re-exports so that files inside the same module can reach an API via the barrel — those call sites use relative imports instead.
- **Private Internals:** `handlers/`, `models/`, `repositories/`, `engine/`, `transformers/`, `services/`, `presentations/hooks/`, and `presentations/components/` are STRICTLY PRIVATE to their module. (`no-cross-module-internals` and `models-private-cross` rules).
- **Services layer (`services/`):** Pure, stateless helpers that operate on domain types within one module. They do NOT touch I/O (that's `repositories/`), do NOT mutate stores (that's `useCases/` or `handlers/`), and do NOT hold orchestration logic (that's `useCases/`). Typical residents: fuzzy-match / subsequence search, lookup tables, encoder/decoder helpers, pure algorithm implementations, registries that depend only on domain types. Services can be imported by `useCases/`, `handlers/`, `repositories/`, `engine/`, and other services in the **same** module. They are STRICTLY PRIVATE to their module (no cross-module import) — if another module needs the same helper, it defines its own copy or the helper moves to `#/utils/`.
- **Command handlers (non-contract):** `AppAction` → `ActionHandler` maps live under **`handlers/`** (or legacy `useCases/*Handlers.ts` until migrated). They are **not** re-exported from the module `index.ts`. Each entry is built in that handler file with **`createHandler`** from **`#/helpers/createHandler`**. Aggregate handler maps (e.g. `clipHandlers.ts`) spread those exports — **`get<Module>Handlers`** only merges pre-built maps and does not call `createHandler`. Cross-module access is **only** via **`get<Module>Handlers`** in `useCases/` (one function per file), re-exported from `index.ts` for Command. Presentation uses **`executeAppAction`** or granular use cases — never raw handler maps.
- **Barrel files:** Do not add `index.ts` barrels, `contracts.ts`, or other bulk re-export files **except** each module’s **root** `index.ts`. That file is the sole **cross-module** public surface and may **only** re-export from `useCases/`, `events/`, `stores/`, and `presentations/views/` — a curated list for **external** consumers, not a dump of internals. From `useCases/`, re-export **runtime values** (functions, constants) only — not `export type` (see **Use-case types stay private** below).
- **Model isolation:** Models (`models/`) are strictly private to their owning module and must never be exported or re-exported across module boundaries — not even through `useCases/`. If module B needs data shaped like module A's model, module B defines its own local type containing only the fields it uses. Duplication is intentional: changes to module A's model must never cascade to module B. When a use-case contract changes, callers break at compile time — that is the correct signal. A shared model import would hide it.
- **Use-case types stay private:** Do not `export type` from `useCases/` for other modules, and do not re-export use-case types from a module’s root `index.ts`. Other modules must not `import type { … }` from another module’s use-case surface. Use cases may use internal `type` / `interface` for implementation, but each consumer module keeps its own exported/local types and may use `ReturnType<typeof fn>` or `Parameters<typeof fn>` when calling an imported function. **Exception:** typed payloads in `events/` may still be exported via `index.ts` (event contract).
- **One Function Per File:** Every `useCase` and `repository` file must export exactly ONE function.
- **Repositories Touch Metal:** All I/O (Tauri IPC, Storage, Web Audio) goes in `repositories/`. Use cases orchestrate repositories.
- **Engine Rules:** The audio engine (`engine/`) CANNOT import repositories directly (`repositories-only-from-usecases`). Inject dependencies or resolve them via the use case layer.

## 🦀 Backend Rust Tauri Architecture

- **5 Crate Workspace:** Features 5 crates: `daw-core` (zero-dependency types/newtypes), `daw-engine` (RT Audio, CPAL), `daw-dsp` (Pure Math), `daw-io` (Tauri-free I/O), and `src-tauri` (Thin bridge).
- **Audio RT Safety:** The audio thread must NEVER allocate, lock mutexes, or block. Use Lock-free ring buffers (`rtrb`) and atomic types.
- **Compiled Schedule:** Non-RT graph builds a flat `Vec<ProcessTask>`, passes it to the RT thread via Ring Buffer for contiguous cache-local iteration.
- **Typesync:** Ensure all Tauri state and models use `serde(transparent)` for single-value newtypes and generate TypeScript via `tauri-specta`.
- **Commands:** ALL `#[tauri::command]` functions live exclusively in `src-tauri`.

## 🧪 State Management

- **Async/Server State:** Use **TanStack Query** (`useSuspenseQuery`, `useQuery`). Never use `useEffect` for data fetching.
- **Cross-Domain UI State:** Use Vanilla `Store<T>` instances (in `stores/`). Business logic interacts directly with the Store instance. React connects via `useStore` from `#/infra/store/useStore`.
- **Local Form/Settings:** Use React Hook Form + Zod.
- **Local Primitive State:** Use `useState` + React Compiler.
- **Context:** Used ONLY for deeply local view state (e.g. collapsing a panel). Consume Context using `use()` instead of `useContext`.

## 📝 React 19 & Coding Conventions

- **The React Compiler is ACTIVE:** Do NOT manually invoke `useMemo`, `useCallback`, or `React.memo`. The compiler handles memoization perfectly. Write plain code.
- **Refs:** `ref` is a regular prop in React 19. Do NOT use `forwardRef`.
- **Conditional Rendering:** Never use `&&` for rendering (it leaks 0 and false). Use complete ternaries `? :` or explicit early returns.
- **Control Flow:** All `if` statements must use block syntax `{}`. Guard clauses / early returns ONLY. No chained ternaries.
- **TypeScript Forms:** Prefer `type` over `interface`. Prefer `as const` objects over `enum`. Use explicit type-only imports (`import { type MyType }`).
- **TypeScript — soundness:** Types must describe real data. **Forbidden:** `any` except at a boundary (e.g. external payload) with **immediate** narrowing — never as a permanent “whatever” type; `as`, `as any`, or `as unknown as …` to silence compiler errors instead of fixing the value or the type; `@ts-expect-error` / `@ts-ignore` without a one-line justification and a path to remove it; `{}`, unconstrained `object`, or `Record<string, …>` as a stand-in for a domain model when a concrete shape or discriminated union exists; optional fields used to encode mutually exclusive states. **Tests:** Do not stop at “defined” / “truthy” / generic `toBeTypeOf('object')` — assert the actual contract (values, shape, or error text). **Prefer:** `unknown` + narrowing, `satisfies`, discriminated unions, `import type`, and runtime validation at I/O boundaries (e.g. Zod).
- **Imports:** Never use namespace imports (`import * as X from '...'`). Always import named exports individually.
- **Naming:** No prefixes or suffixes that are entity-type names (e.g. `thingRepository`, `thingUseCase`, `repositoriesThing`). No single-letter variable names or single-letter generic type parameters — use descriptive names.
- **Function Signatures:** Functions with more than one parameter take a single object param. For module-level functions, the input type is named `FunctionNameInput` and the output type (if non-scalar) is named `FunctionNameOutput`; both are defined immediately above the function they belong to — not grouped at the top of the file. For class methods, use an inline object type directly in the parameter instead of a named type. If the output is a `Promise`, declare `type FunctionNameOutput = Promise<...>` — do NOT write `Promise<FunctionNameOutput>` at the function signature level.
- **Styling:** Exclusively use Tailwind V4 classes via `@theme` variables (e.g., `text-[var(--color-accent-orange)]` or standard tokens). No custom CSS outside `main.css`.
