# Team 4: Session — Migration Working Document

## Status

All outbound violations from Team 4's 5 modules resolved. `pnpm deps:validate` and `pnpm typecheck` pass.

---

## Module checklist

| Module | Status | Notes |
|---|---|---|
| Automation | done | Inlined `DOC_PREFIX_ROOT` |
| CrdtDocument | done | Migration shims for `automergeRepository`, `restoreSnapshot`, and `saveSnapshot`; `projectProjection` fixed |
| Collaboration | done | Inlined constants + local types; uses CrdtDocument shims |
| MIDI | done | Fixed `clipIdCounter` and `UndoEntry` import paths |
| Arrangement | done | Inlined plugin param arrays; local `MiniMasterSpectrum`; `toggleLoop()` use case |

---

## Findings

### Model constant leakage (DOC_PREFIX_ROOT)
`DOC_PREFIX_ROOT = 'root'` was imported from `CrdtDocument/models/CrdtDocumentTypes` by 5 external modules (Automation, MIDI, and 3 Arrangement stores). Per model isolation principle, the constant is intentionally opaque and must not be shared across module boundaries. Fix: inline the literal in each consumer. Promoting it to the public surface would maintain the coupling — inlining removes it.

### Plugin descriptor → instrument model imports (4 violations)
`bacteriaDescriptor`, `crustDescriptor`, `glutenDescriptor`, `grinderDescriptor` all imported `*_PARAMS` arrays from instrument modules' private `models/`. Fix: added `PluginParamDef` type to `DeviceParameter.ts` (minimal shape with only the fields the mapping needs) and inlined each param array in the descriptor file. Duplication is intentional.

### MiniMasterSpectrum cross-presentation violation
`TrackListView.tsx` (Arrangement) imported from `Workspace/presentations/components/MiniMasterSpectrum`. The component only depends on Arrangement hooks and AudioEngine use cases — it was misplaced. Fix: duplicated to `Arrangement/presentations/views/MiniMasterSpectrum.tsx`, updated TrackListView import. The Workspace original remains (Workspace team's concern).

### Direct `transportStore.set()` in presentation hook
`useTimelineInteractions.ts` called `transportStore.set({ isLooping: true })` directly. Fix: replaced with `toggleLoop()` guarded by `getTransportState()?.isLooping` check.

### Collaboration LocalBranchState too narrow
Initial `LocalBranchState` type only defined `branches: { branchId: string }[]`, but `branchStore.set()` requires the full `BranchRecord` shape. Fix: added `LocalBranchRecord` with all 7 fields, matching `BranchRecord` structurally.

---

## Shim contracts

Paths created as public migration shims — other modules can import from these:

| Shim path | Exposes | Consumers | Remove when |
|---|---|---|---|
| `CrdtDocument/useCases/crdtRepositoryAccess.ts` | `automergeRepository` singleton | `Collaboration/useCases/automergeSync.ts`, `Collaboration/useCases/collaboration/sessionManagement.ts` | Global convergence pass |
| `CrdtDocument/useCases/restoreSnapshot.ts` | `restoreSnapshot(bundle)` | `Command/useCases/executeAppAction.ts` (pending convergence) | Global convergence pass |
| `CrdtDocument/useCases/saveSnapshot.ts` | `saveSnapshot()` | `AiRuntime/useCases/dsoEditor/executeDsoEdit.ts` (pending convergence) | Global convergence pass |
| `Arrangement/useCases/clipIdQueries.ts` | `getNextClipId` | `MIDI/useCases/importMidiFile.ts` | Global convergence pass |

---

## Open questions

- **`Command/useCases/executeAppAction.ts` still imports `CrdtDocument/repositories/automergeRepository`** directly (dynamic import). `CrdtDocument/useCases/restoreSnapshot.ts` is now exposed as the correct path. Command (Team 1 scope) needs to update the import in the global convergence pass.
- **`Synth/stores/cvGate.ts` imports `CrdtDocument/models/CrdtDocumentTypes`** — still a violation. Synth is not Team 4's scope. Synth team should inline `DOC_PREFIX_ROOT = 'root'`.
- **26 remaining violations** are all in modules outside Team 4's boundary (SampleLibrary, AiRuntime, Workspace, Synth, Command, AiGeneration, helpers).

---

## Notes

- Model isolation principle clarified with repo owner during session: models are strictly private, constants must be inlined in consumers, not promoted.
- `AGENTS.md` and `docs/architecture/03-typescript-module.md` updated to document the model isolation rule.
- `AGENTS.md` additionally updated with three new coding convention rules: no `* as X` namespace imports; no entity-type-name prefixes/suffixes and no single-letter variable or generic names; functions with >1 param use a single object param with `FunctionNameInput`/`FunctionNameOutput` types defined immediately above the function (module-level) or inline object types (class methods).
- All Collaboration and CrdtDocument files modified during migration were retroactively brought into compliance with the new conventions.
- `pnpm i` must be run before `pnpm typecheck` — node_modules not committed.
