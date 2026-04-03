# Module Migration Agent Prompt

You are assigned to migrate **one DDD module only** in a large DAW codebase from the **original architecture** to the **new architecture**.

Your assigned module is:

**`<MODULE_NAME>`**

You must refactor **only this module’s internals** toward the new architecture while preserving **external stability** for the rest of the codebase.

---

## 1. Primary objective

Make **`<MODULE_NAME>`** internally conform much more closely to the new architecture **without breaking existing cross-module imports**.

This is a staged migration.

You are **not** doing the final global cleanup.
You are **not** rewriting imports across the rest of the codebase.
You are **not** deleting legacy external paths that other modules may still depend on.

---

## 2. Architecture context

You must follow these documents as the source of truth:

- **DAW System Architecture**
- **TypeScript Module Architecture**
- **Migration Architecture**
- **Architecture Violations skill**
- **docs/conventions.md**

Key ideas to preserve:

- the project model is the source of truth
- business logic is React-free
- writes happen through explicit public use cases/actions/commands
- repositories remain the TypeScript I/O boundary
- projections/selectors/stores are read-oriented
- runtime state must not leak into UI/business state
- Tauri is a bridge, not the core
- real-time safety is absolute

---

## 3. Scope

You may:

- refactor the internals of **`<MODULE_NAME>`**
- create a cleaner canonical internal structure
- move logic to more correct layers
- introduce or strengthen explicit public use cases/actions
- isolate repositories/adapters/runtime code where needed
- improve state ownership and write paths
- split oversized files when responsibility becomes clearer
- add thin temporary migration shims at old public paths

You must not:

- broadly refactor unrelated modules
- rewrite imports across the rest of the codebase
- delete legacy public paths that external callers may still use
- widen the public surface of the module
- add real logic to temporary compatibility shims
- use the migration as cover for unrelated product changes
- “improve” architecture by renaming concepts without fixing real boundaries

---

## 4. What a module is

Treat **`<MODULE_NAME>`** as a **DDD module / bounded context / ownership boundary**.

Do **not** think of it as a lightweight UI feature slice.

Your job is to improve:

- ownership of truth
- write boundaries
- dependency direction
- runtime isolation
- presentation/business separation

---

## 5. Legacy import compatibility rule

This is critical.

Because the codebase is being migrated **module by module**, you must preserve existing external import paths used by other modules.

That means:

- you may move the real implementation internally
- but you must preserve the old external path using a **thin temporary migration shim**
- the shim must only re-export the migrated implementation
- the shim must contain **no business logic**
- the shim must not expose anything new that was not already part of the old external contract

### Allowed example

~~~typescript
/**
 * TEMPORARY MIGRATION SHIM
 *
 * Preserves the legacy external import path during module-by-module migration.
 * Remove after the global import convergence pass.
 */
export { addTrack } from '../application/actions/addTrack';
~~~

### Forbidden examples

- adding logic to the shim
- exporting new private internals through the old path
- creating new convenience exports during migration
- using shims to bypass real architecture boundaries

---

## 6. Public contract surface to preserve

For TypeScript modules, the legacy/public contract surface is:

~~~text
errors/
events/
useCases/
stores/
presentations/views/
~~~

If other modules currently import from these paths in **`<MODULE_NAME>`**, those imports must keep working after your refactor.

Private internals may be reorganized much more freely.

---

## 7. Non-negotiable coding style for this migration

### 7.1 Business layer uses `function` declarations

In the business layer, prefer the `function` keyword over arrow-function exports.

This applies especially to:

- `useCases/`
- `validators/`
- `services/`
- `transformers/`
- business-layer helpers
- pure domain logic

Examples:

~~~typescript
export function addTrack(input: AddTrackInput): void {
    ...
}

export function validateClipPlacement(input: ValidateClipPlacementInput): void {
    ...
}

export function transformTrackToEngineConfig(track: Track): TrackEngineConfig {
    ...
}
~~~

Avoid this style in the business layer unless there is a strong local reason:

~~~typescript
export const addTrack = (input: AddTrackInput): void => {
    ...
};
~~~

### 7.2 Presentation layer follows React conventions

In the presentation layer, follow the project’s React conventions from `conventions.md`.

That means in particular:

- React is presentation only
- no business logic in components or hooks
- no `useEffect` for fetching
- no `useEffect` for derived state
- no manual memoization (`useMemo`, `useCallback`, `React.memo`)
- no `forwardRef`
- prefer plain React 19 patterns
- use TanStack Query for fetching
- use React Hook Form for forms
- keep hooks thin
- use explicit control flow
- no `&&` rendering shortcuts
- return `ReactElement`
- use type-only imports
- use named exports

If a presentation file is touched, bring it closer to these conventions.

### 7.3 Classes vs functions

Use **functions by default** in the TypeScript business layer.

Use **classes only** where there is real runtime/lifecycle ownership, such as:

- engine/runtime objects
- long-lived plugin/native handles
- explicit initialization/disposal
- runtime controllers

Do **not** introduce classes for ordinary business/domain/application logic.

---

## 8. Architectural goals for this migration

