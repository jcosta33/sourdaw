# CrdtDocument module — Agent Guidelines

Automerge CRDT document repository, reactive store projections, multi-branch state management, semantic action history (undo/redo), and IndexedDB/file CRDT persistence (network transport, WebRTC signaling, and peer presence belong to Collaboration).

## Public Contract Surface

- `stores`: `actionHistoryStore`, `agentProjectRepairStateStore`, `branchStore` (and `MAIN_BRANCH_ID`), `setSemanticContext`, `getSemanticContext`, `clearSemanticContext`.
- `useCases`:
    - **Document & Project Lifecycle**: `createCrdtDoc`, `getCrdtDoc`, `getCrdtDocIds`, `hasCrdtDoc`, `removeCrdtDoc`, `replaceCrdtDoc`, `mutateCrdtDoc`, `compactProject`, `resetCrdtProjectAuthority`, `createCrdtProject`, `loadCrdtProject`, `persistCrdtProject`, `getPersistenceBackend`, `registerCrdtStorageRuntime`, `startCrdtAutoSave`, `subscribeToCrdtChanges`, `waitForCrdtDocumentTransition`, `transactSnapshot`, `sessionUndoWitnessStampPort`.
    - **Action History**: `recordActionHistoryEntry`, `clearActionHistory`, `markActionHistoryEntryReverted`.
    - **Branching**: `initBranchState`, `whenBranchStateSettled`, `beginBranchSession`, `projectBranchSession`, `endBranchSession`, `captureActiveBranchReference`, `getDrumPreviewBranchHandlers`.
    - **Projections**: `projectCrdtToStores`, `projectActionHistoryToStore`, `setupProjectionBridge`.
    - **Inspection & Repair**: `captureProjectRevision`, `captureDurableDocumentWitness`, `captureProjectMutationAuthorization`, `captureUnownedProjectMutations`, `agentProjectInspectionPort`, `inspectAgentProjectDivergence`, `findAutomergeProjectConflicts`, `inspectCurrentAgentProjectRepairState`, `createCommandPreviewWorkspace`, `createCommandRecoveryWorkspace`, `sanitizeIncomingCrdtDocument`.
- `presentations/views`: `BranchManagerDialog`, `MergeResultDialog`.
- Handlers: `getDrumPreviewBranchHandlers` (`createDrumPreviewBranches`, `deleteDrumPreviewBranches`).

## Key Subsystems

- **Automerge Repository**: `repositories/automergeRepository.ts` manages live Automerge document handles, transactions, snapshots, and off-thread web worker persistence.
- **CRDT Persistence**: `repositories/crdtPersistence/` handles IndexedDB incremental change storage (`saveIncrementalsToIdb`), binary bundle encoding/decoding (`.sdaw`), and lineage verification (`advancePersistenceAuthority`).
- **Store Projection Bridge**: `projection/` drives uni-directional projection from Automerge documents to frontend memory stores (`projectCrdtToStores`, `setupProjectionBridge`).
- **Action History & Semantic Context**: Granular undo/redo tracking linked to semantic operation metadata (`models/ActionHistoryState.ts`, `stores/semanticChangeContext.ts`).
- **Branch Management**: Manages branch forks, merges, and temporary preview branches (`stores/branchStore.ts`, `handlers/previewBranches/`).
- **Durable Branch State**: `repositories/branchStateAuthority.ts` owns the one revisioned envelope every branch write goes through (`repositories/branchStateEnvelopeStorage.ts`, `repositories/withBranchStateLock.ts`).

## Invariants & Traps

- **CRDT Write Path**: When CRDT mode is active, all persistent state modifications MUST go through `mutateCrdtDoc` or transactional helpers; never mutate projected frontend stores directly.
- **Lineage Conflict Guards**: `CrdtPersistenceRootLineageConflictError` and `CrdtPersistenceMembershipConflictError` prevent loading mismatched or divergent document lineages into the same project storage key.
- **Worker / Off-Thread Saves**: Document serialization and compaction run off the main thread; do not block audio or UI rendering with synchronous Automerge binary encodes.
- **Uni-Directional Projection**: Store updates flow CRDT -> Store Projections. Dispatched commands must target use cases/handlers mutating CRDT, not directly write to stores.
- **A Re-Projection Keeps Runtime Fields**: `projectCrdtToStores` hydrates with `keepLocalRuntimeState` unless it is a project load (`resetProjections`), so a sync, merge, fork or the rollback of a failed branch transition re-reads the open project without resetting the fields a store never persists (the transport's playing, recording and playhead; MIDI learn). A store declares them through `createAutomergeStorage`'s `projectCommittedLocalState`, which the hydrate applies after its inbound guard, because a store's sanitizer rebuilds from defaults and would otherwise drop them. A bare `store.hydrate()` is a load: it starts every field from the document and the defaults. Only fork, merge and their rollbacks stay on one lineage; a branch switch does not, and neither does the rollback of a failed switch: it stops the transport before it restores the outgoing root (`stopTransportBeforeRollback`), and a take that stop commits lands on the incoming root the restore then replaces, so it is discarded with a warning rather than kept on either branch. A failed stop is logged and the restore still runs. `switchBranch` stops the transport first (`stopPlayback`, which completes a recording commit) while the outgoing branch is still the root document, and a failed stop aborts the switch, because a take left running would record into the incoming branch and the replace clears undo mid-take. The stop publishes an idle transport at once and then awaits the recording commit, so Record or Play pressed in that window is not blocked: after the last await the switch re-plans from the branch state as it then stands and refuses (`isTransportIdle`, checked in the same synchronous turn as the root replace) rather than replace the root under a rolling or about-to-roll transport. Every user-reachable switch goes through `switchBranch`.
- **Single Branch-State Writer**: `branchStore` is a memory projection. Durable branch state is one revisioned envelope written only by `branchStateAuthority`, under a Web Lock, as a compare-and-swap against the revision the writer observed (`captureRevision`). Never persist branch state from anywhere else, and never restore a collaboration session's pre-session list without its session record still owning the envelope.
- **Preview Scope Never Touches Live Decoder State**: A read inside a command-preview scope runs the store's decode hooks against the preview document. An adapter whose `fromCrdt`, `hydrateMissing`, `resolveCrdtConflicts` or `mutateCrdt` keeps closure state between calls MUST declare it through `createAutomergeStorage`'s `decoderState` option, so the scope swaps it out for the preview and restores it afterwards (also when the callback throws); otherwise the preview rebinds state the live document's next decode or write depends on.
- **Automerge WASM Entry**: `@automerge/automerge` requires the base64 wasm alias in Vite configuration.

## Verification

```bash
pnpm vitest run src/modules/CrdtDocument
```
