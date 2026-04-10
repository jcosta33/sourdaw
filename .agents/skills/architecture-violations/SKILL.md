---
name: architecture-violations
description: Apply when fixing architecture violations, refactoring modules, restructuring boundaries, or performing codebase audits. Contains mandatory rules for addressing violations properly without hacking around the architecture. Prevents ad-hoc barrel re-exports (other than the module root index.ts), fake use cases, dumping unrelated logic into single files, shadow shared layers, and other forms of malicious or fake compliance.
---

# Architecture Violations Skill

This document explains **why** the architecture must be followed, **how** to reason about real compliance, and **which forms of fake or malicious compliance are forbidden**.

It applies to both AI agents and human maintainers.

This is not another architecture overview. It is a guardrail document for preventing architectural drift, shortcut-driven refactors, validator gaming, and code that "passes the rules" without preserving the meaning of the rules.

**Canonical module-boundary reference:** `docs/architecture/03-typescript-module.md` §3.3 (`index.ts`) and §5.1 (public surface).

---

## 1. When to Apply This Skill

Apply this skill when:

- fixing any architecture violation detected by `pnpm deps:validate`
- restructuring a feature or module
- moving logic across layers
- introducing new public surfaces
- adding adapters, stores, use cases, or projections
- cleaning up tech debt
- performing a codebase audit
- refactoring legacy code toward the new architecture
- reviewing whether a change is _actually_ compliant or only cosmetically compliant

---

## 2. Core Principle

**Fix violations properly — never hack around the rules.**

If a violation exists, the correct fix is to establish the proper architecture so the code flows through the right boundary.

Never:

- change validation rules to make violations pass
- create barrel exports (other than the module root `index.ts`) of non-contract entities to bypass restrictions
- move code into a "fake" use case, action, or projection file just to make imports legal
- rename files or folders to trick the validator
- move forbidden logic into `src/helpers/`, `src/shared/`, `utils/`, or other ungoverned escape hatches
- split code into many tiny files without improving responsibilities
- collapse multiple responsibilities into a giant "allowed" file
- keep unauthorized mutation but wrap it behind an allowed import path
- create compatibility wrappers that become permanent shadow architecture

A refactor is compliant only if it improves or preserves the _meaning_ of the boundary, not just the path.

---

## 3. Why Compliance Matters

Architecture compliance is not cosmetic consistency.

The architecture exists because this DAW has hard constraints that cannot be negotiated away by clever code organization.

### 3.1 Real-time safety is fragile

In a DAW, the real-time boundary is more important than aesthetics.

If allocations, locks, UI coupling, shell coupling, or other unsafe behavior leak into runtime-sensitive paths, the result is not merely impurity. It can cause:

- audio glitches
- instability
- timing drift
- impossible-to-reproduce bugs
- performance collapse under load

The architecture exists partly to keep real-time execution isolated from everything that is not real-time safe.

### 3.2 Shared state without ownership becomes corruption

The project model is the source of truth. That only works if ownership is real.

If multiple features casually mutate shared state because it is convenient, then:

- undo semantics become unclear
- persistence no longer reflects clear intent
- collaboration becomes harder later
- bugs become distributed instead of local
- refactors cannot be trusted

The architecture exists to preserve one owner per authoritative write surface, while still allowing broad read access via stores and projections.

### 3.3 UI coupling destroys reuse and correctness

When business logic lives in hooks, components, or shell entry points, it becomes:

- harder to test
- harder to reuse
- easier to accidentally duplicate
- dependent on rendering and lifecycle quirks
- vulnerable to shortcut code

The architecture exists so business logic can be reasoned about independently of React, Tauri, and imperative rendering.

### 3.4 Thin shell, thick core is not optional

Tauri, browser APIs, Web Audio setup, IndexedDB, filesystem operations, and plugin-host mechanics are real concerns, but they are not the business model.

If shell/framework code becomes the de facto owner of logic, the result is:

- runtime lock-in
- poor testability
- logic duplication across runtimes
- hidden infrastructure assumptions inside business behavior

The architecture exists to keep infrastructure replaceable and business logic stable.

### 3.5 AI agents optimize locally unless constrained

AI agents are very good at making a change "work" locally.
They are much less reliable if the system tolerates shortcut patterns that technically pass linting and dependency rules but violate architectural intent.

This means the codebase needs explicit protection against:

- shortcut abstractions
- fake boundary layers
- pass-through facades
- hidden write surfaces
- giant files that flatten layers
- barrel-export laundering
- compatibility wrappers that become permanent shadow architecture

