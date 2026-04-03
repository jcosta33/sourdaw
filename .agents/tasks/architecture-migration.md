# DAW Architecture Migration Guide

This document explains how to migrate code from the legacy architecture to the new centralized architecture.

It is written primarily for AI agents and maintainers performing incremental changes in a large, partially inconsistent codebase. It does not assume the existing code is clean. It assumes some areas follow the intended rules, some partially do, and some drifted over time.

This is not a rewrite plan. It is a decision guide for safe convergence.

---

## 1. Purpose

The purpose of this guide is to help code move from the old architecture into the new one without:

- destabilizing working behavior
- forcing large-scale rewrites
- introducing parallel architectures
- making module boundaries more rigid than necessary
- regressing real-time safety
- scattering business logic across UI and runtime code

This guide should be used whenever changing existing code that predates the new centralized architecture.

---

## 2. The migration mindset

### 2.1 Converge, do not restart

The codebase is already large and partly agent-authored. Many shortcuts exist because previous implementations optimized for speed, local convenience, or incomplete understanding.

The correct default is:

- preserve working behavior
- improve the nearest broken boundary
- avoid mass structural churn
- move code toward the target architecture gradually

### 2.2 Favor local improvements with systemic effect

The best migration changes are those that improve one of:

- ownership clarity
- mutation discipline
- state classification
- React/runtime separation
- Tauri/domain separation
- projection correctness
- real-time safety

### 2.3 Do not migrate by folder cosmetics

A file moving into a prettier folder without boundary improvement is not meaningful migration.

Migration is successful when:

- the dependency direction improves
- the write boundary becomes explicit
- runtime objects stop leaking into UI/business code
- projections become read-only
- shell/framework logic stops owning business behavior

### 2.4 New code follows the target architecture immediately

Legacy code may remain temporarily. New code should not extend legacy mistakes unless there is a strong stability reason.

---

## 3. Old architecture to new architecture: conceptual mapping

The old architecture already had many correct ideas. The new architecture consolidates and simplifies them.

## 3.1 What remains true

The following old principles still apply:

- the real-time boundary is inviolable
- the project store is the single source of truth
- domain data should remain plain
- engine/runtime objects are stateful runtime resources
- business writes should go through use cases
- Tauri should remain a bridge
- rendering and I/O should remain isolated from business logic

## 3.2 What changes

The new architecture changes emphasis in these ways:

| Old architecture tendency                                  | New architecture direction                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| heavy per-module folder taxonomy                           | architecture defined by boundaries, not mandatory folders                                       |
| every module has a similar ceremonial structure            | choose the smallest shape that preserves the rules                                              |
| repositories are the universal I/O bucket                  | think in ports and adapters; keep repositories for actual persistence-like concerns when useful |
| module definitions are explicitly enumerated               | modules remain flexible; ownership matters more than fixed module names                         |
| architecture described separately for frontend and backend | one system architecture across all runtimes                                                     |
| use case folders are the main contract surface             | commands/actions become the preferred write model                                               |
| stores are central and sometimes overly convenient         | stores are read/sync tools, not hidden write APIs                                               |

---

## 4. Migration priorities

When touching old code, improve in this order.

### 4.1 Highest priority

Always prioritize these first:

1. real-time safety
2. correctness of project-state ownership
3. explicit write boundaries
4. separation of runtime state from project/UI state
5. removal of business logic from views and shell code

### 4.2 Medium priority

Improve these when the surrounding code is already being touched:

1. projection clarity
2. event vs command clarity
3. adapter extraction
4. DTO/transport cleanup
5. testability of business logic without React/Tauri

### 4.3 Lowest priority

Do not spend effort here unless it directly helps the items above:

1. folder renaming
2. file naming purity
3. splitting code into more modules just to look architectural
4. mechanically mirroring the architecture document in the filesystem

---

## 5. Migration decision tables

