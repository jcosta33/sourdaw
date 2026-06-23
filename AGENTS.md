# Sourdaw Web App - AI Agent Guidelines

This document provides the canonical instructions and architectural rules that YOU, the AI agent, MUST follow at all times. By existing in this file, these rules are permanently injected into your system prompt.

---

## Corpus workspace

Corpus workspace: `../sourdaw-hq` — read the task packet you are given before coding. Specs, audits, research, tasks, reviews, findings, decisions, and the board live there, not in this repo. This repo keeps only its domain skills (`.agents/skills/`) and worktree-local task scratch (`.agents/tasks/`).

---

## Documentation-first workflow

**Canonical process is Corpus.** Work is driven by a task packet from
`../sourdaw-hq/tasks/`, written against a spec in
`../sourdaw-hq/specs/<feature>/spec.md`; the loop (Pull → Spec → Task → Run →
Review → Close) and its guides live in the workspace (`../sourdaw-hq/AGENTS.md`
and `../sourdaw-hq/.agents/skills/` — `implement-task`, `write-spec`,
`review-output`, `save-findings`). The `docs/agents/*` references below capture the
documentation-first principles this repo follows; where they name
`.agents/specs|audits|research/` paths, those artifacts now live in the workspace
(see the directory map below), not in this repo.

Before starting significant implementation work, read the shared process documentation:

| Document                       | What it covers                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `docs/agents/01-process.md`    | Why documentation-first exists and the five document types                                                                |
| `docs/agents/02-file-types.md` | Definitions, required sections, and completion criteria for each type                                                     |
| `docs/agents/03-workflow.md`   | Step-by-step execution flow for agent sessions                                                                            |
| `docs/agents/04-standards.md`  | Writing quality for specs/audits/tasks; task focus vs opportunistic fixes (not TypeScript — see `docs/07-conventions.md`) |
| `docs/07-conventions.md`       | Coding patterns for humans; **TypeScript soundness** is canonical in **`AGENTS.md`** (see § TypeScript — soundness there) |
| `docs/06-testing.md`           | Vitest layout (`__tests__/` folders), mocks, DI in tests                                                                  |
| `../sourdaw-hq/templates/`     | Ready-to-use Corpus artifact templates (specs, tasks, reviews, etc.)                                                      |

Working artifacts live in the Corpus workspace (`../sourdaw-hq`), except the domain
skills and worktree task scratch that stay in this repo:

| Directory                        | Contains                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| `../sourdaw-hq/status.md`        | The board — one state row per feature                                    |
| `../sourdaw-hq/specs/<feature>/` | `spec.md` (AC-NNN + Verify with:), co-located `audit.md` / `research.md` |
| `../sourdaw-hq/inventory/`       | Brownfield module-state maps (observation-only)                          |
| `../sourdaw-hq/intake/`          | Captured umbrella sources and deferred-gap items                         |
| `../sourdaw-hq/tasks/`           | Task packets — the unit of agent work                                    |
| `../sourdaw-hq/reviews/`         | Review packets — the durable record of each task                         |
| `../sourdaw-hq/findings/`        | Lessons saved at Close                                                   |
| `../sourdaw-hq/decisions/`       | ADRs — numbered, immutable                                               |
| `.agents/skills/`                | Reusable domain knowledge — load before working in a domain              |
| `.agents/tasks/`                 | Worktree-local task scratch (gitignored)                                 |

**Before implementing any non-trivial feature, run this checklist in order. Do not skip steps.**

1. Read the task packet you were given in `../sourdaw-hq/tasks/` and the spec it links (`../sourdaw-hq/specs/<feature>/spec.md`) — follow its scope. Load the workspace guide `../sourdaw-hq/.agents/skills/implement-task/SKILL.md`.
2. Track session state in your worktree task scratch (`.agents/tasks/`): fill in **Objective** and **Plan** before doing anything else.
3. Read the spec and any co-located `audit.md` / `research.md` under `../sourdaw-hq/specs/<feature>/`. If no spec exists for non-trivial work, stop — a spec is authored in the workspace first (guide: `../sourdaw-hq/.agents/skills/write-spec/SKILL.md`).
4. Read the module's brownfield map in `../sourdaw-hq/inventory/<Module>.md` for present-state context before refactoring; check `../sourdaw-hq/intake/` for captured sources and deferred-gap items relevant to the feature.
5. Load every relevant domain skill from `.agents/skills/` by reading the `description` field at the top of each `SKILL.md`. Read in full any skill whose description matches the domain you're about to touch.
6. Run every item under the task's `## Verify` and paste the real command output — a claim without output counts as unverified. Save durable lessons at Close to `../sourdaw-hq/findings/`.

