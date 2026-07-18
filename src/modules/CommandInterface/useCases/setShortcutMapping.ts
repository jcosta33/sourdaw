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
    shortcutStore.set({
        definitions: state.definitions,
        customMappings: { ...state.customMappings, [definitionId]: [combo] },
    });
}
