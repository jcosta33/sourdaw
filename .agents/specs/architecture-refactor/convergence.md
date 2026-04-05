# Architecture Migration — Global Convergence Pass

**Owner:** Team Platform (`@sourdaw/team-platform`)
**Type:** Migration (cross-cutting)
**Depends on:** All seven team migration branches merged into main

---

## 1. Context

The module-by-module architecture migration (teams 1–7) was deliberately staged: each team improved their modules' internal boundaries while preserving the old external import paths through thin compatibility shims. This was intentional — it allowed parallel migration without merge conflicts.

That staging is now complete. This is the second and final phase: the global convergence pass. It is a **maximal compliance** operation. Its goal is not just to remove the temporary shims — it is to eliminate every pattern that creates false abstraction boundaries without adding domain logic:

- **Annotated migration shims** — files tagged `TEMPORARY MIGRATION SHIM`, created explicitly to preserve old import paths during the parallel migration. These are the easiest to find.
- **Barrel files** — `index.ts` files and pseudo-barrels (`contracts.ts`, `public.ts`, etc.) that re-export internals. `AGENTS.md` forbids these unconditionally. Every one that exists is a hole in the module boundary.
- **Lazy aliases** — non-shim files whose only content is `export { X } from './deep/internal'` or `export * from './something'`. These are unannotated shims: they do the same damage but were never marked for removal.
- **Pass-throughs** — use case or store files that add zero domain logic: they import from a repository (or another module) and re-export or immediately return its output with no transformation, validation, or orchestration. A use case that adds nothing is not a use case — it is misdirection.
- **Cross-module violations** — imports across module boundaries that bypass the public contract layer (`useCases/`, `stores/`, `presentations/views/`), reaching directly into `models/`, `repositories/`, `engine/`, `presentations/hooks/`, or `presentations/components/` of another module.

After this pass, `pnpm deps:validate` must return zero violations, every module boundary must be enforced by real code rather than by convention, and no file should exist solely to forward what another file already exports.

This pass must be done as a single unit, by one agent, after all team branches are merged. Piecemeal convergence during the module-by-module phase was explicitly prohibited in `architecture-migration.md §17` — the time for that prohibition is now over.

---

## 2. Prerequisites

Before beginning any work, verify:

- [ ] All seven team migration branches are merged into `main`
- [ ] `git log --merges --first-parent main | grep agent/` shows all seven teams
- [ ] Teams 5 and 6 handoffs have been read — their shim inventories must be added to §5 below before starting
- [ ] `pnpm i` succeeds cleanly

Do not begin the convergence pass if any team branch is still open. A partially-merged convergence is worse than no convergence.

---

## 3. Scope and ownership

> ⚠️ **CROSS-BOUNDARY AUTHORITY — READ THIS FIRST**
>
> Every other agent in this migration was restricted to their team's modules. **You are not.** Your task file may inject a team scope listing Team Platform's paths — ignore that scope for this task. Your working scope is **the entire `src/` directory**. You are explicitly authorized and required to read, edit, and delete files in any module owned by any team.
>
> This is not a violation of the architecture rules. It is the designated cleanup agent for the migration. Hesitating to touch a file in `Collaboration/` or `AudioEngine/` because it is "not your module" is the wrong instinct here. Every file in `src/` is in scope. The constraints below are about _what kinds of changes_ you may make, not _where_ you may make them.

This pass is owned entirely by **Team Platform**. It requires deliberately crossing every module boundary in the codebase. That is the job.

**You may, in this pass:**

- Read any file in any module
- Update an import path from a shim, barrel, or alias to the canonical location, in any file in any module
- Delete a shim, barrel, or alias file once all its consumers have been updated
- Delete a pass-through use case file and update all its consumers to call the underlying function directly (only if the pass-through adds zero logic — read every line before deciding)
- Inline an exported constant at each call site when the alternative is an illegal cross-module model import

**You must NOT, in this pass:**

- Refactor logic inside any module
- Rename or move non-shim, non-barrel, non-alias files
- Change the behaviour of any code
- Add new exports to any module's public surface
- Fix violations that are not in the categories described in §1
- "Fix" a pass-through by adding logic to it — if it needs real logic, document it as a finding for the owning team

The boundary is **what you change**, not **where you change it**. You can touch any file. You cannot redesign any module.

