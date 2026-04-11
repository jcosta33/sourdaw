---
title: Module surface simplification — contract-folder barrels + inject ceremony removal
date: 2026-04-11
status: in-progress
supersedes:
  - index-ts-boundary-audit.md (root-barrel migration, now contract-folder stage)
  - inject-orchestration-opportunities.md (inverted: remove over-injection)
  - di-migration-audit.md (migration complete; now pruning ceremony)
  - circular-dependencies-barrels.md (barrel cycles; root cause is the same migration)
related-specs:
  - .agents/specs/contract-folder-barrels.md
---

# Module surface simplification

Two interdependent structural cleanups:

1. **Contract-folder barrels** — split every module's root `index.ts` into four
   independently-importable contract folders (`useCases/`, `stores/`, `events/`,
   `presentations/views/`), delete the root barrel, and hardline the depcruiser
   rules to enforce it.

2. **Inject ceremony removal** — the `inject()` pattern was applied to ALL use
   cases. Most are pure delegation with no logic, no test coverage, and TDZ risk.
   Remove it everywhere it adds no value; document precisely when it must stay.

These are the same root cause viewed from two angles: over-aggregated barrels
amplify circular-dependency blast radius; ceremonious `inject()` evaluates
cross-module deps at module load time, which turns barrel cycles into TDZ
crashes. Fixing both together cleans the cycle graph and makes the remaining
`inject()` sites intentional.

---

## Part 1 — Contract-folder barrel migration

### Goal

Every module exposes exactly four importable surfaces:

```
#/modules/<M>/useCases    → use case functions
#/modules/<M>/stores      → store instances + state types
#/modules/<M>/events      → event payload types
#/modules/<M>/presentations/views → cross-module UI
```

Root `index.ts` is deleted. `cross-module-index-only` depcruiser rule is
hardened from transitional regex to contract-folder-only once migration
is complete. `no-circular` flips from `warn` → `error`.

### Current state

Modules fully migrated (root barrel deleted):

| Module | Status |
| --- | --- |
| Arrangement | ✅ done |
| AudioEngine | ✅ done |
| Transport | ✅ done |
| Command | ✅ done |

Modules with remaining bare root imports (sorted by count):

| Module | Bare imports remaining |
| --- | --- |
| MIDI | 74 |
| Automation | 39 |
| Workspace | 32 |
| AiRuntime | 24 |
| Project | 17 |
| Plugin | 17 |
| AudioAnalysis | 14 |
| CrdtDocument | 11 |
| AiGeneration | 10 |
| Routing | 8 |
| Synth | 7 |
| Collaboration | 7 |
| Levain | 5 |
| Toaster | 4 |
| Fermenter | 4 |
| Yeast | 3 |
| SampleLibrary | 3 |
| Proof | 3 |
| Scoring | 2 |
| Grinder | 2 |
| GrandBoule | 2 |
| Gluten | 2 |
| Bacteria | 2 |
| VirtualKeyboard | 1 |
| SoundLibrary | 1 |

### Migration order (suggested tiers)

**Tier 2** (high impact, many consumers): MIDI (74), Automation (39), Workspace (32)
**Tier 3** (medium): AiRuntime (24), Project (17), Plugin (17), AudioAnalysis (14)
**Tier 4** (small): CrdtDocument, AiGeneration, Routing, Synth, Collaboration, Levain, Toaster, Fermenter
**Tier 5** (tail): Yeast, SampleLibrary, Proof, Scoring, Grinder, GrandBoule, Gluten, Bacteria, VirtualKeyboard, SoundLibrary

### Per-module checklist

For each module:
1. Create `useCases/index.ts`, `stores/index.ts`, `events/index.ts`, `presentations/views/index.ts`
2. Classify each export from the root barrel into the right contract folder
3. Update all cross-module consumers (use agents for bulk)
4. Delete root `index.ts`
5. Run `pnpm typecheck && pnpm deps:validate`

### Symbol classification rules

| Symbol type | Contract folder |
| --- | --- |
| Use case functions (action, query, command) | `useCases/` |
| Store instances (`fooStore`) | `stores/` |
| Store state default values | `stores/` — ONLY if defined in a `stores/` source file; otherwise `useCases/` |
| Store state types (`FooState`) | `stores/` |
| Event payload types (`FooPayload`) | `events/` |
| React view components | `presentations/views/` |
| React hooks (cross-module) | `presentations/views/` |

