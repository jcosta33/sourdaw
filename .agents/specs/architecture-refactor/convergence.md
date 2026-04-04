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
> This is not a violation of the architecture rules. It is the designated cleanup agent for the migration. Hesitating to touch a file in `Collaboration/` or `AudioEngine/` because it is "not your module" is the wrong instinct here. Every file in `src/` is in scope. The constraints below are about *what kinds of changes* you may make, not *where* you may make them.

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

| Category | Action |
|----------|--------|
| Consumer of a shim that was just deleted, import not yet updated | Fix: update the import |
| Direct import of a private path (`models/`, `repositories/`, `presentations/hooks/`, `presentations/components/`) from outside the module | Fix if the fix is a one-line import update; document as finding if it requires a new use case to be designed |
| Cross-module constant import where the fix is to inline the value | Fix: inline the literal |
| Architectural violation that requires real domain design work | Document as finding for owning team — do not fix |

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

### 5.1 `Arrangement/useCases/clipIdQueries.ts`

**What it does:** Re-exports `getNextClipId` from `Arrangement/repositories/clipIdCounter` at the public use-case layer, so MIDI does not reach into a private repository.

**Canonical target:** `Arrangement/repositories/clipIdCounter` — or, if the convergence agent determines that clip ID generation should be a proper use case, introduce one. Do not make that decision unilaterally; if the shim comment says "inline the counter logic where needed", follow that.

**Known consumers:**

| File | Import to update |
|------|-----------------|
| `MIDI/useCases/importMidiFile.ts` | `Arrangement/useCases/clipIdQueries` → `Arrangement/repositories/clipIdCounter` (or new use case) |

**Remove when:** All consumers updated.

---

### 5.2 `CrdtDocument/useCases/crdtRepositoryAccess.ts`

**What it does:** Exposes a restricted subset of `automergeRepository` operations (8 functions) at the public use-case layer so Collaboration does not reach into the private `repositories/` folder.

**Canonical target:** Each of the 8 exported functions should be replaced with a proper domain use case in `CrdtDocument/useCases/`. The shim comment names the intended replacements: `applyPeerSync`, `createSessionDoc`, etc. — create those use cases if they do not exist, then update consumers to call them directly.

**Known consumers:**

| File | Import to update |
|------|-----------------|
| `Collaboration/useCases/automergeSync.ts` | All 8 shim functions |
| `Collaboration/useCases/collaboration/sessionManagement.ts` | All 8 shim functions |

**Remove when:** All consumers updated to call proper use cases.

---

### 5.3 `AudioEngine/stores/pluginScanStore.ts`

**What it does:** Re-exports `pluginScanStore`, `defaultPluginScanState`, and `PluginScanState` from the canonical location `Plugin/stores/pluginScanStore`. Plugin module owns scan state; this shim preserves the old AudioEngine import path.

**Canonical target:** `Plugin/stores/pluginScanStore`

**Known consumers:**

| File | Import to update |
|------|-----------------|
| `Workspace/presentations/views/Inspector/TrackDevicesSection` | `AudioEngine/stores/pluginScanStore` → `Plugin/stores/pluginScanStore` |
| `AudioEngine/presentations/views/PluginBrowser` | same |
| `AudioEngine/presentations/views/PluginScanSettings` | same |

**Remove when:** All three consumers updated.

---

### 5.4 Teams 5 and 6 shims

*(To be filled in from their task file handoffs before beginning work.)*

| Shim file | What it does | Consumers | Canonical target |
|-----------|-------------|-----------|-----------------|
| | | | |

---

### 5.5 Barrel and alias inventory

*(To be filled in during §4.1 Sweep 2. One row per file found.)*

| File | Type (barrel/alias/passthrough) | Consumers | Canonical target |
|------|---------------------------------|-----------|-----------------|
| | | | |

---

## 6. Known violations to resolve

The following violations were identified during module-by-module migration but were out of scope for the owning teams. Team Platform must resolve them as part of this convergence pass.

### 6.1 `Command/useCases/executeAppAction.ts`

**Violation:** Imports from `CrdtDocument/repositories/automergeRepository` directly — a private repository import across module boundaries.

**Fix:** Update to use `CrdtDocument/useCases/restoreSnapshot` (added by Team 4 specifically for this update).

---

### 6.2 `Synth/stores/cvGate.ts`

**Violation:** Imports `DOC_PREFIX_ROOT` or similar from `CrdtDocument/models/CrdtDocumentTypes` — a cross-module model import.

**Fix:** Inline `DOC_PREFIX_ROOT = 'root'` as a local constant. Do not promote a new export from CrdtDocument.

---

### 6.3 `Workspace/presentations/components/MiniMasterSpectrum.tsx`

**Violation:** Imports from `Arrangement/presentations/hooks/useTracks` — a private presentation hook imported across module boundaries.

**Fix:** `Arrangement/presentations/views/MiniMasterSpectrum.tsx` is now the canonical copy of this component (moved by Team 4). Update the import, or remove the Workspace copy entirely if it is now redundant. Read both files before deciding.

---

### 6.4 `helpers/Store/Storage/AutomergeStorage.ts`

**Violation:** Imports from CrdtDocument internals.

**Fix:** Update to use the appropriate public surface. If no public surface covers the need, document as a finding for the CrdtDocument team rather than adding a new shim.

---

### 6.5 Remaining violations from `pnpm deps:validate`

At the start of this pass, 26 violations were known across `SampleLibrary`, `AiRuntime`, `Workspace`, `Synth`, `Command`, `AiGeneration`, and `helpers`. Run `pnpm deps:validate` at the start of the pass to get the current count (teams 5 and 6 may have resolved some of these).

For each remaining violation, classify it using the table in §4.3 and act accordingly. The acceptance criterion is `deps:validate` at zero. But Team Platform should only reach zero by fixing legitimate convergence-pass items, not by suppressing, working around, or creating new re-export layers to satisfy the validator.

---

## 7. Acceptance criteria

This task is complete when **all** of the following are true:

- [ ] `grep -r "TEMPORARY MIGRATION SHIM" src` returns no results
- [ ] `grep -rn "^export \* from" src --include="*.ts" --include="*.tsx"` returns no results
- [ ] No `index.ts` file anywhere in `src/` contains only re-exports
- [ ] No file named `contracts.ts`, `public.ts`, or similar exists as a pure re-export shim
- [ ] The barrel/alias inventory table in §5.5 is complete (every found file listed with disposition)
- [ ] `pnpm deps:validate` returns **zero violations**
- [ ] `pnpm typecheck` passes with zero errors
- [ ] Every shim file in §5.1–5.4 has been deleted
- [ ] Every consumer in §5.1–5.4 has been updated to the canonical import path
- [ ] No new re-export shims, barrel files, aliases, or compatibility layers have been introduced
- [ ] Every finding that could not be fixed in this pass is documented in the task Findings section with: the file, the violation type, why it was left, and which team owns it

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