## 5.1 If you find this in old code, move it here

| Found in old code                                                  | Migrate toward                             |
| ------------------------------------------------------------------ | ------------------------------------------ |
| React component contains business rules                            | application/domain layer                   |
| hook performs project mutation inline                              | application action/command                 |
| hook calls Tauri `invoke` directly                                 | adapter behind port                        |
| hook calls Web Audio API directly for business behavior            | runtime adapter or engine boundary         |
| store mutation from another feature                                | owning feature’s public action             |
| AudioNode or plugin handle in React/store                          | engine/runtime-owned state                 |
| high-frequency meter updates through React state                   | telemetry/ref/render loop                  |
| feature reads another feature’s projection and mutates based on it | explicit command/action boundary           |
| persistence logic in UI hook                                       | application workflow + persistence adapter |
| Tauri command doing business logic                                 | move logic into core/application layer     |

## 5.2 If you are unsure what kind of state something is

| Question                                       | If yes                 | If no                        |
| ---------------------------------------------- | ---------------------- | ---------------------------- |
| Is it saved with the project?                  | project state          | continue                     |
| Is it undoable?                                | probably project state | continue                     |
| Does it depend on live runtime resources?      | engine/runtime state   | continue                     |
| Is it only for display feedback?               | telemetry/projection   | continue                     |
| Is it just view interaction state?             | ephemeral UI state     | continue                     |
| Is it only a local component concern?          | local component state  | continue                     |
| Is it a user preference but not project truth? | persistent UI state    | shared runtime or reconsider |

## 5.3 If you are unsure whether to use a command, event, store, or helper

| Need                                                    | Use              |
| ------------------------------------------------------- | ---------------- |
| express an intentional business write                   | command/action   |
| allow another concern to react to meaningful occurrence | event            |
| expose read state to UI                                 | projection/store |
| share simple local logic                                | helper/function  |
| bridge to external runtime/API                          | port + adapter   |

---

## 6. Migration phases

The migration should generally happen in five recurring phases.

## 6.1 Phase 1: classify the code you are touching

Before changing code, identify:

- what kind of state it uses
- whether it performs writes or reads
- whether it crosses a runtime boundary
- whether it touches the RT path
- whether it owns business rules or only display logic
- whether it is legacy-compatible or already close to target

Do not refactor blindly.

### 6.1.1 Classification checklist

For the code under change, answer:

1. Is this project truth, projection, runtime state, or UI state?
2. Who currently mutates it?
3. Who should mutate it?
4. Does it cross React/business/runtime/Tauri boundaries?
5. Is the current write path explicit or hidden?
6. Is it safe to leave in place temporarily?
7. What is the smallest change that improves the boundary?

## 6.2 Phase 2: isolate the write boundary

If old code performs business changes from the wrong place, first introduce a clear write entry point.

Typical examples:

- extract a hook-side mutation into an action
- replace direct store writes with an owning action
- replace scattered mutations with one command handler
- replace Tauri-command-contained business logic with an application-level function

This is usually the single most useful migration step.

## 6.3 Phase 3: isolate infrastructure

Once the write boundary is explicit, move external API usage behind adapters.

Typical examples:

- move `invoke` calls out of use cases/hooks
- move browser storage access out of components
- move engine/runtime calls behind ports/adapters
- wrap plugin host calls behind an explicit interface

## 6.4 Phase 4: split truth from projections

Once writes and infrastructure are clearer, separate authoritative state from derived read state.

Typical examples:

- replace direct UI mutation of engine state with project mutation + projection
- move high-frequency display data into telemetry paths
- replace denormalized mutable stores with derived selectors or projections

## 6.5 Phase 5: simplify shape only after behavior is safe

Only after the above should you consider:

- file moves
- folder cleanup
- shape consolidation
- removal of obsolete legacy wrappers

---

## 7. Safe migration patterns

## 7.1 Pattern: extract action from a component or hook

