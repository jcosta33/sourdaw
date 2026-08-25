# CrdtDocument module — Agent Guidelines

Automerge CRDT document repository, reactive store projections, multi-branch state management, semantic action history (undo/redo), and IndexedDB/file CRDT persistence (network transport, WebRTC signaling, and peer presence belong to Collaboration).

## Public Contract Surface

- `stores`: `actionHistoryStore`, `agentProjectRepairStateStore`, `branchStore` (and `MAIN_BRANCH_ID`), `setSemanticContext`, `getSemanticContext`, `clearSemanticContext`.
- `useCases`:
    - **Document & Project Lifecycle**: `createCrdtDoc`, `getCrdtDoc`, `getCrdtDocIds`, `hasCrdtDoc`, `removeCrdtDoc`, `replaceCrdtDoc`, `mutateCrdtDoc`, `compactProject`, `resetCrdtProjectAuthority`, `createCrdtProject`, `loadCrdtProject`, `persistCrdtProject`, `getPersistenceBackend`, `registerCrdtStorageRuntime`, `startCrdtAutoSave`, `subscribeToCrdtChanges`, `waitForCrdtDocumentTransition`, `transactSnapshot`.
    - **Action History**: `recordActionHistoryEntry`, `clearActionHistory`, `markActionHistoryEntryReverted`.
    - **Branching**: `initBranchState`, `preserveBranchStateForSession`, `replaceBranchState`, `restoreBranchStateAfterSession`, `captureActiveBranchReference`, `getDrumPreviewBranchHandlers`.
    - **Projections**: `projectCrdtToStores`, `projectActionHistoryToStore`, `setupProjectionBridge`.
    - **Inspection & Repair**: `captureProjectRevision`, `captureProjectMutationAuthorization`, `captureUnownedProjectMutations`, `agentProjectInspectionPort`, `inspectAgentProjectDivergence`, `findAutomergeProjectConflicts`, `inspectCurrentAgentProjectRepairState`, `createCommandPreviewWorkspace`, `createCommandRecoveryWorkspace`, `sanitizeIncomingCrdtDocument`.
- `presentations/views`: `BranchManagerDialog`, `MergeResultDialog`.
- Handlers: `getDrumPreviewBranchHandlers` (`createDrumPreviewBranches`, `deleteDrumPreviewBranches`).

## Key Subsystems

- **Automerge Repository**: `repositories/automergeRepository.ts` manages live Automerge document handles, transactions, snapshots, and off-thread web worker persistence.
- **CRDT Persistence**: `repositories/crdtPersistence/` handles IndexedDB incremental change storage (`saveIncrementalsToIdb`), binary bundle encoding/decoding (`.sdaw`), and lineage verification (`advancePersistenceAuthority`).
- **Store Projection Bridge**: `projection/` drives uni-directional projection from Automerge documents to frontend memory stores (`projectCrdtToStores`, `setupProjectionBridge`).
- **Action History & Semantic Context**: Granular undo/redo tracking linked to semantic operation metadata (`models/ActionHistoryState.ts`, `stores/semanticChangeContext.ts`).
- **Branch Management**: Manages branch forks, merges, and temporary preview branches (`stores/branchStore.ts`, `handlers/previewBranches/`).

## Invariants & Traps

- **CRDT Write Path**: When CRDT mode is active, all persistent state modifications MUST go through `mutateCrdtDoc` or transactional helpers; never mutate projected frontend stores directly.
- **Lineage Conflict Guards**: `CrdtPersistenceRootLineageConflictError` and `CrdtPersistenceMembershipConflictError` prevent loading mismatched or divergent document lineages into the same project storage key.
- **Worker / Off-Thread Saves**: Document serialization and compaction run off the main thread; do not block audio or UI rendering with synchronous Automerge binary encodes.
- **Uni-Directional Projection**: Store updates flow CRDT -> Store Projections. Dispatched commands must target use cases/handlers mutating CRDT, not directly write to stores.
- **Automerge WASM Entry**: `@automerge/automerge` requires the base64 wasm alias in Vite configuration.

## Verification

```bash
pnpm vitest run src/modules/CrdtDocument
```
