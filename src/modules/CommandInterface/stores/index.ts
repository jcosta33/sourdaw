// CommandInterface/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { shortcutStore } from './shortcutStore';
export type { ShortcutStoreState, ShortcutDefinition, ShortcutAction } from './shortcutStore';