### Legacy form

A component or hook:

- reads state
- validates
- writes project store
- maybe calls runtime
- maybe logs history
- maybe updates UI state

### Target form

Split into:

1. presentation captures user intent
2. application action/command validates and mutates truth
3. projection/store updates reads
4. runtime adapter responds through channel/reconciliation

### Migration steps

1. identify the existing mutation logic
2. extract it to a plain function outside React
3. pass explicit input into it
4. keep component/hook as a thin caller
5. later move runtime calls out if still mixed in

## 7.2 Pattern: replace direct cross-feature store mutation

### Legacy form

Feature A directly writes Feature B’s state slice.

### Target form

Feature A calls Feature B’s public action, or a command is routed to Feature B’s owner.

### Migration steps

1. identify the owning slice
2. create or reuse a public write action
3. replace direct mutation with that action
4. remove any stale helper that implied shared write ownership

## 7.3 Pattern: move runtime handle leakage out of React

### Legacy form

A component, hook, or store holds:

- AudioNode
- plugin instance
- native runtime handle
- live engine object

### Target form

Engine/runtime owns the handle. UI sees only:

- IDs
- DTOs
- read models
- telemetry
- callbacks/actions

### Migration steps

1. keep the runtime object alive where it currently is
2. introduce an adapter/API surface around it
3. replace consumers with ID/DTO-based access
4. migrate the object itself into engine/runtime-owned code
5. delete any store/context references to it

## 7.4 Pattern: move Tauri logic out of the business layer

### Legacy form

Use case or UI code directly knows command names, event names, or Tauri-specific APIs.

### Target form

Application code depends on a port. Tauri implements it in a bridge adapter.

### Migration steps

1. define the capability in plain terms
2. introduce a port/interface
3. implement via Tauri adapter
4. replace direct `invoke`/event usage with the port
5. keep the Tauri bridge thin

## 7.5 Pattern: split write model from telemetry

### Legacy form

Telemetry-like values are written into project stores or React state at high frequency.

### Target form

Telemetry flows through:

- channel
- ref
- dedicated projection
- render loop

Project state only changes when explicitly committed.

### Migration steps

1. identify whether the value is truth or feedback
2. if it is feedback, remove it from authoritative state
3. expose it through telemetry/projection
4. bind UI via a high-frequency read path rather than regular business writes

---

## 8. High-risk migration zones

These areas require extra caution.

## 8.1 Real-time paths

Never “clean up” RT-path code casually.

Before modifying RT-adjacent code, verify:

- no new allocations
- no new locks
- no React or DOM interaction
- no accidental sync IPC
- parameter vs topology distinction remains intact

## 8.2 Undo/redo code

Do not migrate writes without thinking through undo consequences.

Any write migration should answer:

- what is the command boundary now?
- does coalescing still work?
- does the action remain replayable?
- are historical semantics preserved?

## 8.3 Persistence

Do not break compatibility between:

- project truth
- serialization
- migration of saved files
- cache invalidation
- legacy load paths

## 8.4 Plugin hosting

Be explicit about what changes belong to:

- project-side plugin model
- runtime plugin instance lifecycle
- editor window/control surface
- scan metadata
- failure state

## 8.5 Transport and routing

These tend to have invisible coupling with many other systems. Migrate boundary clarity first, not internals first.

---

## 9. Canonical migration moves

These are the most common good moves AI agents should make.

## 9.1 Good move: introduce a thin action wrapper

When old code mutates too much inline, create one clear action first. Even if internals remain messy temporarily, the public write boundary becomes clearer.

## 9.2 Good move: insert a compatibility adapter

If old code relies on a messy API, place a compatibility adapter in front of it. This allows new code to depend on the cleaner contract without immediately rewriting the old implementation.

## 9.3 Good move: turn mutable derived state into a projection

If a store is acting like “truth” but is obviously derivable, convert it into a projection over time.

