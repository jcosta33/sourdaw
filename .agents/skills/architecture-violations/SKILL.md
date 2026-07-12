---
name: architecture-violations
description: >-
  Fix architecture violations by establishing the real boundary, not by gaming
  the validator. ALWAYS apply when a dependency-boundary check flags a violation,
  when restructuring a module or moving logic across layers, introducing a public
  surface, or auditing real-vs-cosmetic boundary compliance — even if the validator
  already passes. Do not silence a violation by re-exporting through a barrel,
  faking a use case, renaming files, or dumping logic into shared/helper escape
  hatches. Skip net-new feature work inside an already-correct boundary,
  dependency upgrades, and non-architectural bug fixes.
---

## Purpose

This skill guards against architectural drift: shortcut refactors, validator gaming, and code that passes the rules without preserving their meaning. A boundary that exists only to satisfy `pnpm deps:validate` is worse than no boundary — it hides the coupling it was supposed to expose. For authoring new code on the right side of the line, use `architecture`.

## Core rules

### 1. Fix the violation properly — never hack around the rules

If a violation exists, establish the proper architecture so the code flows through the right boundary. Never: change validation rules to silence findings; create non-contract barrels; move code into a fake use case/action/projection just to make imports legal; rename past the validator; dump forbidden logic into `src/helpers/`, `src/shared/`, or `utils/` (`helpers-no-module-imports`, `shared-no-module-imports`, `utils-no-module-imports`); micro-split or mega-file without better ownership; keep unauthorized mutation behind an allowed import path.

**Why:** the architecture encodes non-negotiable DAW constraints. A green check that re-introduces the hazard — now invisible — is a regression.

### 2. A boundary is only real if responsibility changes across it

Real compliance improves or preserves ownership, write discipline, runtime isolation, testability, truth-vs-projection separation, framework independence of business logic, and real-time safety. Pass-through laundering and renamed entry points with the same coupling are fake compliance.

**Why:** if a layer exists only to satisfy the validator while the logic still lives in the wrong place, the architectural meaning did not improve.

### 3. Stop after three failed attempts; reread the contracts

Three failed fix or compile attempts → stop, discard the approach, reread module contracts, choose a different strategy.

**Why:** repeated local patches on a wrong abstraction become shadow architecture faster than they converge.

### 4. Trace the blast radius before and after every move

Trace upstream callers and downstream dependencies. Use `pnpm typecheck` as the exhaustive blast-radius tool.

**Why:** moving a symbol across a boundary breaks consumers you did not look at.

### 5. Route every cross-module access through a contract-folder barrel

Up to four surfaces: `useCases/`, `stores/`, `events/`, `presentations/views/`. No module-root `index.ts`. Same-module files use relative paths. Rules: `cross-module-index-only`, `contract-barrel-scope`, `no-self-barrel-import`.

**Why:** the barrel is the only curated public surface; deep imports erase ownership.

### 6. A use case is a typed function, not a re-export — types stay local

```typescript
// ❌ laundering
export { getNextClipId } from '../repositories/clipIdCounter';

// ✅ real boundary (thin body OK)
export function getNextClipId(): string {
    return allocateClipIdFromCounter();
}
```

Other modules import **functions** from `#/modules/<M>/useCases`, not types. No `export type` on `useCases/index.ts` (`no-usecase-type-exports-on-index`). Cross-module named types travel via `events/` payloads or `Store<T>`’s `T`.

**Why:** a re-export passes the validator while the consumer still couples to the private symbol under a new path.

### 7. One function per use-case file

A multi-export wrapper over a repository is a barrel in disguise. Split to one function per file, each with a real typed signature.

**Why:** multi-export wrappers recreate the laundering surface contract barrels exist to prevent.

### 8. Protect pure layers and RT paths when remediating

Do not “fix” `business-no-presentations`, `repositories-no-business`, `models-are-pure`, `events-are-pure`, or worklet rules by path tricks. Prefer a real move. RT-adjacent code must not gain alloc/lock/UI/shell leakage.

**Why:** pure-layer and RT rules exist because the wrong dependency is a product hazard, not a style preference.

### 9. One owner per authoritative write; shim markers stay until real

Multiple features casually mutating shared state destroy undo semantics. Removing `TEMPORARY MIGRATION SHIM` from a pure re-export without creating a real typed boundary is malicious compliance — leave the marker if the refactor is incomplete.

**Why:** shared state without ownership becomes corruption; deleting the marker hides remaining laundering.

## What does not belong

- Stack-specific or vendor patterns unrelated to module boundaries.
- Net-new product behavior inside an already-correct boundary.
- Dependency upgrades or non-architectural bug fixes.
- Silencing `pnpm deps:validate` by editing rules or bloating known-violations without an intentional debt decision.

## Anti-patterns

### CRITICAL — Re-export laundering

❌ Wrong: `export { getX } from '../repositories/Y'` in a use-case file so the import path is “legal”.

✅ Correct: a typed function in its own file that owns the operation (thin `return repo…` body is fine).

### CRITICAL — Non-contract export on a barrel

❌ Wrong: `useCases/index.ts` re-exports a model, repository, or store.

✅ Correct: each contract barrel re-exports only from its own folder (`contract-barrel-scope`, `no-models-repos-transformers-in-index`).

### CRITICAL — Gaming a pure-layer rule

❌ Wrong: rename or move a file so `business-no-presentations` / `repositories-no-business` no longer matches, with no ownership change.

✅ Correct: move the responsibility to the layer that should own it.

### HIGH — Cross-module use-case type import

❌ Wrong: `import type { AddTrackInput } from '#/modules/Arrangement/useCases'`

✅ Correct: local type, `ReturnType`/`Parameters`, or an `events/` payload type.

### HIGH — Multi-export wrapper file

❌ Wrong: one use-case file exporting many thin repo wrappers.

✅ Correct: one function per file (rule 7).

### MEDIUM — Same-module barrel import

❌ Wrong: Arrangement code imports `#/modules/Arrangement/useCases`.

✅ Correct: relative import to the defining file.

## References

- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — contract-folder barrels and public surface.
- `.dependency-cruiser.cjs` — main boundary rules. `pnpm deps:validate` also runs reachability, types, and tests cruises.
