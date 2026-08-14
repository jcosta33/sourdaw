// Command/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { macroStore } from './macroStore';
export type { MacroStoreState } from './macroStore';

export { undoStore } from './undo-store-facade';
export type { UndoStoreState } from './undo-store-facade';

export { registerHandlerMap, getHandlerMap, clearHandlerRegistry } from './handlerRegistry';
export { actionReplayRevisionStore } from './actionReplayRevisionStore';
export { commandBatchIdempotencyStore } from './commandBatchIdempotencyStore';