If you discover a violation outside these categories (e.g. a genuine logic problem, a missing use case that would need to be designed), document it as a finding and leave it. Do not fix it here.

---

## 4. Process

### 4.1 Build the full inventory before touching anything

Before making any changes, build a complete picture. This takes four sweeps.

**Sweep 1 — Migration shims:**

```bash
grep -r "TEMPORARY MIGRATION SHIM" src --include="*.ts" --include="*.tsx" -l
```

Read each file fully. Understand what it re-exports and why it exists. Find all consumers:

```bash
grep -r "from '.*<shim-module-path>'" src --include="*.ts" --include="*.tsx"
```

**Sweep 2 — Barrel files:**

```bash
# Files that re-export everything from a subdirectory
grep -rn "^export \* from" src --include="*.ts" --include="*.tsx" -l

# Named re-export files (potential pseudo-barrels or lazy aliases)
grep -rn "^export {" src --include="*.ts" --include="*.tsx" -l
```

For each hit, read the file. If the file contains ONLY `export` statements (no logic, no type declarations, no function bodies), it is a barrel or lazy alias.

Look specifically for:

- Any `index.ts` file in `src/` that has re-exports
- Files named `contracts.ts`, `public.ts`, `api.ts`, `types.ts` in module roots that are pure re-exports

**Sweep 3 — Pass-throughs:**

A pass-through is a use case file where:

- It imports exactly one thing from a repository (or another module)
- It exports exactly one function
- That function does nothing except call the import and return its result

Detection is manual — grep cannot reliably distinguish a thin wrapper from a real use case. For each use case file touched during shim removal, read it fully and apply the judgement: does this function add any domain logic (validation, transformation, orchestration, error handling, event emission)? If no, it is a pass-through.

**Sweep 4 — Cross-module violations baseline:**

```bash
pnpm deps:validate
```

Record the full output. This is the baseline. Every violation must be resolved or documented as a finding before the pass is complete.

Only once the full inventory is complete should you begin making changes.

---

### 4.2 Update consumers one file at a time

Work through the inventory one file at a time. For each shim, barrel, alias, or pass-through:

1. Find all consumers of the file
2. For each consumer, update its import to point at the canonical location directly
3. Verify typecheck passes
4. Delete the file
5. Run `pnpm deps:validate` — the violation count must not increase
6. Run `pnpm typecheck` — must remain clean

Do not delete a file before all its consumers are updated. Do not batch multiple files in one step.

**The canonical location rule:**

- If the deleted file was in `useCases/`, consumers should import from the real use case (or, if the pass-through was the only thing calling a repository, import from the repository directly — only if the consumer is inside the same module).
- If the deleted file was a cross-module re-export (i.e., module A was re-exporting from module B), consumers in other modules must import from module B's public surface directly.
- If the deleted file was an `index.ts` barrel, consumers should import from the specific file that contains what they need.

---

### 4.3 Resolve cross-module violations

After shims, barrels, and aliases are removed, work through every remaining `pnpm deps:validate` violation.

For each violation, determine which category it falls into:

| Category                                                                                                                                  | Action                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Consumer of a shim that was just deleted, import not yet updated                                                                          | Fix: update the import                                                                                       |
| Direct import of a private path (`models/`, `repositories/`, `presentations/hooks/`, `presentations/components/`) from outside the module | Fix if the fix is a one-line import update; document as finding if it requires a new use case to be designed |
| Cross-module constant import where the fix is to inline the value                                                                         | Fix: inline the literal                                                                                      |
| Architectural violation that requires real domain design work                                                                             | Document as finding for owning team — do not fix                                                             |

---

### 4.4 Final verification

After all removals are complete:

1. `grep -r "TEMPORARY MIGRATION SHIM" src` — must return no results
2. `grep -rn "^export \* from" src --include="*.ts" --include="*.tsx"` — must return no results
3. `find src -name "index.ts" | xargs grep -l "^export" 2>/dev/null` — must return no results (or only files explicitly permitted — none should exist)
4. `pnpm deps:validate` — must return **zero violations**
5. `pnpm typecheck` — must pass cleanly

If step 2 or 3 returns results, investigate each one. If it is a legitimate file that is not a barrel (e.g., a file that happens to be named `index.ts` but contains real logic), document it in the Findings section as an exception with justification. Do not simply leave it.