## 9.4 Good move: keep the public shape stable while refactoring internals

If many parts of the codebase depend on an old entry point, keep the entry point and change what it delegates to internally.

## 9.5 Good move: collapse accidental duplication into one owner

If two places appear to own the same business truth, pick one owner and make the other a projection, cache, or adapter.

---

## 10. Canonical migration anti-patterns

## 10.1 Bad move: introduce a new architecture beside the old one

Do not create:

- “new stores” and “old stores” with overlapping truth
- “new commands” and “old direct writes” for the same behavior without a transition plan
- duplicate runtime entry points that drift over time

### Preferred alternative

Introduce one transitional boundary that both old and new code can use.

## 10.2 Bad move: rewrite stable code just to match document vocabulary

Do not rewrite working logic solely so names match the architecture document.

### Preferred alternative

Change names and file shapes only when they improve ownership, safety, or understandability.

## 10.3 Bad move: over-splitting features during migration

Do not split one messy area into five abstract layers unless there is a clear ownership/runtime reason.

### Preferred alternative

Use the smallest structure that restores the boundary.

## 10.4 Bad move: stuffing more logic into compatibility layers forever

A compatibility adapter is a migration tool, not a permanent dumping ground.

### Preferred alternative

Use adapters to stabilize boundaries, then move core behavior behind proper application/domain ownership.

## 10.5 Bad move: migrating reads before writes are understood

If ownership and mutation rules are still unclear, read-model cleanup can create more confusion.

### Preferred alternative

Clarify the write boundary first.

---

## 11. Legacy-to-target mapping examples

## 11.1 Old “repository” concept to new architecture

The old architecture used repositories broadly for I/O and runtime calls.

In the new architecture:

- keep that shape where it remains helpful
- but mentally distinguish between persistence-oriented repositories and runtime adapters
- prefer ports/adapters as the conceptual model
- do not waste time renaming everything immediately

### Migration rule

If an old repository cleanly wraps external I/O, it is acceptable to keep it as-is during migration.

If it mixes:

- business logic
- runtime ownership
- cross-feature mutation
- view concerns

then split those concerns before worrying about the name.

## 11.2 Old use cases to new commands/actions

Old use cases are often already close to the new write model.

### Migration rule

Existing use cases can be retained as the write boundary when they:

- express intent clearly
- own the correct slice
- avoid raw infrastructure calls
- remain framework-free

If needed, wrap them in a more explicit command/action vocabulary later rather than rewriting behavior first.

## 11.3 Old stores to new projections

Existing business-layer stores often already reflect the right “single source of truth” idea.

### Migration rule

Keep authoritative project stores when they already serve that role well.

But:

- stop treating every shared store as authoritative
- demote derived mutable state into projections where possible
- prevent cross-feature writes

## 11.4 Old frontend/backend split to new unified system architecture

The old docs described frontend and backend separately.

### Migration rule

When changing boundaries, think in terms of one system:

- presentation
- application/domain
- projections
- runtime/infrastructure
- engine

Do not design frontend and backend as separate philosophies.

---

## 12. Migration templates

These are not rigid folder laws. They are temporary shapes that work well during convergence.

## 12.1 Minimal stabilization template

Use when a legacy area is messy but behavior is stable.

```text
feature/
  legacy.ts
  action.ts
  adapter.ts
  selectors.ts
```

Purpose:

- keep legacy logic in place
- create a clean write entry point
- isolate outside API usage
- provide read selectors without more mutation leakage

## 12.2 Compatibility wrapper template

Use when many callers depend on an old API.

```text
feature/
  compat.ts
  action.ts
  port.ts
  adapter.ts
```

Purpose:

- preserve old entry point
- delegate to new action
- route external calls through port/adapter
- gradually migrate callers

## 12.3 Runtime-heavy migration template

Use when a feature currently mixes business logic with runtime concerns.

