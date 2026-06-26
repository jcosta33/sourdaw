// Command/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { macroStore } from './macroStore';
export type { MacroStoreState } from './macroStore';

export { undoStore, pushUndo } from './undoStore';
export type { UndoStoreState } from './undoStore';
export { pushUndoEntry } from './pushUndoEntry';
export { clearUndoHistory } from './clearUndoHistory';
export { commitActionUndoEntry } from './commitActionUndoEntry';

export { shortcutStore } from './shortcutStore';
export type { ShortcutStoreState, ShortcutDefinition, ShortcutAction } from './shortcutStore';

export { registerHandlerMap, getHandlerMap, clearHandlerRegistry } from './handlerRegistry';