---

## 5. Shim inventory

Update this table as you audit the codebase. The entries below are known at spec-write time; teams 5 and 6 may have added additional shims. The barrel/alias inventory must be built during §4.1 sweep 2 — it cannot be pre-populated here.

> **STATUS (2026-04-05):** All 3 originally-annotated shims (§5.1–5.3) have been resolved. The barrel/alias inventory (§5.5) has been retroactively populated from Work D/E/K/L sweeps. See §10 for remaining open issues that emerged during execution.

### 5.1 `Arrangement/useCases/clipIdQueries.ts` — ✅ RESOLVED (2026-04-04)

**Resolution:** Replaced with `Arrangement/useCases/getNextClipId.ts` — a proper single-function use case with typed signature `() => string` wrapping the private `repositories/clipIdCounter`. Old shim deleted. MIDI consumer updated.

---

### ORIGINAL SHIM DETAIL (for reference)

**What it does:** Re-exports `getNextClipId` from `Arrangement/repositories/clipIdCounter` at the public use-case layer, so MIDI does not reach into a private repository.

**Canonical target:** `Arrangement/repositories/clipIdCounter` — or, if the convergence agent determines that clip ID generation should be a proper use case, introduce one. Do not make that decision unilaterally; if the shim comment says "inline the counter logic where needed", follow that.

**Known consumers:**

| File                              | Import to update                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `MIDI/useCases/importMidiFile.ts` | `Arrangement/useCases/clipIdQueries` → `Arrangement/repositories/clipIdCounter` (or new use case) |

**Remove when:** All consumers updated.

---

### 5.2 `CrdtDocument/useCases/crdtRepositoryAccess.ts` — ✅ RESOLVED (2026-04-04)