**Session completion — Self-review is mandatory.** Every task file has a `## Self-review` section with specific questions and a `### Verification outputs` block. A task is not complete until every question has a written answer directly beneath it, including pasted command output (`git status`, `pnpm deps:validate`, `pnpm typecheck`, etc.). Task files do not use a separate Handoff section — they are self-contained. Use **Decisions**, **Findings**, **Next steps**, and related sections so the file stands alone for the next reader. Declaring the task done while any Self-review question is unanswered is an invalid session output. Checkboxes alone do not count — the review must leave a written trace in the task file.

Agent sandboxes (isolated worktrees) and task delegation are owned by the Corpus
workspace (`../sourdaw-hq`) + Claude Code. The pre-Corpus in-repo `agents:*` launcher
has been retired.

---

## 📋 Your task file (worktree sessions only)

This section only applies in a Corpus worktree session (an isolated worktree spun up for parallel work). In a regular session, `.agents/tasks/` will be empty and you can ignore this entirely.

If `.agents/tasks/` contains a file, that is **your** task file for this session — its filename is the session slug. Read it before doing anything else. It contains your spec reference, objective, plan, and checklist.

- Fill in **Objective** before doing anything else.
- Fill in **Linked docs** with every spec, audit, and skill you loaded.
- Check off the **Progress checklist** steps as you complete them.
- Log **Decisions** and **Findings** as they emerge — these are how the next reader understands what you did and why.
- Complete `## Self-review` before ending the session: every question answered, every verification command's output pasted in.

---

## 🧠 Agent Autonomy & Engineering Mindset

You are a proactive, cognizant software engineer. Formulate your own paths to success within the established architecture. To scale autonomous work, you must transition from simple task execution to exhaustive self-validation.

