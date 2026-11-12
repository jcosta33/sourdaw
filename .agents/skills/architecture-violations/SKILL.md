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

This skill guards against validator gaming: code that passes the rules without preserving their meaning. A boundary that exists only to satisfy `pnpm deps:validate` is worse than no boundary — it hides the coupling it was supposed to expose.

## Core rules

### 1. Fix the violation properly — never hack around the rules

Establish the architecture so the code flows through the right boundary. Never: edit validation rules to silence findings; refresh an exact baseline without an intentional debt decision (new and stale baseline rows both fail); create non-contract barrels; move code into a fake use case, action, or projection to make an import legal; rename past the validator; dump forbidden logic into `src/helpers/` or `utils/` (`helpers-no-module-imports`, `utils-no-module-imports`); micro-split or mega-file without better ownership; keep unauthorized mutation behind an allowed import path.

**Why:** the architecture encodes non-negotiable DAW constraints. A green check that re-introduces the hazard — now invisible — is a regression.

Cycles have two checks with different reach. File-level `no-circular` (**error**) sees files, not modules. The `moduleTiers` gate (`.dependency-cruiser.module-tiers.cjs`, run inside `pnpm deps:validate`) sees module-level cycles and upward tier edges in non-presentation production code, and accepts only the manifest's reasoned `allowedCycles` and `acceptedTierEdges` rows — it has no baseline to refresh, so a new allowance is a manifest entry argued in review, and a module's tier is never changed to fit its imports. A module cycle that closes through a view or other `presentations/` code is outside both checks, so a green `deps:validate` still does not prove the presentation-inclusive module graph acyclic.

### 2. A boundary is only real if responsibility changes across it

Real compliance improves or preserves ownership, write discipline, runtime isolation, testability, truth-vs-projection separation, framework independence of business logic, and real-time safety. Pass-through laundering and renamed entry points with the same coupling are fake compliance.

**Why:** a layer that satisfies the validator while the logic still lives in the wrong place changed nothing architectural.

### 3. Stop after three failed attempts; reread the contracts

Three failed fix or compile attempts → discard the approach, reread the module contracts, choose a different strategy.

**Why:** repeated local patches on a wrong abstraction become shadow architecture faster than they converge.

### 4. Trace the blast radius before and after every move

Trace upstream callers and downstream dependencies. CI's TypeScript typechecks provide the exhaustive compiler check; inspect their result on the pull request.

**Why:** moving a symbol across a boundary breaks consumers you did not look at.

### 5. Restore the contract barrel — never route around it

Cross-module access goes through the contract barrels and their rules (`architecture` rules 1–2: `cross-module-index-only`, `contract-barrel-scope`, `no-internal-barrel-import`). Fix a barrel violation by re-establishing that surface, not by inventing new barrels or escape hatches.

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

Other modules import **functions** from `#/modules/<M>/useCases`, never types (`no-usecase-type-exports-on-index`). Cross-module named types travel via `events/` payloads or `Store<T>`’s `T`; otherwise use a local type or `ReturnType`/`Parameters`.

**Why:** a re-export passes the validator while the consumer still couples to the private symbol under a new path.

### 7. One function per use-case file

A multi-export wrapper over a repository is a barrel in disguise. Split to one function per file, each with a real typed signature.

**Why:** multi-export wrappers recreate the laundering surface contract barrels exist to prevent.

### 8. Protect pure layers and RT paths when remediating

Never “fix” `business-no-presentations`, `repositories-no-business`, model/event/service/validator/transformer purity, or worklet isolation by path tricks — make the real move. Worklet depcruise rules apply only to code under `src/modules/<M>/worklets/**`. RT-adjacent code must not gain alloc, lock, UI, or shell leakage.

**Why:** pure-layer and RT rules exist because the wrong dependency is a product hazard, not a style preference.

### 9. One owner per authoritative write; a re-export is not a boundary

Multiple features casually mutating shared state destroy undo semantics. Each authoritative write has one owning module. A pure re-export that hands another module that write is laundering until a real typed boundary replaces it (rule 6); renaming or relocating the re-export changes nothing.

**Why:** shared state without ownership becomes corruption, and a re-export that passes the validator hides the second writer instead of removing it.

## References

- [docs/architecture/05-boundary-enforcement-limits.md](../../../docs/architecture/05-boundary-enforcement-limits.md) — laundering patterns and their closures.
- [docs/architecture/03-typescript-module.md](../../../docs/architecture/03-typescript-module.md) — contract-folder barrels and public surface.
- `.dependency-cruiser.cjs` + `scripts/check-dependency-boundaries.mjs` — main rules and exact main/reachability/type/test debt ratchet.
- `.dependency-cruiser.module-tiers.cjs` — module tier manifest for the baseline-free `moduleTiers` gate ([docs/architecture/03-typescript-module.md §7.5](../../../docs/architecture/03-typescript-module.md#75-module-tiers)).