This skill exists to prevent that.

---

## 4. Semantic Compliance vs Cosmetic Compliance

A change is compliant only if it preserves the meaning of the boundary, not just the path structure.

### 4.1 Real compliance

A change is compliant when it improves or preserves:

- ownership
- write discipline
- runtime isolation
- testability
- truth vs projection separation
- framework independence of business logic
- real-time safety

### 4.2 Fake compliance

A change is fake-compliant when it:

- passes dependency-cruiser by routing imports through laundering files
- moves logic into approved folders without changing dependency meaning
- introduces pass-through layers with no real separation
- collapses many concerns into one giant "allowed" file
- preserves hidden bidirectional coupling through indirection
- leaves unauthorized mutation intact while renaming entry points
- keeps runtime ownership in UI code while wrapping it in helper functions

If the architectural meaning did not improve, the refactor did not comply.

### 4.3 The key test

**A boundary is only real if responsibility changes across it.**

If a layer exists only to satisfy the validator while the real logic still lives in the wrong place, it is non-compliant.

### 4.4 Shim annotation-removal is not a refactor

A `TEMPORARY MIGRATION SHIM` (or any similar annotation) is not a comment. It is a task marker: it exists to trigger a real refactor.

Removing the annotation from a file that is still a pure re-export — e.g. `export { getX } from '../repositories/Y'` — does **not** make the file architecturally sound. The code still launders private access through a fake public surface, and the boundary is still non-existent.

The refactor that discharges a shim annotation is creating a real typed boundary (see §6). Deleting the comment without doing the refactor is malicious compliance, regardless of whether `deps:validate` still passes.

If you cannot complete the refactor in the current session, leave the annotation in place and document the reason in the task file.

---

## 5. Module Boundary: `index.ts`

The **only** file other modules may import from is the module's root `index.ts`.

```text
src/modules/ModuleName/index.ts   ← sole cross-module import target
```

`index.ts` may only re-export from these internal folders:

```text
useCases/                 → business operations (functions/constants — not cross-module type exports)
events/                   → typed event payload types (plain objects in AppEvents map)
stores/                   → Store<T> instances (business-layer, cross-module)
presentations/views/      → composable UI entry points (cross-module only through index.ts)
```

Everything else — `models/`, `repositories/`, `services/`, `validators/`, `transformers/`, `presentations/hooks/`, `presentations/stores/`, `presentations/context/`, `presentations/components/`, `presentations/renderers/`, `engine/`, `runtime/`, `worklets/`, `errors/` — is private to the module. External consumers never import those paths directly; the module promotes symbols only through curated `index.ts` re-exports from the four allowed roots (error types that must cross the boundary surface via `useCases/` or `events/`, not from `errors/` in `index.ts`).

### Importing cross-module

```ts
// CORRECT — import from module root index.ts
import { addTrack, trackStore } from '#/modules/Arrangement';

// FORBIDDEN — direct folder access from outside the module
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
```

### Writing `index.ts`

```ts
// src/modules/Arrangement/index.ts — sole allowed barrel; curated public surface
export { addTrack } from './useCases/addTrack';
export { removeTrack } from './useCases/removeTrack';
export { trackStore } from './stores/trackStore';
export type { TrackAddedEvent } from './events/TrackAddedEvent';
export { ArrangementView } from './presentations/views/ArrangementView';

// FORBIDDEN inside index.ts
export type { SomeDto } from './useCases/getThing'; // use-case types do not cross modules
export { Track } from './models/Track';           // models/ is private
export { getTrackById } from './repositories/...'; // repositories/ is private
```

### `index.ts` and the no-barrel rule

**Only** the module root `index.ts` may act as a re-export barrel. Do not add other `index.ts` or `contracts.ts` shims. This file is still a **curated** list of intentionally public symbols — not a full re-export of the module. Most files in a module should not appear in `index.ts`. If you find yourself re-exporting everything just to pass the validator, that is fake compliance.

---

## 6. Use cases — behavior crosses modules; types stay local

A use case is the **callable** cross-module contract. Other modules import **functions** from `#/modules/<Module>` — not types defined in that module’s `useCases/`. Each consumer module keeps its own types (or uses `ReturnType<typeof fn>` / `Parameters<typeof fn>`). **Event payload types** in `events/` are the shared type surface when a named cross-module type is required.

### 6.1 What a legitimate use case looks like

Every use case file must export its own typed function:

