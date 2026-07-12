---
name: architecture-violations
type: agent-guide
description: >-
  Fix architecture violations by establishing the real boundary, not by gaming
  the validator. ALWAYS apply this skill when a dependency-boundary check flags a
  violation, when restructuring a module or moving logic across layers, or when
  introducing a public surface (use case, store, adapter, projection), or
  auditing a change or codebase for real-vs-cosmetic boundary compliance — even if
  the validator already passes and the change looks done. Do not silence a
  violation by re-exporting through a barrel, faking a use case, renaming files,
  or dumping logic into shared/helper escape hatches directly. Skip this skill
  for net-new feature behavior inside an already-correct boundary, dependency
  upgrades, or non-architectural bug fixes.
---

# Skill: Architecture Violations

## Purpose

This is a guardrail against architectural drift: shortcut refactors, validator
gaming, and code that "passes the rules" without preserving their meaning. It
prevents the failure mode where a violation is silenced — re-exported through a
laundering barrel, hidden behind a fake use case, renamed past the validator —
so the check goes green while the real logic still lives in the wrong place. A
boundary that exists only to satisfy `pnpm deps:validate` is worse than no boundary: it
hides the coupling it was supposed to expose. Applies to AI agents and human
maintainers alike.

**Canonical module-boundary reference:** `docs/architecture/03-typescript-module.md`
§3.3 (contract-folder barrels) and §3.1 (public contract surface).

## Core rules

### 1. Fix the violation properly — never hack around the rules
If a violation exists, the correct fix is to establish the proper architecture so
the code flows through the right boundary. A refactor is compliant only if it
improves or preserves the _meaning_ of the boundary, not just the path. Never:

- change validation rules to make violations pass;
- create barrel exports (other than the four contract-folder `index.ts` files) of non-contract entities to bypass restrictions;
- move code into a "fake" use case, action, or projection file just to make imports legal;
- rename files or folders to trick the validator;
- move forbidden logic into `src/helpers/`, `src/shared/`, `utils/`, or other ungoverned escape hatches;
- split code into many tiny files without improving responsibilities;
- collapse multiple responsibilities into a giant "allowed" file;
- keep unauthorized mutation but wrap it behind an allowed import path;
- create compatibility wrappers that become permanent shadow architecture.

_Why: the architecture encodes hard, non-negotiable DAW constraints (rules 8–12). A change that passes the check while violating the intent re-introduces the exact hazard the rule existed to prevent, now invisible._

### 2. A boundary is only real if responsibility changes across it
This is the key test. Real compliance improves or preserves: ownership, write
discipline, runtime isolation, testability, truth-vs-projection separation,
framework independence of business logic, and real-time safety. Fake compliance
passes the validator by routing imports through laundering files, introducing
pass-through layers with no separation, collapsing concerns into one giant
"allowed" file, preserving hidden bidirectional coupling through indirection, or
leaving unauthorized mutation intact while renaming entry points.

_Why: if a layer exists only to satisfy the validator while the real logic still lives in the wrong place, the architectural meaning did not improve — so the refactor did not comply, regardless of validator output._

### 3. Stop after three failed attempts; reread the contracts
If you attempt to fix an architectural violation or compilation error 3 times and
fail, **you must stop**. You are on the wrong architectural path. Do not enter a
hallucination loop patching broken abstractions. Discard your current approach,
reread the module contracts, and formulate a fundamentally different strategy.

_Why: repeated local patches on a wrong abstraction compound into shadow architecture faster than they converge on a fix._

### 4. Trace the blast radius before and after every move
Do not suffer from tunnel vision. Trace the upstream callers and downstream
dependencies of the files you move, and use the TypeScript compiler (`pnpm typecheck`)
to exhaustively navigate the blast radius of your changes.

_Why: moving a symbol across a boundary breaks consumers you did not look at; the compiler is the only exhaustive way to find them all._

### 5. Route every cross-module access through a contract-folder barrel
Each module exposes four independently-importable contract surfaces
(`useCases/`, `stores/`, `events/`, `presentations/views/`) and **no module-root
`index.ts`**. External consumers import only from those barrels — never from
`models/`, `repositories/`, `services/`, or any other private folder, and never
by deep file path. Same-module files use relative paths, never their own
contract barrel. Full mechanics, correct/forbidden import examples, and barrel
authoring rules: `references/module-boundaries.md`.

_Why: the barrel is the only place ownership and the public surface are curated; a deep import or a root-`index.ts` shim erases the curation and lets private state leak._