While refactoring **`<MODULE_NAME>`**, optimize for:

- clearer ownership of authoritative state
- explicit public write boundaries
- better separation between:
  - presentation
  - application/write layer
  - domain helpers/rules
  - projections/read state
  - repositories/I/O
  - runtime/infrastructure
- React-free business logic
- no hidden write paths through stores/selectors/helpers
- better runtime isolation
- improved testability
- preserved behavior
- preserved external import stability

Do not optimize for:

- shortest diff
- fewest files touched
- folder cosmetics without boundary improvement
- immediate codebase-wide canonical imports
- deleting all old structure immediately
- pure terminology cleanup without architectural benefit

---

## 9. Concepts to use correctly

Use these concepts as defined in the architecture docs:

- **models/** = plain business types
- **errors/** = public meaningful errors
- **events/** = public meaningful business occurrences
- **useCases/** = public write boundary
- **stores/** = public business/shared store surface
- **validators/** = private invariant checks
- **services/** = private stateless domain logic
- **repositories/** = private TypeScript I/O boundary
- **transformers/** = private pure mapping functions
- **presentations/views/** = public UI entry points
- **presentations/hooks/** = private presentation bindings
- **presentations/context/** = private ephemeral UI state
- **presentations/stores/** = private persistent UI preferences
- **presentations/components/** = private UI pieces
- **presentations/renderers/** = private presentation-layer drawing/I/O
- **engine/runtime/worklets/** = private runtime internals

Do not invent alternate meanings for these.

---

## 10. Required migration process

Follow this order.

### Step 1: inspect the module first

Identify:

- current public/external paths used by other modules
- current internal layering problems
- state ownership problems
- hidden write paths
- UI/business/runtime leakage
- oversized files
- repositories that contain business logic
- hooks/components that own business behavior
- runtime objects leaking into stores or presentation

### Step 2: identify truth, reads, and runtime

Answer:

- what is the authoritative truth in this module?
- what is projection/read state only?
- what is runtime state only?
- who currently writes truth?
- who should write truth?

### Step 3: decide the target internal shape

Choose the **smallest improved internal structure** that meaningfully restores boundaries.

Do not blindly mirror a template.
Do not over-split.
Do not create ceremony for its own sake.

### Step 4: refactor internals

Move the module toward the target architecture:

- presentation stays presentation-only
- business writes go through explicit public use cases/actions/commands
- business-layer functions use the `function` keyword by default
- repositories become thinner and more honest
- validators/services/transformers stay private
- stores stop acting as hidden write APIs
- runtime state is isolated from UI/business code
- selectors/projections stay read-oriented
- presentation code follows React 19 + project conventions

### Step 5: preserve legacy external paths

For every old external path that may still be imported elsewhere:

- keep it working with a thin migration shim if needed
- do not widen the public surface
- do not place logic in the shim

### Step 6: verify behavior and architecture

Check that:

- the module still works
- external callers should not break
- boundaries are cleaner
- no fake compliance was introduced
- no compatibility shim contains real logic

---

## 11. Anti-cheating rules

Do not do any of the following:

- barrel-export laundering of private internals
- fake use-case files that only rename a bad helper without fixing ownership
- giant files that still mix multiple architectural roles
- moving forbidden logic into `src/helpers`, `src/shared`, `utils`, or other escape hatches
- selector/projection-side mutation
- store-as-service laundering
- hook-owned business logic
- repository-owned business workflows
- Tauri-command-owned business logic
- runtime-object leakage into UI/business stores
- compatibility shims that become permanent shadow architecture
- widening the old public surface “while you are here”

A boundary is only real if responsibility changes across it.

---

## 12. Specific things to look for

You should actively look for and fix cases where:

- React components or hooks mutate project truth directly
- cross-module store mutation bypasses the owning module’s public use case
- repositories call event buses or mutate truth
- validators or services are imported cross-module
- `AudioNode`, plugin handles, engine objects, or native handles are stored in React/state/store truth
- telemetry is treated as project truth
- renderers own business logic
- presentation stores are imported cross-module
- direct Tauri/browser I/O happens in use cases or presentation code
- old helpers have become shadow architecture

---

## 13. Output expectations

You should produce:

1. the refactored code for **`<MODULE_NAME>`**
2. any thin temporary migration shim files needed to preserve old external imports
3. a short summary describing:
   - what was refactored
   - what compatibility shims were added
   - what architectural improvements were made
   - any remaining limitations or deferred cleanup inside this module

---

## 14. Final checklist

Before finishing, verify:

- only **`<MODULE_NAME>`** was meaningfully refactored
- unrelated modules were not broadly rewritten
- old external imports into **`<MODULE_NAME>`** should still work
- compatibility shims are thin and honest
- no new public surface was added without need
- state ownership is clearer
- the public write boundary is more explicit
- presentation/business/runtime separation improved
- repositories are more honest as I/O boundaries
- business-layer code prefers `function` declarations
- touched presentation code follows the project’s React conventions
- behavior was preserved

---

## 15. Assigned module

**`<MODULE_NAME>`**

Begin the migration now.