- The file exports a named function (or arrow) written by the module that owns the use case.
- **Types** used in the signature (`input`, return DTOs, etc.) are **internal** to the module — they are not re-exported from `index.ts` and are not imported by other modules via `import type` from `#/modules/...`.
- The input and output types may use this module’s `models/`, repositories’ pure-model types (§6.4, intra-module only), or inline types in the file — see `AGENTS.md` model isolation for cross-module data shapes.
- The function body may be thin. `return someRepo.method(input)` is acceptable — a use case is allowed to delegate to a private repository.
- **Within the same module**, callers may import from `./useCases/<file>` directly (including `import type` for types in that file).
- **From another module**, callers import **values** from `#/modules/<Module>` only (`export { fn }` on `index.ts`). No `export type { … } from './useCases/…'` on `index.ts`.
- Across a module boundary, callers never import `repositories/`; the use case hides the repository.

```ts
// Arrangement/useCases/getNextClipId.ts — legitimate thin use case
import { getNextClipId as allocateClipIdFromCounter } from '../repositories/clipIdCounter';

export function getNextClipId(): string {
    return allocateClipIdFromCounter();
}
```

The repository is free to change its internal implementation; the use case absorbs the change. Another module imports `getNextClipId` and does not import a type alias for its return type from Arrangement’s use cases.

### 6.2 What is forbidden

**Importing cross-module directly into a folder instead of through `index.ts`:**

```ts
// FORBIDDEN — bypasses the module boundary
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

// CORRECT — goes through the module's public surface
import { addTrack, trackStore } from '#/modules/Arrangement';
```

**Importing use-case types from another module:**

```ts
// FORBIDDEN — types defined in useCases/ are not a cross-module surface
import type { TrackSummary } from '#/modules/Arrangement';

// Prefer: local shape, or ReturnType<typeof getTrackSummary> after importing the function
```

**Re-exporting a repository function through a use-case file:**

```ts
// FORBIDDEN — laundering private access through a fake boundary
export { getNextClipId } from '../repositories/clipIdCounter';
export * from '../repositories/automergeRepository';
```

This creates no boundary. The consumer imports the repository symbol verbatim, under a different path. If the repository signature changes, every consumer breaks. There is no translation, no contract, no ownership change across the file.

**Re-exporting non-contract internals from `index.ts`:**

```ts
// FORBIDDEN — index.ts may only re-export from useCases/, events/, stores/, presentations/views/
export { Track } from './models/Track';
export { getTrackById } from './repositories/track/getTrackById';
export { TrackNotFoundError } from './errors/TrackNotFoundError';
export type { TrackSummary } from './useCases/getTrackSummary'; // use-case types do not cross
```

These patterns are non-compliant even if `deps:validate` passes — a fake public surface does not become a real one just because the path resolves.

If there is nothing to add to a use-case body, define a proper typed function that calls the repo. The function _is_ the boundary.

### 6.3 Internal DTOs when the repository shape is not safe to leak

If the repository returns a framework-coupled object or internal entity shape, the use case defines **internal** types to map or narrow — those types stay in the module (not on `index.ts`):

```ts
// Internal to the module — not exported from index.ts for other modules
type TrackSummary = { id: string; name: string; kind: TrackKind };

export function getTrackSummary(input: { trackId: string }): TrackSummary | null {
    const entity = trackRepository.get(input.trackId);
    if (!entity) return null;
    return { id: entity.id, name: entity.name, kind: entity.kind };
}
```

Other modules import `getTrackSummary` only; they define their own local types or use `ReturnType<typeof getTrackSummary>` if needed.

### 6.4 Repo types the use case may reference (intra-module)

Inside a module, a repository may expose **pure-model** types for the use case to use in signatures — plain data shapes with no behavior, no framework coupling, and no internal-implementation leakage. `type DocId = string` is a pure model. A class instance, a mutable handle, or a type tied to infrastructure is not.

Those types do not become other modules’ imports — consumers stay decoupled (see `AGENTS.md`).

When in doubt, keep types private to the use case file or use `models/` inside the module only.

### 6.5 One function per file

Each use case lives in its own file, named after the function. A file that exports many thin wrappers over a repository (e.g. `crdtRepositoryAccess.ts` with 8 re-exports) violates both §6.2 (laundering) and the One Function Per File rule. Split it into N files, one per function, each with a real typed signature.

### 6.6 Summary test

Before committing a use-case file, ask:

1. Does this file export its own typed function, not a re-export?
2. If the signature uses repo types, are those types pure models and only referenced **inside this module**?
3. Are we avoiding `export type` of use-case types on `index.ts` and avoiding cross-module `import type` of those types?

If any answer is no, the boundary is fake or the type surface is too wide.