### Depcruiser hardening (after all modules migrated)

1. Remove the `TRANSITIONAL` comment and dual regex from `cross-module-index-only`
2. Change `no-circular` severity from `warn` → `error`
3. Remove `contract-barrel-scope` transitional note

---

## Part 2 — Inject ceremony removal

### Problem

`inject()` was applied to ALL use cases regardless of whether they have:
- Real orchestration logic worth testing in isolation
- An actual spec using `injectDependencies()`

Result: ~287 single-dep delegation wrappers, 90 files with inject but no spec, and
TDZ crashes when barrel evaluation order is unfavourable.

### Rule (replaces §4.10 table in 03-typescript-module.md)

**Keep `inject()` when ALL are true:**
1. The function has **real logic** — conditional branches, transformations, or
   coordination across **two or more** collaborators that is worth unit-testing
   in isolation.
2. A spec **exists or is planned** that tests that logic with `injectDependencies()`.

**Remove `inject()` when ANY is true:**
- The function body is a **pure delegation** — it just calls one dep with the
  same or trivially mapped arguments.
- The function is a **pass-through adapter** whose only purpose is to make an
  import available under a different name.
- There is **no spec** that overrides the deps via `injectDependencies()`.
- The function has a **single dep** and no branching logic.

### Codemod scope

`codemods/remove-inject-ceremony.ts` targets the mechanically safe case:

```ts
// BEFORE — single dep, body only calls dep
export const foo = inject({ fooImpl })(({ fooImpl }) =>
    function foo(a: A, b: B): R {
        return fooImpl(a, b);
    }
);
```

```ts
// AFTER
export function foo(a: A, b: B): R {
    return fooImpl(a, b);
}
```

The codemod detects this pattern when:
- Exactly one dep in the inject map
- The inner function body is a single `return` statement
- The callee is the injected dep (or `dep.method`)
- Arguments are passed through directly (no construction, no conditional)

Run as dry-run first, review output, then apply.

```bash
# Dry run
pnpm jscodeshift -t codemods/remove-inject-ceremony.ts src/ -d -p --extensions=ts,tsx

# Apply
pnpm jscodeshift -t codemods/remove-inject-ceremony.ts src/ --extensions=ts,tsx
```

### Cases requiring manual review (multi-dep, complex body)

Files where inject wraps complex orchestration — keep inject:

- `scheduleMidiNotes.ts` — 8+ collaborators, heavy branching
- `messageHandlers.ts` — 6 collaborators, MIDI dispatch logic
- `addTrack.ts` — eventBus + state + repos
- `recording.ts` — multiple cross-module deps
- All `*Handlers.ts` registries — multi-dep event dispatch

Files where inject wraps trivial delegation — remove manually after codemod:

- `pluginBrowserActions.ts` — 2 wrappers, each just calls one impl
- `panelToggles.ts` — 33 wrappers (largest ceremony file after `timelineViewActions.ts`)
- `timelineViewActions.ts` — 36 wrappers, each forwarding to a single impl

### Impact on tests

After removing inject from a function:
- Delete the `injectDependencies(fn, { impl: vi.fn() })` test that only checks
  forwarding. These tests assert that inject works, not that the function has correct logic.
- If the function's logic needs testing, convert to `vi.mock` on the dep module OR
  pass deps as function parameters with defaults.

### Current metrics

| Metric | Count |
| --- | --- |
| Total inject sites | 551 |
| Single-dep inject (codemod candidates) | ~287 |
| Files with inject, no spec | 90 |
| `injectDependencies` test uses | 633 |
| Tests that only verify forwarding | est. ~200 |

---

## Shared validation

After each batch of changes:
```bash
pnpm typecheck          # zero errors
pnpm deps:validate      # zero violations
```

After full migration (both tasks complete):
```bash
# Verify no root barrels remain
find src/modules -maxdepth 2 -name "index.ts" | grep -v "/useCases\|/stores\|/events\|/presentations"
# Should return empty (only contract-folder index.ts files remain)
```
