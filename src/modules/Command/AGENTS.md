# Command module — Agent Guidelines

Unified command execution dispatch kernel, undo/redo history and branching undo tree, macro recording/playback, action replay authority, and versioned command idempotency; does not own command palette/shortcut UI (CommandInterface) or domain business logic owned by specific modules.

## Public Contract Surface

- `useCases`:
    - **Action Execution & Batching**: `executeAppAction`, `executeAppActionBatch`, `executeVersionedCommandEnvelope`, `executeVersionedCommandBatch`, `executeVersionedCommandBatchEnvelope`, `createVersionedCommandEnvelope`, `compileVersionedCommandBatchEnvelope`, `parseVersionedCommandEnvelope`, `parseVersionedCommandBatchEnvelope`, `serializeVersionedCommandEnvelope`, `serializeVersionedCommandBatchEnvelope`, `resolveVersionedCommandBatchBindings`, `issueCommandApprovalBinding`, `createVersionedCommandReceipt`, `createVerifiedBatchReceipt`, `registerProductionCommandHandlers`.
    - **Undo / Redo / History**: `undo`, `redo`, `pushUndoEntry`, `createUndoEntry`, `createCallbackUndoEntry`, `commitActionUndoEntry`, `clearUndoHistory`, `reconcileSessionUndoForProject`, `stampSessionUndoWitness`, `revertAction`, `revertActionGroup`, `clearActionHistory`, `resetActionReplayAuthority`, `syncActionReplayMetadata`, `getActionReplayStatus`, `REDO_NOT_APPLIED`.
    - **Macro Control**: `startMacroRecording`, `stopMacroRecording`, `getMacroHandlers`.
    - **Grounding & Policies**: `getAppActionExecutionPolicy`, `getAppActionStaticAuthority`, `getAgentActionRiskPolicy`, `getExecutableAppActionToolSchemas`, `getExecutableAppActionGroundingCatalog`, `getExecutableAppActionGroundingRules`, `getExecutableCommandRegistrations`, `isExecutableAppActionType`, `expandMidiTransform`, `getMidiTransformContract`, `getMidiTransformToolSchemas`, `selectExecutableAppActionToolSchemasForPrompt`, `requiresAppActionConfirmation`, `configureCommandBatchIdempotency`, `buildSemanticProjectDiff`, `compilePartialCommandBatchAcceptance`.
    - **Handlers & Bus**: `getMacroHandlers`, `getUndoRedoHandlers`, `getUndoTreeHandlers`, `CommandEventBus`, `setCommandEventBus`.
- `stores`: `undoStore` (facade over linear history and tree), `macroStore`, `registerHandlerMap`, `getHandlerMap`, `clearHandlerRegistry`, `actionReplayRevisionStore`, `commandBatchIdempotencyStore`, `registerMidiTransforms`, `getMidiTransform`, `getMidiTransformDescriptors`, `getMidiTransformNames`, `clearMidiTransformRegistry`.
- `presentations/views`: `UndoHistoryPanel`.
- Handlers: `getMacroHandlers`, `getUndoRedoHandlers`, `getUndoTreeHandlers`.

## Key Subsystems

- **Dispatch Kernel & Registry**: Central execution router (`executeAppAction.ts`) resolving action types against handler maps registered via `handlerRegistry.ts`.
- **Undo Engine & Branching Tree**: Dual-mode undo engine (`stores/undoStore.ts`, `models/UndoTree.ts`) supporting standard linear undo/redo and branching tree exploration.
- **Macro Recorder & Replayer**: Records executed actions into serialized `Macro` objects for multi-step workflow automation (`stores/macroStore.ts`).
- **Idempotency & Replay Verification**: Ensures deterministic re-execution, semantic fingerprint matching, and divergence detection across command batches.

## Invariants & Traps

- All state-mutating user and agent operations MUST flow through `executeAppAction` or `executeVersionedCommandBatchEnvelope` — direct store mutations bypass undo stacks, macro recording, and collaborative change tracking.
- Every module handling AppActions must register its handler map in bootstrap via `registerHandlerMap` before any actions are executed.
- Inverse operations in undo entries must be exact and idempotent; incomplete undo definitions cause project state corruption when stepping backward in history.
- A deterministic MIDI transform is a published contract here and an implementation somewhere else: this module owns the names, the parameter schemas and their bounds, and `expandMidiTransform` is the only route from a requested transform to commands. Expansion produces ordinary `addNotes` and nothing else, so a transform adds no execution path; an argument outside the published schema, a span that does not fit the target clip, a generator that throws, or a note outside the clip is refused with a reason rather than clamped. A descriptor is visible only once its generator is registered, because a schema a planner can discover but nothing can run is a wiring gap wearing a refusal's clothes ([ADR 0043](../../../.agents/decisions/0043-midi-transforms-compile-to-add-notes-through-the-command-registry.md)).
- `clearUndoHistory` drops the live stacks' project/document tag along with the stacks themselves, so an in-session project switch (new project, template, arrangement switch, branch switch) always forfeits session-undo history across the next reload — including back to the project it left — because only `reconcileSessionUndoForProject` re-tags, and nothing re-tags after a plain clear.

## Verification

```bash
pnpm vitest run src/modules/Command
```