```text
feature/
  domain.ts
  action.ts
  port.ts
  runtimeAdapter.ts
  projection.ts
  telemetry.ts
  legacyCompat.ts
```

Purpose:

- separate truth from runtime execution
- isolate telemetry
- keep a stable compatibility surface while migrating callers

---

## 13. Step-by-step migration workflow for AI agents

When assigned a change in a legacy area, follow this process.

### Step 1: identify the authoritative state

Ask:

- what state is actually the source of truth here?
- what state only mirrors or displays it?
- what state is runtime-only?

If this is unclear, stop and resolve that first.

### Step 2: identify the current write boundary

Ask:

- where does the mutation actually happen?
- is it inside a hook, component, Tauri command, adapter, or helper?
- who should own that mutation?

### Step 3: introduce or strengthen a public action

Create a clear, plain-code write entry point if one does not exist.

### Step 4: isolate external dependencies

Move:

- Tauri calls
- browser APIs
- runtime calls
- storage access
  behind adapters/ports if they are currently mixed into business code.

### Step 5: protect truth from projections

Ensure the authoritative state is updated in one place, and read models merely derive from it.

### Step 6: preserve behavior

Do not change semantics unless the task requires it. Keep UI behavior, runtime behavior, and persistence behavior stable.

### Step 7: improve naming and shape only if it helps

Only after the boundary is cleaner should you consider file or folder cleanup.

---

## 14. Migration checklists

## 14.1 Before editing legacy code

1. What is the source of truth?
2. What kind of state is this?
3. Who currently owns the write?
4. Who should own the write?
5. Does this touch the RT path?
6. Does this touch persistence?
7. Does this touch undo/redo?
8. Can I improve the boundary without rewriting behavior?

## 14.2 Before introducing a new abstraction

1. Is this solving a real boundary problem?
2. Is this the smallest abstraction that works?
3. Is it temporary migration scaffolding or intended core architecture?
4. Can old and new code both use it safely?
5. Will it reduce illegal dependencies?

## 14.3 Before moving code across layers

1. Am I moving business logic out of presentation or shell code?
2. Am I moving runtime ownership out of UI code?
3. Am I improving write authority?
4. Am I making testing easier?
5. Am I preserving the existing external behavior?

## 14.4 Before touching runtime-adjacent code

1. Could this allocate or block?
2. Is this a parameter change or topology change?
3. Should this be telemetry instead of project truth?
4. Is this better as an adapter boundary?
5. Have I preserved RT-safe assumptions?

---

## 15. Recommended enforcement during migration

The migration goes faster when bad patterns become harder to introduce.

Recommended guardrails:

- lint rules for forbidden imports across layers
- lint rules against direct Tauri/browser I/O in application/domain code
- lint rules against React imports in business code
- tests for business logic outside React/Tauri
- tests around adapters rather than inside views
- selective CI checks for known architectural hotspots

Do not block all progress on perfect enforcement immediately. Add guardrails where drift is most costly.

---

## 16. What “done” looks like for a migrated area

A legacy area is considered meaningfully migrated when:

- authoritative state ownership is clear
- writes go through an explicit action/command
- runtime state is no longer stored in UI/business state
- external APIs are hidden behind adapters/ports
- projections are read-only and derivable
- React or Tauri no longer own core business logic
- behavior is preserved or intentionally improved
- further cleanup can happen incrementally without re-breaking the boundary

A migrated area does not need:

- perfect folder symmetry
- fully renamed files
- full rewrite into idealized templates
- total removal of compatibility shims on day one

---

## 17. Summary

Migrate legacy code by improving boundaries, not by chasing aesthetic purity.

The order is:

1. classify the state and ownership
2. isolate the write boundary
3. isolate infrastructure and runtime dependencies
4. separate truth from projections
5. simplify shape only after behavior is safe

The central rule is:

**make the next change safer and more explicit than the previous one.**

That is successful migration.