### 6. A use case is a typed function, not a re-export — types stay local
A use case is the **callable** cross-module contract: other modules import
**functions** from `#/modules/<Module>/useCases` (the contract-folder barrel — never
the bare `#/modules/<Module>` root), not types from its use-case surface. Every
use-case file exports its own named, typed function (a thin `return repo.method(input)`
body is fine). Re-exporting a repository/model symbol through a use-case file —
`export { getNextClipId } from '../repositories/...'` — is **laundering**: it
creates no boundary, no translation, no ownership change, and breaks every
consumer when the private signature changes. Cross-module types travel only via
`events/` payloads or a `Store<T>`'s `T`; model/repository/service/validator/
transformer/engine/error/handler types never cross. Full forbidden/allowed
catalog, internal-DTO pattern, the cross-module type-surface table, and the
`get<Module>Handlers` registry typing: `references/use-cases-and-type-surfaces.md`.

_Why: a re-export laundering file passes the validator but the consumer still imports the private symbol verbatim under a new path — the coupling is identical, now disguised._

### 7. One function per use-case file
Each use case lives in its own file, named after the function. A file that
exports many thin wrappers over a repository (e.g. `crdtRepositoryAccess.ts` with
8 re-exports) violates both rule 6 (laundering) and One Function Per File. Split
it into N files, one per function, each with a real typed signature.

_Why: a multi-export wrapper file is a barrel in disguise — it re-creates exactly the laundering surface the contract barrels are meant to be the only instance of._

### 8. Real-time safety is fragile — keep RT execution isolated
If allocations, locks, UI coupling, shell coupling, or other unsafe behavior leak
into runtime-sensitive paths, the result is not merely impurity. It can cause
audio glitches, instability, timing drift, impossible-to-reproduce bugs, and
performance collapse under load.

_Why: in a DAW the real-time boundary outranks aesthetics; the architecture exists partly to keep real-time execution isolated from everything that is not real-time safe._

### 9. One owner per authoritative write surface
The project model is the source of truth, and that only works if ownership is
real. If multiple features casually mutate shared state because it is convenient,
undo semantics become unclear, persistence stops reflecting intent, collaboration
gets harder, and bugs become distributed instead of local.

_Why: the architecture preserves one owner per authoritative write surface while still allowing broad read access via stores and projections; shared state without ownership becomes corruption._

### 10. Business logic stays independent of UI
When business logic lives in hooks, components, or shell entry points, it becomes
harder to test, harder to reuse, easier to duplicate, dependent on rendering and
lifecycle quirks, and vulnerable to shortcut code.

_Why: the architecture exists so business logic can be reasoned about independently of React, Tauri, and imperative rendering._

### 11. Thin shell, thick core — infrastructure stays replaceable
Tauri, browser APIs, Web Audio setup, IndexedDB, filesystem operations, and
plugin-host mechanics are real concerns, but they are not the business model. If
shell/framework code becomes the de facto owner of logic, the result is runtime
lock-in, poor testability, logic duplication across runtimes, and hidden
infrastructure assumptions inside business behavior.

_Why: the architecture keeps infrastructure replaceable and business logic stable; the shell must stay thin so the core stays portable._

### 12. A shim annotation is a task marker, not a comment
A `TEMPORARY MIGRATION SHIM` (or any similar annotation) exists to trigger a real
refactor. Removing the annotation from a file that is still a pure re-export —
e.g. `export { getX } from '../repositories/Y'` — does **not** make the file
architecturally sound; the code still launders private access through a fake
public surface. The refactor that discharges a shim annotation is creating a real
typed boundary (rule 6). If you cannot complete the refactor this session, leave
the annotation in place and document the reason in the task file.

_Why: deleting the comment without doing the refactor is malicious compliance — it erases the only signal that the boundary is still fake, regardless of whether `pnpm deps:validate` passes._

## What does not belong

- **Stack-specific or vendor patterns** (React 19 idioms, Tauri command shapes, IndexedDB recipes) — those live in the consuming repo's `AGENTS.md` and the per-concern skills, not here. This skill governs boundary _discipline_, not framework usage.
- **How to author a correct module in the first place** — that is `architecture` (barrels, stores-as-read-contract, composition shells, UI → business → IO).
- **The full architecture overview** — canonical module rules live in `docs/architecture/03-typescript-module.md`; isolation rules live in `AGENTS.md`.
- **State-ownership taxonomy** — rule 9 names the ownership invariant; full classification lives in `state-and-write-paths`.
- **Concrete commands** — use `pnpm deps:validate`, `pnpm typecheck`, `pnpm test:run`, `pnpm lint` from this repo; never invent substitutes.

## Refuses