- **Force Empirical Proof (Show, Don't Tell):** Mistrust your own code. Never declare a task complete without empirical verification. Always write a failing test or reproduction script _before_ touching application code. Paste actual console output (tests, linters, builds) to prove success.
- **Blast Radius Awareness:** Trace upstream callers and downstream dependencies before modifying code. Rely on the TypeScript compiler (`pnpm typecheck`) to exhaustively navigate the blast radius.
- **Behavioral Invariants (Holistic Evaluation):** Evaluate the entire application state. Implement error boundaries, fallback UIs, and graceful degradation. Assume everything that can fail will fail. No "happy path only" coding.
- **Institutionalize Strategic Backtracking (The Three Strikes Rule):** If you attempt to fix a compilation or test error 3 times and fail, **stop**. Discard your current approach, reread the overarching spec, and formulate a fundamentally different strategy to break hallucination loops.
- **Proactive Research:** Do not guess. Aggressively use search tools (`grep_search`, `glob`) and internet research to confirm hypotheses.
- **Incremental Commits:** Commit every major change or logical checkpoint as you work. This creates a clear history that a reviewing Lead Engineer (or human) can easily follow. Do not wait until the very end of the session to make one giant commit.
- **Ceaseless Examination:** Verify your path delivers on specifications. Pursue intuitions only when backed by extensive research.
- **Systems Thinking & Architecture First:** Respect Domain-Driven Design (DDD), established boundaries, and module contracts.
- **User-Centric Perspective:** Evaluate features top-to-bottom. Build coherent, complete, and genuinely useful UX.

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

- **Contract Boundaries:** Cross-module imports MUST target one of the destination module’s **contract-folder barrels** — `#/modules/<M>/useCases`, `#/modules/<M>/stores`, `#/modules/<M>/events`, or `#/modules/<M>/presentations/views` (each resolves to that folder’s `index.ts`). Example: `import { addTrack } from '#/modules/Arrangement/useCases';`. There is **no module-root `index.ts`** — it is retired; importing the bare root `#/modules/<M>` is unresolvable and fails `cross-module-index-only` + tsgo. Deep imports into a contract folder’s files (e.g. `#/modules/<M>/useCases/addTrack`) or any private path are forbidden.
- **Same module — relative imports:** Files under `src/modules/<Name>/` MUST NOT import from their own contract barrels (`#/modules/<Name>/useCases`, `#/modules/<Name>/stores`, etc.). Use **relative** paths to the defining file (`../stores/…`, `./useCases/…`, `../../models/…`, etc.). Contract barrels are for **other** modules; they are not an indirection layer for intra-module code.
- **Index exports — external consumers only:** Re-export from a contract-folder `index.ts` only what **another module** may import, and only from that folder’s own files. Do not add re-exports so that files inside the same module can reach an API via a barrel — those call sites use relative imports instead.
- **Private Internals:** `handlers/`, `models/`, `repositories/`, `engine/`, `transformers/`, `services/`, `validators/`, `presentations/hooks/`, and `presentations/components/` are STRICTLY PRIVATE to their module — never importable cross-module (`cross-module-index-only`; models, repositories, and transformers are additionally barred from any barrel by `no-models-repos-transformers-in-index`).
- **Services layer (`services/`):** Pure, stateless helpers that operate on domain types within one module. They do NOT touch I/O (that's `repositories/`), do NOT mutate stores (that's `useCases/` or `handlers/`), and do NOT hold orchestration logic (that's `useCases/`). Typical residents: fuzzy-match / subsequence search, lookup tables, encoder/decoder helpers, pure algorithm implementations, registries that depend only on domain types. Services can be imported by `useCases/`, `handlers/`, `repositories/`, `engine/`, and other services in the **same** module. They are STRICTLY PRIVATE to their module (no cross-module import) — if another module needs the same helper, it defines its own copy or the helper moves to `#/utils/`.
- **Command handlers (non-contract):** `AppAction` → `ActionHandler` maps live under **`handlers/`** (or legacy `useCases/*Handlers.ts` until migrated). They are **not** re-exported from any contract barrel. Each entry is built in that handler file with **`createHandler`** from **`#/helpers/createHandler`**. Aggregate handler maps (e.g. `clipHandlers.ts`) spread those exports — **`get<Module>Handlers`** only merges pre-built maps and does not call `createHandler`. Cross-module access is **only** via **`get<Module>Handlers`** in `useCases/` (one function per file), re-exported from the `useCases/index.ts` barrel for Command. Presentation uses **`executeAppAction`** or granular use cases — never raw handler maps.
- **Barrel files:** The only `index.ts` barrels are the four **contract-folder** barrels — `useCases/index.ts`, `events/index.ts`, `stores/index.ts`, and `presentations/views/index.ts`. There is no module-root `index.ts`. Do not add other bulk re-export files (`contracts.ts`, an aggregating `<module>/index.ts`, etc.). Each contract barrel is the **cross-module** public surface for its folder and may **only** re-export from files **within its own folder** (`useCases/index.ts` re-exports from `useCases/`, never from `stores/` or `models/`) — a curated list for **external** consumers, not a dump of internals (`contract-barrel-scope`). From `useCases/`, re-export **runtime values** (functions, constants) only — not `export type` (see **Use-case types stay private** below).
- **Model isolation:** Models (`models/`) are strictly private to their owning module and must never be exported or re-exported across module boundaries — not even through `useCases/` (`cross-module-index-only` + `no-models-repos-transformers-in-index`). If module B needs data shaped like module A's model, module B defines its own local type containing only the fields it uses. Duplication is intentional: changes to module A's model must never cascade to module B. When a use-case contract changes, callers break at compile time — that is the correct signal. A shared model import would hide it.
- **Use-case types stay private:** Do not `export type` from `useCases/` for other modules — the `useCases/index.ts` barrel re-exports functions and constants only (`no-usecase-type-exports-on-index`). Other modules must not `import type { … }` from another module’s use-case surface. Use cases may use internal `type` / `interface` for implementation, but each consumer module keeps its own exported/local types and may use `ReturnType<typeof fn>` or `Parameters<typeof fn>` when calling an imported function. **Exception:** typed payloads in `events/` are the canonical cross-module type surface, exported via `events/index.ts` (event contract).
- **One Function Per File:** Every `useCase` and `repository` file must export exactly ONE function.
- **Repositories Touch Metal:** All I/O (Tauri IPC, Storage, Web Audio) goes in `repositories/`. Use cases orchestrate repositories.
- **Engine Rules:** The audio engine (`engine/`) CANNOT import repositories directly — within a module only `useCases/` may orchestrate `repositories/` (`usecases-only-write-boundary-to-repositories`). Inject dependencies or resolve them via the use case layer.

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

## ⚛️ React 19 & UI Conventions

- **No manual memoization.** Do NOT use `useMemo`, `useCallback`, or `React.memo` — the React Compiler handles memoization for the entire app. Hand-written memoization fights the compiler and is treated as a code-review reject.
- **No `forwardRef`.** In React 19, `ref` is a regular prop. Accept it directly in the component's props type.
- **Never render with `&&`.** Use a ternary (`cond ? <X /> : null`) or an early `return null` / guard clause. `&&` silently renders `0`, `''`, or `NaN` and breaks lists.
- **Audio-thread code is real-time.** Anything that runs on the audio thread MUST NOT allocate, lock mutexes, take locks, or block. See `🦀 Backend Rust Tauri Architecture` above and the `web-audio-engine` skill for the full rules.

## 📝 Backend CLI & Coding Conventions

- **Module Naming:** Modules MUST be Capitalized (e.g., `Workspace`, `Terminal`, `TaskManagement`).
- **File Naming:** Filenames MUST use kebab-case (e.g., `download-levain-samples.ts`, `generate-view-tests.ts`).
- **Variable/Function Naming:** Variables and functions MUST use snake_case (worm case) (e.g., `my_variable`, `run_command()`). Do NOT use camelCase.
- **Control Flow:** All `if` statements must use block syntax `{}`. Guard clauses / early returns ONLY. No chained ternaries.
- **TypeScript Forms:** Prefer `type` over `interface`. Prefer `as const` objects over `enum`. Use explicit type-only imports (`import { type MyType }`).
- **TypeScript — soundness:** Types must describe real data. **Forbidden:** `any` except at a boundary (e.g. external payload) with **immediate** narrowing — never as a permanent “whatever” type; `as`, `as any`, or `as unknown as …` to silence compiler errors instead of fixing the value or the type; `@ts-expect-error` / `@ts-ignore` without a one-line justification and a path to remove it; `{}`, unconstrained `object`, or `Record<string, …>` as a stand-in for a domain model when a concrete shape or discriminated union exists; optional fields used to encode mutually exclusive states. **Tests:** Do not stop at “defined” / “truthy” / generic `toBeTypeOf('object')` — assert the actual contract (values, shape, or error text). **Prefer:** `unknown` + narrowing, `satisfies`, discriminated unions, `import type`, and runtime validation at I/O boundaries (e.g. Zod).
- **Imports:** Never use namespace imports (`import * as X from '...'`). Always import named exports individually.
- **Naming Constraints:** No prefixes or suffixes that are entity-type names (e.g. `thing_repository`, `thing_use_case`, `repositories_thing`). No single-letter variable names or single-letter generic type parameters — use descriptive names.
- **Function Signatures:** Functions with more than one parameter take a single object param. For module-level functions, the input type is named `FunctionNameInput` and the output type (if non-scalar) is named `FunctionNameOutput`; both are defined immediately above the function they belong to — not grouped at the top of the file. For class methods, use an inline object type directly in the parameter instead of a named type. If the output is a `Promise`, declare `type FunctionNameOutput = Promise<...>` — do NOT write `Promise<FunctionNameOutput>` at the function signature level.
