# Sourdaw Web App — Agent Guidelines

Tool-neutral guidance for AI coding agents (Cursor, Codex CLI, Windsurf, Cline, Copilot Coding Agent, Claude Code). `CLAUDE.md` is a symlink to this file.

## Checks

See `package.json` for all scripts.

- **Tests:** `pnpm test:run <path/to/file.spec.ts>` — pass a file (or narrow path) while iterating. `pnpm test` is watch mode; do not use it for verification. See `docs/06-testing.md`.
  - **Scope with `--dir src` whenever you pass a path.** A bare relative path is a *pattern*, and it also matches the copy inside every `.agents/worktrees/*` lane — which both invents phantom failures and can manufacture real ones by running two copies of the same spec concurrently.
  - **Changed shared code? Run the whole suite before claiming green.** Anything under `src/infra/`, `src/app/`, `src/helpers/`, `src/utils/`, or a store/model other modules read is covered by specs that do **not** live next to it. `main` has gone red more than once from a change that updated some of the specs covering a function and missed the rest — focused tests cannot tell you a widely-imported file is safe.
- **Lint:** `pnpm exec oxlint <path/to/file.ts>` — always specify the touched files (oxlint covers ESLint core, unicorn, promise, import, jsx-a11y, and all typescript-eslint rules incl. type-aware). `pnpm exec eslint <path/to/file.ts>` covers the retained-only rules (custom `sourdaw/*`, `@eslint-react`, `react-hooks`, `@tanstack/query`, prettier, `import-x/order`). `pnpm lint` runs both (oxlint first). Do not run whole-tree `pnpm lint` unless the task is a repo-wide lint pass. CI uses `pnpm lint --quiet` (errors only; **warns do not fail**).
- **Type check (app):** `pnpm typecheck` — `tsconfig.app.json`; **excludes** `*.spec.ts(x)`. (The base `tsconfig.json` is spec-inclusive so oxlint's type-aware linting sees real types in tests.)
- **Type check (tests):** `pnpm typecheck:test` — spec-inclusive (`tsconfig.test.json`: all of `src` **including** `*.spec.ts(x)`). Run after touching any spec, dummy factory, or model shape that fixtures mirror; must stay at zero errors.
- **Module boundaries:** `pnpm deps:validate` (main + causal reachability + type-edge + test-inclusive cruises). New **error** edges and stale baseline rows fail; known debt is exact and reviewable.
- **Barrel mocks:** `pnpm test:barrel-mocks` — a `vi.mock` of a `presentations/views` contract barrel whose factory lists exports by hand must not omit a name the spec's module graph imports, or the next export added to that barrel resolves to `undefined` and reds every test in the file. Either name the missing export (free) or spread `importOriginal` (loads the real module — measure first); `exemptions` in `scripts/checkBarrelMockCoverage.ts` is the documented exit for a deliberately narrow mock. See `docs/06-testing.md` §5.

After cross-module moves or bulk import changes, re-run `pnpm deps:validate` before claiming done (at least every ~10 files during large refactors).

## Codebase layout

- **`src/modules/`** — DDD domain modules (Arrangement, Transport, AudioEngine, …). Default place for new product code.
- **`src/app/`** — composition root: `bootstrap.ts` wires DI ports and registers all module handler maps; `registerDependencies.ts` builds the singletons (typed event bus, logger).
- **`src/infra/`**, **`src/helpers/`**, **`src/utils/`** — cross-cutting infrastructure and utilities (not domain modules). Must not import from `src/modules/`. (`src/shared/` does not exist; the deps rule still guards the name.)
- **`src/components/`** — shared UI design system (shadcn/Radix `ui/`, `layout/`, DAW `daw/` family). No direct store/use-case imports.
- **`src-tauri/`** + 9 workspace crates (`daw-core`, `daw-collab`, `daw-engine`, `daw-dsp`, `daw-io`, `daw-wasm-decoder`, `daw-plugin-host`, `proof-chamber`, `scoring`) — thin Tauri bridge and RT/native audio. Commands live only in `src-tauri`.
- **`.agents/skills/`** — domain agent skills (architecture, web-audio-engine, …).
- **`.agents/worktrees/<name>/`** — isolated lanes for parallel work (gitignored). Create from `origin/main`; lock with `git worktree lock --reason active:<owner> <path>` while assigned. Operate only inside that lane. Each campaign PR links its issue; record every merged PR **in that issue's body** — a comment is not read — before retiring its lane. The issue must carry the `epic` label. `pnpm lane:remove` refuses a lane whose PR is not named back by exactly one such issue. After every process exits, unlock the lane and run `pnpm lane:remove <path>` elsewhere. Other lanes remain owner-managed.
- **Nested `AGENTS.md`** — subtree-specific guidance (with `CLAUDE.md`/`GEMINI.md` symlinks) lives in `src-tauri/`, `crates/daw-dsp/`, `src/components/`, `src/modules/AudioEngine/`, `src/modules/Collaboration/`. Read the local file when working in those subtrees.

## Device naming key (bakery metaphor)

Bread-named modules under `src/modules/` are the built-in devices. Most have a matching DSP engine in `crates/daw-dsp/src/` (compiled to native + WASM; Crumbs' *disk-streaming* mode is native-only, but its engine renders under WASM from an in-memory sample pool) and a node in `AudioEngine/engine/`; exceptions: ProofChamber is the sibling `proof-chamber` crate, the Tuner is the `scoring` crate (`ScoringNode`), and Yeast and CvGate have no Rust engine (Crust gained one — `crates/daw-dsp/src/crust/`). "Dutch Oven" in engine/device ids is the ProofChamber reverb, not a separate module.

| Module     | Device                                 | Module       | Device                            |
| ---------- | -------------------------------------- | ------------ | --------------------------------- |
| Fermenter  | flagship hybrid synth                  | Crust        | limiter                           |
| Toaster    | drum machine                           | Bacteria     | multiband creative FX             |
| Levain     | orchestral sample instrument           | Proof        | mastering suite                   |
| GrandBoule | physical-model grand piano             | ProofChamber | algorithmic reverb ("Dutch Oven") |
| Grinder    | guitar amp/pedal sim (+ neural models) | Knead        | real-time pitch correction        |
| Gluten     | bus compressor                         | Crumbs       | sampler/slicer                    |
| Yeast      | MIDI FX rack                           | CvGate       | modular CV/gate outputs           |

## Orientation anchors

- **Mutations:** everything goes through `executeAppAction` (`src/modules/Command/useCases/executeAppAction.ts`); each action runs inside an Automerge transaction, so CRDT history doubles as undo/audit. Handler maps (`get<Module>Handlers()`) are registered in `src/app/bootstrap.ts` in pinned order (see `src/app/__tests__/bootstrap.spec.ts`).
- **Project read model:** `src/modules/Arrangement/stores/trackStore.ts` is the central hub most modules subscribe to.
- **IPC:** the only TS adapter is `src/utils/tauriBridge.ts`; repositories gate on `isTauri()` and stub in browser dev mode. Command inventory and RT invariants: `src-tauri/AGENTS.md`.
- **WASM DSP:** `pnpm wasm:all` builds the Rust DSP crates into `public/wasm/`; worklet wiring and legacy-output traps: `src/modules/AudioEngine/AGENTS.md`.
- **Single-surface app:** only two routes (`src/routes/__root.tsx`, `src/routes/index.tsx`); the entire DAW renders at `/`.
- **Events:** one typed bus (built in `src/app/registerDependencies.ts`); only Arrangement, AudioEngine, WorkspaceShell, and Yeast publish real event payloads through their `events/` barrels.

## Project specifications

**Do not add specifications to this repo.** Write them as workspace artifacts instead. A spec enters
the repo only when the owner explicitly asks for that artifact to be promoted, and is deleted
immediately after the work it describes is implemented unless the owner says otherwise.

The `.agents/specs/<feature>/` directories already here predate that rule. Leave them alone —
preserve their status and content unless assigned work says otherwise — but do not add to them.
Captured source material that has not yet been normalized lives under `.agents/specs/intake/`, under
the same no-new-additions rule.

Accepted project decisions are different and do belong here: they live under `.agents/decisions/` and
follow that directory's ADR ledger.

## Path aliases

| Alias   | Source  | Notes                                                                  |
| ------- | ------- | ---------------------------------------------------------------------- |
| `#/...` | `src/*` | Modules, infra, helpers, utils — e.g. `#/modules/Arrangement/useCases` |

Prefer `#/` for cross-module and cross-folder imports. Inside a module, use **relative** paths to the defining file (never that module’s own contract barrels).

## Layer boundaries

Hard gate via `pnpm deps:validate` (main **error** rules + causal reachability + types + tests cruises). New **error** edges fail; stale baseline rows fail when debt is retired. **Warn** rules stay visible without failing the gate.

- Cross-module imports target **only** contract-folder barrels: `useCases/`, `stores/`, `events/`, `presentations/views/` (each folder’s `index.ts`). No module-root `index.ts`. No deep imports into private folders (`models/`, `repositories/`, `handlers/`, `engine/`, …). (**error**)
- Same module: relative imports only — not `#/modules/<Self>/…`. (**error**)
- Direction: presentation → use cases → repositories / stores / services. Business/IO must not import `presentations/`. Only `useCases/` orchestrate `repositories/`. Repositories must not import business/event contracts or foreign stores; same-module stores remain an existing adapter pattern. Models, events, services, validators, and transformers stay pure. (**error**)
- Leaf `presentations/components/` and shared `src/components/`: no **direct** business-store or use-case imports (**error**, main cruise). No **transitive** reach of use cases (**error**, reachability cruise). Transitive store reach is **not** reachability-gated — still avoid via props/hooks (**policy**).
- Worklets stay isolated from app/helpers/Tauri. (**error**)
- **Tauri IPC confinement** — **error** via `deps:validate` (`tauri-ipc-only-in-repositories`): allowed production origins are only module-root `src/modules/<Module>/repositories/` (including `Common/` and `Supporting/` namespaces) and the exact `src/utils/tauriBridge.ts` adapter. Only `src/utils/__tests__/tauriBridge.spec.ts` may mock adapter dependencies; all other `src/**` origins and non-allowlisted bridge callers are forbidden; nested `useCases/repositories` and `presentations/repositories` are not repository layers.
- Tests cruise: cross-module **barrel** + **no relative cross-module** for module tests, external tests, and global test setup, plus the promoted Tauri/model rules (main excludes specs).

System invariants: [docs/architecture/01-system.md](./docs/architecture/01-system.md). Deep module anatomy: [docs/architecture/03-typescript-module.md](./docs/architecture/03-typescript-module.md). Rust/Tauri: [docs/architecture/02-rust-backend.md](./docs/architecture/02-rust-backend.md).

## Tech stack

React 19 (Compiler), TypeScript, Vite, TanStack Query (installed, not yet adopted), vanilla `Store<T>` + `useStore`, Vitest, Playwright (`pnpm test:e2e` local — **not** in CI health gates), Tauri 2, Rust audio crates (CPAL / RT paths).

## When a check blocks you

Checks are proxies for intent — never make one pass while its intent stays violated. Test: would the change be justified if the check didn't exist? Disable comments, `any` / unsafe casts, deleting or loosening tests, and editing checker configs or baselines are **evasion**, not fixes. Fix the cause or stop and report the blocking rule; blocked is acceptable, laundered green is not.

Do not use codemods, bulk `sed`/AST rewrites, or global formatters/`eslint --fix` across the tree unless the user explicitly asks. Edit files deliberately.

## Always-on rules

Agent must-follow subset of [docs/07-conventions.md](./docs/07-conventions.md) and architecture practice. **Hardness is not uniform** — hard gates, warn-only lint, and policy-only rules are labeled inline.

- **Contract barrels only cross-module.** (**error** via `deps:validate`) Up to four surfaces per module (`useCases`, `stores`, `events`, `presentations/views`) — create only those needed.
- **Stores are a public read contract.** Foreign modules may subscribe; they must not `store.set` (agent policy; ESLint `sourdaw/no-foreign-store-write` is **warn** only — CI `lint --quiet` ignores warns). Writes go through the owning module’s use cases or `executeAppAction`.
- **Use-case types stay private.** No `export type` from `useCases/index.ts` (**error** on type cruise). Consumers use `ReturnType` / `Parameters` or `events/` payloads. Models are never re-exported across modules — local shapes or intentional duplication.
- **One function per use-case and repository file** (ESLint `sourdaw/no-multiple-function-exports` is **error**). Handlers live under `handlers/` with `createHandler`; cross-module access only via `get<Module>Handlers` from `useCases/`. Presentation never imports raw handler maps.
- **Repositories touch metal; engine does not import repositories.** (**error**) I/O (Tauri, storage, audio setup) in `repositories/`; use cases orchestrate.
- **Async/server state:** TanStack Query is installed and wired (`src/app/queryClient.ts`) but has no call sites yet — adopted direction, not current usage; never `useEffect` for data fetching (**error** lint where configured). **Local form state:** no form library is installed today (RHF + Zod are aspirational — see the `docs/02-forms.md` banner); use `useState` until the stack lands. **Local UI:** `useState` + Compiler. **Context:** only deeply local view state; prefer `use()` over `useContext` (convention; not eslint-hard).
- **React 19:** no `useMemo` / `useCallback` / `React.memo` (**error**); no `forwardRef` — `ref` is a prop (**error**). Prefer `cond ? <X /> : null` over render `&&` (**house**); leaky `&&` (e.g. `0 && …`) is **error** lint — boolean `&&` is not that rule.
- **Audio RT:** anything on the audio thread must not allocate, lock, or block. Prefer `AudioWorklet` + `AudioParam`; one live `AudioContext`. (**policy / review** — not CI-machine-gated)
- **TypeScript soundness:** types describe real data. No `any` except boundary + immediate narrowing (**error** in app; specs often **warn**). No `as any` / `as unknown as T` (**error** in app). Prefer not using bare `as T` to silence the checker (**policy**). No bare `@ts-expect-error` without a one-line reason (**error**). Prefer `unknown` + narrowing, `satisfies`, unions, `import type`, Zod at I/O (**policy**). Tests assert values/shape/errors — not just “defined” (**policy**). Every test must verify a callback argument, a state mutation, a conditional-rendering gate (absent vs present+routed), a computed readout string, or a rejection. Do **not** assert against CSS class names, color tokens, or Tailwind substrings (e.g. `accent-mint`, `var(--color-accent-cyan)`, `border-white/18`) — those test styling wiring, not the feature, and break on theme/refactor. Do **not** write pure-existence checks (“renders the X name”, `toBeDefined`/`toBeTruthy` on always-rendered output). A test is bogus if removing the code-under-test’s logic still makes it pass.
- **Style (house):** prefer `type` over `interface`; `as const` over `enum`; named exports (no namespace imports); multi-arg module functions take one object param with `FunctionNameInput` / `FunctionNameOutput` adjacent to the function (convention); modules Capitalized; **filenames per `docs/07-conventions.md`** (PascalCase components/views/models; camelCase use cases/helpers — **not** repo-wide kebab-case); guard clauses + braced `if`.
- **Conventional control flow over compressed expressions.** Use `if`, guard clauses, early returns, and named intermediate values when conditions express control flow or invariants. A ternary is acceptable only for a small, obvious, side-effect-free value choice that stays readable on one line. No nested, chained, multiline, or side-effecting ternaries; do not compress validation, mutation, overflow handling, or multi-condition logic into a ternary merely to save lines. Review for human readability, not cleverness or minimum line count.
- **Empirical proof:** failing reproduction before behaviour fixes; paste real command output for tests/typecheck/deps claims. Three failed fix attempts on the same approach → stop, reread contracts, change strategy.

## Pull requests and review

**Delivery:** use `pnpm deliver <pr-number>`. It selects proportionate local checks, rejects drift or unresolved review, preserves stacked dependents, and merges the reviewed head. Add `--e2e <spec>` for a justified E2E target or `--full-e2e` only with explicit authority. Never merge or delete branches with raw `gh`.

**Title:** conventional commits — `type(scope): subject`, matching `git log`. `feat` `fix` `chore` `docs` `test` `refactor` `perf` `build` `ci`. Scope is the module or crate.

Enforced by `.githooks/commit-msg` for every harness and every human. Enable once per clone: `git config core.hooksPath .githooks`. Deliberate exception: `git commit --no-verify`.

**Body:** fill `.github/pull_request_template.md`. Read it before opening the PR. A few paragraphs — what changed, why, what a reviewer should watch. Hard ceiling 4000 bytes.

Never in a body: mutation tables, per-config sweeps, stance labels, agent names, reviewer prose, repeated evidence, head diaries, recaps. Those go in the commit message, a linked issue, or nowhere. If a measurement is load-bearing, cite the one decisive line.

**Review comments** go on the diff line they concern:

```bash
gh api repos/:owner/:repo/pulls/<n>/comments -f body='…' -f commit_id=<sha> -f path=<file> -F line=<n>
```

`gh pr comment` is for a cross-cutting defect with no line, and for nothing else. One terse paragraph per finding: defect, consequence, required outcome. Ceiling 2000 bytes. No greetings, praise, process narration, stance labels, or solution essays. Evidence only when the diff does not prove the claim.

**Scale:** three review stances is the default, five the maximum. Past five, split the PR or ask. Finish the pool once — no quiet rotation, no ceremonial pass, no completion recap.

**Cost:** review is a gate, not a research programme. Dispatching more than 10 subagents against one PR, or spending over an hour on one, needs explicit approval — report cumulative cost when asking.

Command help: `pnpm deliver --help`; `pnpm lane:remove --help`.

## Safety (destructive actions)

- Do not delete, rename, or move files unless the task or user names them. Prefer targeted edits over full-file rewrites.
- Do not run destructive git (`reset --hard`, `clean`, force-push, discard, branch -D) or push/amend published history unless explicitly asked.
- Do not install/remove packages, edit CI/build config, or start long-lived background servers unless the task requires it.
- Stage only files you intentionally changed. When unsure whether an action is safe: stop and ask.