| Tempting shortcut | Do this instead |
| --- | --- |
| Add a barrel re-export of a private symbol to make an import legal | Establish a real typed boundary; the only legal barrels are the four contract-folder `index.ts` files (rule 5) |
| `export { fn } from '../repositories/...'` inside a use-case file | Write a use case that declares its own typed function and calls the repo (rule 6) |
| Rename a file/folder so the validator stops flagging it | Move the logic so responsibility actually changes across the boundary (rule 2) |
| Drop logic into `src/helpers/`, `src/shared/`, `utils/` to escape the rule | Place it in the module that owns the responsibility (rule 1) |
| Split one concern into many tiny files to dodge a size rule | Restructure by responsibility, not by file count (rule 1) |
| Collapse several concerns into one giant "allowed" file | Keep one responsibility per file; respect One Function Per File for use cases (rules 1, 7) |
| Delete a `TEMPORARY MIGRATION SHIM` comment that still re-exports | Do the refactor that discharges it, or leave the annotation and note why (rule 12) |
| Wrap unauthorized mutation behind an allowed import path | Route the write through its single owner (rule 9) |
| Keep runtime ownership in UI code behind a helper function | Move business logic out of hooks/components into the owning module (rule 10) |
| Patch the same broken abstraction a fourth time | Stop, reread the contracts, choose a different strategy (rule 3) |

## Anti-patterns

### CRITICAL — Re-export laundering

❌ `export * from '../repositories/automergeRepository'` in a use-case file  
✅ A typed use case per function that hides the repo (rule 6; `references/use-cases-and-type-surfaces.md` §2).

### CRITICAL — Non-contract export on a barrel

❌ `export { Track } from '../models/Track'` in `useCases/index.ts`  
✅ Keep `models/` private; barrels re-export only from their own folder (rule 5).

### CRITICAL — Gaming a new pure-layer rule

❌ Move logic into a “use case” that only re-exports a presentation renderer to silence `business-no-presentations`  
✅ Put UI factories under `presentations/` and call them from views/hooks; do not invent pass-through business files.

### HIGH — Cross-module use-case type import

❌ `import type { TrackSummary } from '#/modules/Arrangement/useCases'`  
✅ Local shape or `ReturnType<typeof getTrackSummary>` (rule 6).

### HIGH — Untyped handler registry

❌ `Record<string, ActionHandler<any>>`  
✅ Mapped type derived from `AppAction` so each entry narrows on its payload.

### HIGH — Multi-export wrapper file

❌ `crdtRepositoryAccess.ts` with eight re-exports  
✅ N single-function files (rule 7).

### MEDIUM — Same-module barrel import

❌ `import { addClip } from '#/modules/Arrangement/useCases'` inside Arrangement  
✅ Relative path `./useCases/clip/addClip` (rule 5).

## Self-review gate

Run this before declaring an architecture-violation fix done. Any step that
should produce visible output is required to produce it.

1. **Validator is green from a real run.** Run `pnpm deps:validate` yourself and paste the output verbatim into the task file's `## Self-review` (or wherever the consuming repo records verification). A passing claim without pasted output reads Unverified, not Pass.
   - **Main cruise** known-violations: full **from→to** edges — new dependency edges still fail.
   - **Reachability cruise** known-violations: softens by **component `from` + rule name** only — a baselined dirty component will not fail again when it reaches *additional* use cases; only a **new** dirty component fails. See `.dependency-cruiser.reachability.cjs` header.
2. **Compiler confirms the blast radius is closed.** Run `pnpm typecheck` and paste its output; zero errors confirms no consumer was left broken (rule 4).
3. **Responsibility changed across every new/moved boundary.** For each boundary you touched, write one sentence naming what responsibility now lives on each side (rule 2). If you cannot, the boundary is fake — go back.
4. **No new laundering surface.** Confirm in writing that no use-case file re-exports a repository/model/service symbol and no non-contract export was added to a contract barrel (rules 5–7). Paste the grep you used, e.g. for `export .* from '\.\./repositories` and `export .* from '\.\./models` across the files you changed.
5. **No shim deletions without the refactor.** Confirm that every `TEMPORARY MIGRATION SHIM` you removed was discharged by a real typed boundary, not just deleted (rule 12).
6. **No escape-hatch dumping.** Confirm no logic was moved into `src/helpers/`, `src/shared/`, or `utils/` to dodge a rule (rule 1).

Not complete until the verbatim `pnpm deps:validate` output and the verbatim `pnpm typecheck`
output both appear in the self-review, and steps 3–6 each have a written answer
beneath them. Checkboxes alone do not count.

## Bundled resources

- `references/module-boundaries.md` — the four contract surfaces, correct/forbidden cross-module and same-module import examples, and contract-folder barrel authoring rules (deep mechanics for rule 5).
- `references/use-cases-and-type-surfaces.md` — legitimate vs forbidden use cases, internal DTOs, the cross-module type-surface table, the `get<Module>Handlers` registry typing pattern, and the summary test (deep mechanics for rules 6–7).
- `.dependency-cruiser.cjs` — includes pure-layer rules (`business-no-presentations`, `repositories-no-business`, `models-are-pure`, `events-are-pure`, `components-no-view-access`) and barrel rules. Note: `no-usecase-type-exports-on-index` only matches type-only edges and may not fire until type edges are enabled on the cruise.
- `.dependency-cruiser.reachability.cjs` — `components-no-usecase-transitively` (value imports only).
- Sibling skill: `architecture` — authoring against these boundaries.