**Resolution:** Split into 8 single-function use-case files under `CrdtDocument/useCases/`: `subscribeToCrdtChanges`, `getCrdtDoc`, `createCrdtDoc`, `replaceCrdtDoc`, `hasCrdtDoc`, `getCrdtDocIds`, `removeCrdtDoc`, `mutateCrdtDoc`. Each typed against `DocId` (CrdtDocument's own pure-model alias) and Automerge library types. Old shim deleted. Collaboration consumers (`automergeSync.ts`, `sessionManagement.ts`) updated.

---

### ORIGINAL SHIM DETAIL (for reference)

**What it does:** Exposes a restricted subset of `automergeRepository` operations (8 functions) at the public use-case layer so Collaboration does not reach into the private `repositories/` folder.

**Canonical target:** Each of the 8 exported functions should be replaced with a proper domain use case in `CrdtDocument/useCases/`. The shim comment names the intended replacements: `applyPeerSync`, `createSessionDoc`, etc. — create those use cases if they do not exist, then update consumers to call them directly.

**Known consumers:**

| File                                                        | Import to update     |
| ----------------------------------------------------------- | -------------------- |
| `Collaboration/useCases/automergeSync.ts`                   | All 8 shim functions |
| `Collaboration/useCases/collaboration/sessionManagement.ts` | All 8 shim functions |

**Remove when:** All consumers updated to call proper use cases.

---

### 5.3 `AudioEngine/stores/pluginScanStore.ts` — ✅ RESOLVED (2026-04-04)

**Resolution:** File deleted. All 3 consumers (`Workspace/Inspector/TrackDevicesSection`, `AudioEngine/PluginScanSettings`, `AudioEngine/PluginBrowser`) updated to import `pluginScanStore` from `Plugin/stores/pluginScanStore` directly.

---

### ORIGINAL SHIM DETAIL (for reference)

**What it does:** Re-exports `pluginScanStore`, `defaultPluginScanState`, and `PluginScanState` from the canonical location `Plugin/stores/pluginScanStore`. Plugin module owns scan state; this shim preserves the old AudioEngine import path.

**Canonical target:** `Plugin/stores/pluginScanStore`

**Known consumers:**

| File                                                          | Import to update                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Workspace/presentations/views/Inspector/TrackDevicesSection` | `AudioEngine/stores/pluginScanStore` → `Plugin/stores/pluginScanStore` |
| `AudioEngine/presentations/views/PluginBrowser`               | same                                                                   |
| `AudioEngine/presentations/views/PluginScanSettings`          | same                                                                   |

**Remove when:** All three consumers updated.

---

### 5.4 Teams 5 and 6 shims — ✅ NONE FOUND

No additional annotated `TEMPORARY MIGRATION SHIM` files were added by teams 5 or 6. Verified via `grep -r "TEMPORARY MIGRATION SHIM" src` (returns empty).

---

### 5.5 Barrel and alias inventory — ✅ ALL REMOVED (Work D/E/K/L, 2026-04-04/05)

All `index.ts` barrels and lazy-alias aggregator files have been removed. Consumers now import from specific files. The table below records what existed and what replaced it.

| File                                                              | Type                                                 | Removed by | Canonical target after removal                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `MIDI/useCases/midi.ts`                                           | aggregator barrel                                    | Work D     | direct file imports per symbol                                                                     |
| `MIDI/useCases/midi/{noteOps,clipOps,fileOps}/index.ts` (3 files) | sub-barrels                                          | Work D     | direct file imports                                                                                |
| `Automation/useCases/automation/types.ts`                         | type aggregator                                      | Work E     | local-type duplication per §95 in consumers                                                        |
| `Arrangement/useCases/trackQueries/index.ts`                      | use-case barrel (30+ symbols, 105 import sites)      | Work K     | direct file imports; cross-module type leaks replaced with local types per §95                     |
| `Arrangement/useCases/vca/index.ts`                               | use-case barrel                                      | Work K     | direct file imports                                                                                |
| `Arrangement/useCases/freezeBounce/index.ts`                      | use-case barrel                                      | Work K     | direct file imports                                                                                |
| `Arrangement/repositories/track/index.ts`                         | private-repo barrel                                  | Work K     | direct file imports (intra-module)                                                                 |
| `AiRuntime/repositories/cloudLlm/index.ts`                        | repo barrel                                          | Work L     | `keyManagement.ts` + `cloudInference.ts` direct                                                    |
| `AiRuntime/repositories/webLlm/index.ts`                          | repo barrel                                          | Work L     | `engineLifecycle.ts` + `toolCalling.ts` direct                                                     |
| `AiRuntime/repositories/nativeEngine/index.ts`                    | repo barrel                                          | Work L     | `lifecycle.ts` + `completions.ts` + `streaming.ts` direct                                          |
| `AiRuntime/repositories/mixAnalysis/index.ts`                     | repo barrel                                          | Work L     | `readLevels.ts` + `readFrequencyBalance.ts` direct                                                 |
| `AiRuntime/transformers/promptParser/index.ts`                    | transformer barrel                                   | Work L     | `parsing.ts` direct                                                                                |
| `AiRuntime/models/presetActions/index.ts`                         | model barrel                                         | Work L     | `registry.ts` direct                                                                               |
| `AiRuntime/models/presetActions/presets/index.ts`                 | model sub-barrel                                     | Work L     | per-category files direct                                                                          |
| `AiRuntime/models/tools/index.ts`                                 | model barrel                                         | Work L     | per-domain tool files direct                                                                       |
| `AudioEngine/repositories/audioDecoding/index.ts`                 | repo barrel                                          | Work L     | `tauriDecoding.ts` + `samplesToAudioBuffer.ts` direct                                              |
| `AudioEngine/repositories/audioEncoders/index.ts`                 | repo barrel                                          | Work L     | per-encoder files direct                                                                           |
| `AudioEngine/repositories/devices/index.ts`                       | repo barrel                                          | Work L     | `types.ts` + per-category files direct                                                             |
| `AudioEngine/repositories/nativeAIBridge/index.ts`                | repo barrel                                          | Work L     | per-operation files direct                                                                         |
| `AudioEngine/repositories/offlineScheduler/index.ts`              | repo barrel (with cross-module re-exports)           | Work L     | direct imports; cross-module re-exports routed to proper owners                                    |
| `AudioEngine/repositories/webMidi/index.ts`                       | repo barrel                                          | Work L     | `state.ts` + `lifecycle.ts` direct                                                                 |
| `AudioEngine/repositories/deviceStrategy/index.ts`                | side-effect strategy-registration + re-export hybrid | Work L     | **renamed** to `setupDeviceStrategies.ts` — not a barrel; runs registration side-effects on import |
| `Project/repositories/project/index.ts`                           | repo barrel                                          | Work L     | `storageOperations.ts` + `downloadProjectFile.ts` direct                                           |

**Exempt from removal (kept intentionally):**

| File                                                       | Reason                                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Workspace/presentations/views/Inspector/layouts/index.ts` | Side-effect layout-registration hub. Importing the file registers layout entries with the inspector; it is not a pure re-export barrel. Retained and documented. |

---

## 6. Known violations to resolve

The following violations were identified during module-by-module migration but were out of scope for the owning teams. Team Platform must resolve them as part of this convergence pass.

### 6.1 `Command/useCases/executeAppAction.ts` — ✅ RESOLVED (2026-04-04)

**Resolution:** Dynamic import updated from `automergeRepository` to the `restoreSnapshot` use case.

**Original violation:** Imports from `CrdtDocument/repositories/automergeRepository` directly — a private repository import across module boundaries.

---

### 6.2 `Synth/stores/cvGate.ts` — ✅ RESOLVED (2026-04-04)

**Resolution:** Inlined `DOC_PREFIX_ROOT = 'root'` as a local constant. Cross-module model import removed.

---

### 6.3 `Workspace/presentations/components/MiniMasterSpectrum.tsx` — ✅ RESOLVED (2026-04-04)

**Resolution:** Workspace copy deleted. Verified zero consumers via grep; body was identical to `Arrangement/presentations/views/MiniMasterSpectrum.tsx` which is now the canonical copy.

---

### 6.4 `helpers/Store/Storage/AutomergeStorage.ts` — ⚠️ UNRESOLVED (structural finding, owned by CrdtDocument team)

**Status:** Two `helpers-no-module-imports` violations remain and cannot be resolved in a convergence pass:

- `helpers/Store/Storage/AutomergeStorage.ts → CrdtDocument/useCases/semanticChangeContext.ts`
- `helpers/Store/Storage/AutomergeStorage.ts → CrdtDocument/repositories/automergeRepository.ts`

**Root cause:** `AutomergeStorage` is CrdtDocument-specific logic misplaced in `helpers/`. Fix requires either:

- (a) moving `AutomergeStorage` into `CrdtDocument/`, or
- (b) inverting the dependency — defining a CRDT-write port in `helpers/` that `CrdtDocument` implements, so helpers depend on an abstraction rather than reaching into a module.

Both options require real design decisions beyond a path-rewrite convergence pass. **Owner: CrdtDocument team.** Do not add a new shim to silence the validator.

---

### 6.5 Remaining violations from `pnpm deps:validate` — ✅ RESOLVED (2026-04-04)

**Status (2026-04-05):** All convergence-category violations resolved. Current `pnpm deps:validate` output: **2 violations**, both in §6.4 (AutomergeStorage structural finding, owned by CrdtDocument team).

At the start of this pass, 26 violations were known across `SampleLibrary`, `AiRuntime`, `Workspace`, `Synth`, `Command`, `AiGeneration`, and `helpers`. Teams 5 and 6 resolved a subset during their own passes; the remainder were fixed in this convergence pass via shim/barrel removal plus the §6.1–6.3 one-line fixes.

---

## 7. Acceptance criteria

> **STATUS (2026-04-05):** Original acceptance criteria met for the path-rewrite convergence pass. The scope has since expanded to a broader "full compliance push" — open issues tracking the post-convergence work are consolidated in §10 below.

This task is complete when **all** of the following are true:

- [x] `grep -r "TEMPORARY MIGRATION SHIM" src` returns no results
- [x] `grep -rn "^export \* from" src --include="*.ts" --include="*.tsx"` returns no results
- [x] No `index.ts` file anywhere in `src/` contains only re-exports _(exception: `Workspace/.../Inspector/layouts/index.ts` — side-effect registration hub, documented in §5.5)_
- [x] No file named `contracts.ts`, `public.ts`, or similar exists as a pure re-export shim
- [x] The barrel/alias inventory table in §5.5 is complete (every found file listed with disposition)
- [⚠️] `pnpm deps:validate` returns **zero violations** — 2 structural violations remain (AutomergeStorage, §6.4), owned by CrdtDocument team
- [x] `pnpm typecheck` passes with zero errors
- [x] Every shim file in §5.1–5.4 has been deleted
- [x] Every consumer in §5.1–5.4 has been updated to the canonical import path
- [x] No new re-export shims, barrel files, aliases, or compatibility layers have been introduced
- [x] Every finding that could not be fixed in this pass is documented with: the file, the violation type, why it was left, and which team owns it (see §10)

---

## 8. Out of scope

The following are explicitly out of scope for this pass. Do not do them, even if they seem obviously good while you are in the code:

- Refactoring logic inside any module
- Renaming files or folders that contain real logic
- Changing function signatures or types
- Adding logic to a pass-through to make it "less of a pass-through" — delete it or leave it
- Fixing violations that are not in the categories described in §1
- Improving code quality in files you happen to be touching
- Updating tooling or dependency rules in `deps-validate` config
- Adding new use cases to cover gaps you discover — document as a finding

If something belongs on this list but seems urgent, document it as a finding in the task file. Leave it for the owning team.

---

## 9. Reference

- `architecture-migration.md §17` — what the final convergence agent should do
- `architecture-migration.md §8` — conditions for a legitimate migration shim
- `architecture-migration.md §9` — what shims must never do
- `AGENTS.md — Frontend Domain-Driven Architecture` — NO BARREL FILES, model isolation, contract boundary rules
- `AGENTS.md — Safety Rules` — do not delete files outside the shim/barrel/alias inventory
- `.agents/skills/architecture-violations/SKILL.md §6` — use-case contract types, laundering, shim annotation-removal
- `.agents/audits/global/refactor-audit.md` — source of AUDIT-001 through AUDIT-023 findings below

---

## 10. Open issues (deferred, for future sessions)

This section consolidates every architectural follow-up that emerged during (or was descoped from) the convergence pass. It is the single source of truth for the next agent: read this section, pick an item, create a scoped task. Each issue below has its own verification gate — `deps:validate` alone is not sufficient.

> **Classification key:**
>
> - **Refactor** — can be done by a single agent in one session via pure file edits. No new domain design required.
> - **Redesign** — requires cross-module design decisions (schemas, ownership changes, new contracts). Warrants its own spec.
> - **Out of scope** — non-TypeScript (Rust/Tauri) or requires platform/tooling work.

### 10.1 AUDIT-006 — Anonymous `pushUndoEntry` closures (**partial**, ~42 sites remaining) — Refactor

**Status (2026-04-05):** 2 of 44 sites fixed.

**What was fixed:** `Arrangement/useCases/trackHandlers.ts::removeTrack` and `Arrangement/useCases/clipHandlers.ts::removeClip` migrated from in-handler `pushUndoEntry` closures to typed `restoreTrack` / `restoreClip` AppAction `inverseAction` payloads. Snapshot capture moved to `describe()` (pre-execute). Handlers registered in `Arrangement/useCases/restoreHandlers.ts`.

**What remains:** ~42 call sites across ~15 presentation files still push closure-based undo entries from live user gestures (slider drags, knob gestures, live edits). These are non-serializable (dropped from sessionStorage persistence) and violate the Command Pattern by inlining undo logic inside UI handlers.

**Why it's deferred:** Requires a cross-cutting "snapshot-commit" pattern — a standard way for live-gesture UI to capture pre-gesture state and emit a typed AppAction at commit time. Several candidate design shapes (ref-held snapshots, transient action queues, gesture controllers). Also requires new typed AppAction variants for each commit type (`setTrackVolume`, `setClipFade`, etc.) and their inverse actions. Design decision, not pure refactor.

**Verification when done:** `grep -rn "pushUndoEntry(" src/modules --include='*.ts' --include='*.tsx'` returns no results outside `Command/`. All undo entries persist through sessionStorage reload.

---

### 10.2 AUDIT-010 — `TrackNode` device-kind god switch — Refactor (significant)

**What it is:** `TrackNode.ts` contains a monolithic switch on `device.type` to construct the correct engine node for every built-in device. Adding a new device requires editing this switch. Cross-cuts `engine/`, `models/`, and factory creation.

**Fix shape:** Device registry pattern — each device module registers its constructor at import-time. Track node iterates the registry instead of switching on type.

**Verification:** Adding a new device type does not require editing `TrackNode.ts`.

---

### 10.3 AUDIT-018 — Cross-module model aliasing via `export type` re-exports — ✅ RESOLVED (cross-module scope)

**What it was:** ~30 `export type { ... }` / `export { type ... }` lines inside `useCases/` folders. Most were same-module re-exports (legitimate public-type-surface pattern per SKILL §6.4). Two were cross-module leaks violating §95 (model isolation):

1. `AiRuntime/useCases/aiPanelActions.ts:10` — `export type { AppAction }` re-exporting Command's type. No external consumers — dead laundering re-export.
2. `Synth/useCases/builtinSynth.ts:12` — `export { type SynthParams, defaultSynthParams, type MpeParams }` re-exporting AudioEngine's types. Consumed by `Transport/scheduleMidiNotes.ts` (passing `SynthParams` opaquely) and by `Synth/useCases/drumKitSynth.ts` (intra-module).

**Resolution:**

1. Removed the dead `AppAction` re-export in `aiPanelActions.ts`. Replaced the direct `AppAction` import with a local type derived from the public use-case signature: `type AppAction = Parameters<typeof executeAppAction>[0]` (§95 consumer-local shape, same pattern as `scheduleMidiNotes.ts:31` `DrumKitDef`).
2. Removed the cross-module re-export in `builtinSynth.ts`. Migrated `Transport/scheduleMidiNotes.ts` to derive its local `SynthParams` from the Synth public signature: `type SynthParams = ReturnType<typeof getSynthParamsForTrack>` (§95). Migrated `Synth/useCases/drumKitSynth.ts` to the same ReturnType-of-sibling-signature pattern, avoiding any new cross-module model import.

**Remaining `export type { ... }` lines in useCases/ folders** are all same-module re-exports (the module's own public type surface per SKILL §6.4 — e.g. `BacteriaPatch`, `Preferences`, `ToasterKit`, `Macro`, `ScratchPadSection`, `DocumentBundle`). These are legitimate and not violations. Inlining them into the consuming use-case file is a nice-to-have cleanup but not required.

**Verification:** `pnpm typecheck` green; `pnpm deps:validate` unchanged (2 violations — both AutomergeStorage §6.4, known/deferred).

---

### 10.4 AUDIT-023 — Monolithic `offlineRender` god use case — Refactor (significant)

**What it is:** `AudioEngine/useCases/offlineRender.ts` does EASE-to-audio compilation, scheduling, OfflineAudioContext setup, rendering, and encoding in one function. Cannot test compilation without rendering.

**Fix shape:** Split into a compiler (`compileArrangementToSchedule`) that returns a typed schedule DTO, plus a renderer (`renderSchedule`) that consumes it. Encoding stays where it is.

**Verification:** Compiler can be unit-tested without OfflineAudioContext. Renderer can be fed a hand-crafted schedule.

---

### 10.5 `Command/models/AppAction.ts:1` — cross-module private-internals import ✅ RESOLVED

**What it was:** `AppAction.ts` imported `DocumentBundle` from `CrdtDocument/models/CrdtDocumentTypes` — a `no-cross-module-private-internals` violation invisible to `deps:validate` because the dependency-cruiser config does not enable `tsPreCompilationDeps`, so type-only imports are not cruised.

**Resolution:** Updated import to `#/modules/CrdtDocument/useCases/crdtDocumentTypes` — the module's public pure-model type surface (per SKILL §6.4). Consistent with the 6 other cross-module consumers (Transport, Routing, Project stores).

---

### 10.6 `CrdtDocument/useCases/{saveSnapshot,restoreSnapshot}.ts` — snapshot-bundle naming hygiene ✅ RESOLVED

**What it was:** `saveSnapshot()` returned `Map<string, Uint8Array>` and `restoreSnapshot()` accepted `Map<string, Uint8Array>` instead of the module's own `DocumentBundle` alias. Structurally identical (since `DocId = string`) but lost the named contract.

**Resolution:** Both functions now use `DocumentBundle` imported from `../models/CrdtDocumentTypes`.

---

### 10.7 Zero tests for `CrdtDocument` module

**What it is:** The 8 single-function use cases added during convergence Phase 2 (`subscribeToCrdtChanges`, `getCrdtDoc`, etc.) are thin wrappers over `automergeRepository`. They work, but are untested. Same for `saveSnapshot`, `restoreSnapshot`.

**Fix:** Add unit tests using an in-memory Automerge instance.

---

### 10.8 `helpers/Store/Storage/AutomergeStorage.ts` — structural finding — Redesign

See §6.4 above. Owner: CrdtDocument team.

---

### 10.9 Non-refactor audit items (Redesign / Out of scope)

These are documented here for traceability; do **not** attempt to fix as a TS refactor session:

| Audit     | Title                                      | Category                                      |
| --------- | ------------------------------------------ | --------------------------------------------- |
| AUDIT-003 | Singleton plugin stores (multi-instancing) | Redesign — CRDT schema change                 |
| AUDIT-004 | Volatile CRDT memory trap                  | Redesign — background patching                |
| AUDIT-005 | Volatile domain state loss                 | Redesign — lift state into CRDT               |
| AUDIT-008 | JSON IPC audio loops                       | Deep engineering — SharedArrayBuffer ring     |
| AUDIT-009 | Main-thread DSP scheduling                 | Deep engineering — port to WASM               |
| AUDIT-011 | Rust crate workspace sprawl                | Out of scope — Rust refactor                  |
| AUDIT-012 | Controller fatality in `src-tauri`         | Out of scope — Rust refactor                  |
| AUDIT-014 | Tauri scope persistence                    | Out of scope — Tauri capabilities             |
| AUDIT-015 | Local branching split-brain                | Redesign — migrate branchStore into Automerge |
| AUDIT-016 | Volatile action history                    | Redesign — persist actionHistoryStore         |

**Resolved in this session (for cross-reference):**

- AUDIT-001, AUDIT-007, AUDIT-017, AUDIT-022 — fully resolved
- AUDIT-006 — partial (see §10.1)

---

### 10.10 Intra-module repository laundering in `AiRuntime/useCases/aiRuntimeQueries.ts` — Refactor

**What it is:** `aiRuntimeQueries.ts:31-37` contains a block of `export { ... } from '../repositories/...'` pure re-exports, mislabeled "Cross-module re-exports" (they are intra-module). Per SKILL §6.2, a use-case file that only re-exports a repository symbol launders private repository access through a fake public boundary, even intra-module:

```ts
export { streamCloudChatCompletion } from '../repositories/cloudLlm/cloudInference';
export { readLevels } from '../repositories/mixAnalysis/readLevels';
export { readFrequencyBalance } from '../repositories/mixAnalysis/readFrequencyBalance';
export { generateWebLlmCompletion } from '../repositories/webLlm/engineLifecycle';
export { generateNativeCompletion } from '../repositories/nativeEngine/completions';
export { isNativeEngineReady } from '../repositories/nativeEngine/lifecycle';
// ...
```

**Fix shape:** For each re-exported symbol, either (a) define a typed use-case function in its own file that wraps the repository call with a real signature, or (b) move the consumer to import directly from the repo path (if the consumer is intra-module and the repo symbol is genuinely the contract). Option (a) is SKILL §6.1 compliant; option (b) is honest. The current mix is neither.

**Similar pattern elsewhere:** `AiRuntime/useCases/cloudApiManagement.ts:12` — `export { isCloudAvailable } from '../repositories/cloudLlm/keyManagement'` (single-line version of the same laundering pattern). `AiRuntime/useCases/parsePromptToActions.ts:16` — `export { isComplexPrompt } from '../transformers/promptParser/parsing'` (transformer laundering, same problem class).

**Verification when done:** `grep -rn "^export {" src/modules/*/useCases --include='*.ts'` shows no pure repository or transformer re-exports (only same-file function exports).

---

### 10.11 `CrdtDocument/useCases/crdtDocumentTypes.ts` — documented pure-type re-export shim

**What it is:** `crdtDocumentTypes.ts` contains only `export type { DocId, DocumentBundle, MergeResult } from '../models/CrdtDocumentTypes'` plus two constant re-exports. A strict reading of SKILL §6.2 would flag this as laundering. The maintainers' established middle-ground is explicit, with a header comment documenting the SKILL §6.4 pure-model path, used by 7+ cross-module consumers (Transport, Routing, Project stores, and now Command/models/AppAction.ts via §10.5).

**Status:** Intentional, documented. Flagging here for traceability. If the team ever decides to remove the shim, consumers must inline the pure-model types per §95 strict.
