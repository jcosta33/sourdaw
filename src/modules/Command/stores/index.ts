// Command/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { macroStore } from './macroStore';
export type { MacroStoreState } from './macroStore';

export { undoStore } from './undo-store-facade';
export type { UndoStoreState } from './undo-store-facade';

/** The full undo/redo stacks — entries with their actions, inverses and buffer
 * declarations — the read surface for ownership queries over undoable state.
 * The label-only `undoStore` above is the UI projection. */
export { undoStore as undoHistoryStore } from './undoStore';
export type { UndoStoreState as UndoHistoryStoreState } from './undoStore';

export { registerHandlerMap, getHandlerMap, clearHandlerRegistry } from './handlerRegistry';
export {
    clearMidiTransformRegistry,
    getMidiTransform,
    getMidiTransformDescriptors,
    getMidiTransformNames,
    registerMidiTransforms,
} from './midiTransformRegistry';
export { actionReplayRevisionStore } from './actionReplayRevisionStore';
export { commandBatchIdempotencyStore } from './commandBatchIdempotencyStore';
