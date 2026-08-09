import { shortcutStore } from '../stores/shortcutStore';

/**
 * Set the custom key combo for one shortcut definition.
 *
 * The shortcut store is owned by the Command module; cross-module callers (the
 * Workspace preferences editor) route mapping edits through this use case rather
 * than calling `shortcutStore.set(...)` directly, so the write boundary stays on
 * the owning side.
 */
export function setShortcutMapping(definitionId: string, combo: string): void {
    const state = shortcutStore.value;
    if (!state) {
        return;
    }
    // `trySet`, not `set`: a refused write threw out of the remap handler, so
    // on a full quota the new binding did not take at all — worse than not
    // persisting, because the shortcut the user just assigned did nothing.
    // See #1557.
    shortcutStore.trySet({
        definitions: state.definitions,
        customMappings: { ...state.customMappings, [definitionId]: [combo] },
    });
}
