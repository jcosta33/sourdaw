# Sourdaw Web App - AI Agent Guidelines

This document provides the canonical instructions and architectural rules that YOU, the AI agent, MUST follow at all times. By existing in this file, these rules are permanently injected into your system prompt.

---

## Documentation-first workflow

Before starting significant implementation work, read the shared process documentation:

| Document | What it covers |
|---|---|
| `docs/agents/01-process.md` | Why documentation-first exists and the five document types |
| `docs/agents/02-file-types.md` | Definitions, required sections, and completion criteria for each type |
| `docs/agents/03-workflow.md` | Step-by-step execution flow for agent sessions |
| `docs/agents/04-standards.md` | Writing quality, citation, certainty, and scope rules |
| `agents/templates/` | Ready-to-use templates: `audit.md`, `spec.md`, `task.md` |

Working artifacts for this repo live in:

| Directory | Contains |
|---|---|
| `.agents/audits/` | Codebase state reports relative to a goal |
| `.agents/specs/` | Feature specs, requirements, acceptance criteria |
| `.agents/research/` | Technical findings from external sources |
| `.agents/skills/` | Reusable domain knowledge — load before working in a domain |
| `.agents/tasks/` | Active work items (gitignored, worktree-specific) |

**Before implementing any non-trivial feature:** load `.agents/skills/documentation-gatekeeper/SKILL.md` — it encodes the sequencing invariants for this repo. Then check `.agents/specs/` for an existing spec and `.agents/audits/` for an existing audit of the area. Read relevant domain skills from `.agents/skills/` before touching their domains. Do not skip this step.

Agent sandboxes (isolated worktrees) are managed by `docs/08-agents.md` — the launcher tool built into this repo.

---

## 🚨 MANDATORY REFLEX RULE (THE "SHOCK COLLAR")

When asked to perform cross-module refactoring, move files, or update imports across multiple files:

1. **You MUST run `pnpm deps:validate` constantly.** Run it after touching every 10 files.
2. You are **STRICTLY FORBIDDEN** from proceeding or declaring a task "done" until this validation passes with 0 zero architectural violations.
3. **NEVER use code mods** or AST-altering scripts to run refactors unless explicitly instructed by the user. Do the work manually, but validate it constantly.

## 🏛️ Frontend Domain-Driven Architecture

- **Contract Boundaries:** Cross-module imports MUST only come from contract folders: `useCases/`, `events/`, `errors/`, `stores/`, and `presentations/views/`.
- **Private Internals:** `models/`, `repositories/`, `engine/`, `transformers/`, `presentations/hooks/`, and `presentations/components/` are STRICTLY PRIVATE to their module. (`no-cross-module-internals` and `models-private-cross` rules).
- **NO BARREL FILES:** Do not use `index.ts` to re-export internals. Do not create pseudo-barrel files like `contracts.ts`.
- **Exporting DTOs:** If a module needs another module's Model (DTO), the Model's type MUST be exported from the specific `useCases/` file that operates on it (e.g., `export type { Track } from '../models/Track'` inside `getTrackById.ts`).
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
- **Cross-Domain UI State:** Use Vanilla `Store<T>` instances (in `stores/`). Business logic interacts directly with the Store instance. React connects via `useSyncExternalStore`.
- **Local Form/Settings:** Use React Hook Form + Zod.
- **Local Primitive State:** Use `useState` + React Compiler.
- **Context:** Used ONLY for deeply local view state (e.g. collapsing a panel). Consume Context using `use()` instead of `useContext`.

## 📝 React 19 & Coding Conventions

- **The React Compiler is ACTIVE:** Do NOT manually invoke `useMemo`, `useCallback`, or `React.memo`. The compiler handles memoization perfectly. Write plain code.
- **Refs:** `ref` is a regular prop in React 19. Do NOT use `forwardRef`.
- **Conditional Rendering:** Never use `&&` for rendering (it leaks 0 and false). Use complete ternaries `? :` or explicit early returns.
- **Control Flow:** All `if` statements must use block syntax `{}`. Guard clauses / early returns ONLY. No chained ternaries.
- **TypeScript Forms:** Prefer `type` over `interface`. Prefer `as const` objects over `enum`. Use explicit type-only imports (`import { type MyType }`).
- **Styling:** Exclusively use Tailwind V4 classes via `@theme` variables (e.g., `text-[var(--color-accent-orange)]` or standard tokens). No custom CSS outside `main.css`.
