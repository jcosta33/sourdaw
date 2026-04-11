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

2. **Inject ceremony removal** — remove `inject()` where it only wrapped plain
   imports (no real test seam). **Keep** `inject({ logger })`, `inject({ eventBus })`,
   and similar **container** deps where intentional.

These are the same root cause viewed from two angles: over-aggregated barrels
amplify circular-dependency blast radius; ceremonious `inject()` evaluated
cross-module deps at module load time, which turned barrel cycles into TDZ
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

**Tier done (module-root `index.ts` removed in this pass):** VirtualKeyboard,
SoundLibrary, Knead (added `stores/index.ts`, `useCases/index.ts`), ProofChamber,
Sampler, Crust, Bacteria, Gluten, Grinder, GrandBoule, Scoring — consumers now
import from `#/modules/<M>/(stores|useCases|presentations/views)` as appropriate.

**Already migrated earlier (no root barrel):** Arrangement, AudioEngine, Transport,
Command, and the majority of hub modules per `git` history / contract folders.

**Root barrels still present** — only these two remain:

| Module | Next step |
| --- | --- |
| **Automation** | Replace `#/modules/Automation` imports with `#/modules/Automation/stores` (e.g. `automationStore`) and `#/modules/Automation/useCases` (everything else). Then delete `Automation/index.ts`. |
| **Project** | Split `#/modules/Project` imports into `…/stores`, `…/useCases`, `…/presentations/views` (see existing contract-folder barrels). Update dynamic `import('#/modules/Project')` in `projectCommands.ts` to target `…/useCases`. Then delete `Project/index.ts`. |

Verify stragglers:

```bash
find src/modules -maxdepth 2 -name "index.ts" | grep -v "/useCases\|/stores\|/events\|/presentations"
# Expect: Automation/index.ts, Project/index.ts until those two are migrated.
```

### Migration order (suggested tiers)

**Done / in progress:** Tier-1 hubs and most feature modules (see table above).

**Remaining:** Eliminate each root `index.ts` in the `find` output by moving
exports into contract-folder `index.ts` files and updating cross-module imports.

### Per-module checklist

For each module:
1. Ensure `useCases/index.ts`, `stores/index.ts`, `events/index.ts`, `presentations/views/index.ts` exist (whichever apply).
2. Classify each export from the root barrel into the right contract folder.
3. Update all cross-module consumers.
4. Delete root `index.ts`.
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

### Status (2026-04-11)

**Done (representative):** Plain `inject({})` / fake thunk deps removed; large
`*Dependencies` objects inlined for scheduling, collaboration session, MIDI
routing, pattern instances, scale velocities, Toaster bridges, Gluten/Crust/
Sampler/ProofChamber bridges, `executeDsos`, `polyphonicAudioToMidi`,
`generateMentorLessons`, etc. `addTrack` / `removeTrack` / zoom / setlist now
inject only **`eventBus`** where needed; Faust injects only **`logger`**.

**Rule of thumb:** Prefer **direct imports** for normal collaborators. **Keep**
`inject({ logger })`, `inject({ eventBus })`, and similar **container** deps.

**Still using non-trivial `inject` (manual follow-up when touching those files):**

| Area | Notes |
| --- | --- |
| `offlineRender.ts` | `renderOffline` / `exportStems` — large dep map (lazy/cycle-related) |
| `messageHandlers.ts` | MIDI handlers — `midiMessageHandlerDependencies` |
| Fermenter / Grinder / Bacteria / Levain | `*ParamBridge` inject bundles |
| `devicePanels.ts` | Many `inject({ eventBus })` panel toggles (acceptable) |

**Codemod:** `codemods/remove-inject-non-container.ts` (and related scripts) for
bulk removal of plain-deps `inject`; re-run when adding new use cases.

**Tests:** After removing inject from a function, drop tests that only assert
`injectDependencies` forwarding; use `vi.mock` on modules or test real behavior.

### Legacy metrics (pre-cleanup — do not use for planning)

Earlier snapshots cited ~551 inject sites and ~287 single-dep candidates; counts
are obsolete after the cleanup passes. Re-count with `rg 'inject\\(' src` if
needed.

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
