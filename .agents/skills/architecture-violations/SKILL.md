---
name: architecture-violations
description: >-
  Fix architecture violations by establishing the real boundary, not by gaming
  the validator. ALWAYS apply when a dependency-boundary check flags a violation,
  when restructuring a module or moving logic across layers, introducing a public
  surface, or auditing real-vs-cosmetic boundary compliance — even if the validator
  already passes. Skip net-new feature work inside an already-correct boundary,
  dependency upgrades, and non-architectural bug fixes.
---

## Purpose

This skill guards against architectural drift: shortcut refactors, validator gaming, and code that passes the rules without preserving their meaning. A boundary that exists only to satisfy `pnpm deps:validate` is worse than no boundary — it hides the coupling it was supposed to expose.

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

### 5. Restore the contract barrel — never route around it

Cross-module access goes through the four contract barrels and their rules (`architecture` rules 1–2: `cross-module-index-only`, `contract-barrel-scope`, `no-self-barrel-import`). Fix barrel violations by re-establishing that surface, not by inventing new barrels or escape hatches.

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

Do not “fix” `business-no-presentations`, `repositories-no-business`, model/event/service/validator/transformer purity, or worklet isolation by path tricks. Prefer a real move. Worklet depcruise rules only apply when code lives under `src/modules/<M>/worklets/**` (often unexercised). RT-adjacent code must not gain alloc/lock/UI/shell leakage.

**Why:** pure-layer and RT rules exist because the wrong dependency is a product hazard, not a style preference.

### 9. One owner per authoritative write; shim markers stay until real

Multiple features casually mutating shared state destroy undo semantics. Removing `TEMPORARY MIGRATION SHIM` from a pure re-export without creating a real typed boundary is malicious compliance — leave the marker if the refactor is incomplete.

**Why:** shared state without ownership becomes corruption; deleting the marker hides remaining laundering.

## What does not belong

- Silencing `pnpm deps:validate` by editing rules or refreshing an exact baseline without an intentional debt decision. New and stale baseline rows both fail.

## Anti-patterns

### HIGH — Cross-module use-case type import

❌ Wrong: `import type { AddTrackInput } from '#/modules/Arrangement/useCases'`

✅ Correct: local type, `ReturnType`/`Parameters`, or an `events/` payload type.

## References

- [docs/architecture/05-boundary-enforcement-limits.md](../../../docs/architecture/05-boundary-enforcement-limits.md) — laundering patterns and their closures.
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — contract-folder barrels and public surface.
- `.dependency-cruiser.cjs` + `scripts/check-dependency-boundaries.mjs` — main rules and exact main/reachability/type/test debt ratchet.
