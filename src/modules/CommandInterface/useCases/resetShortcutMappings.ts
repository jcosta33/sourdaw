import { shortcutStore } from '../stores/shortcutStore';

/**
 * Clear every custom shortcut mapping, restoring the default key bindings.
 *
 * The shortcut store is owned by the Command module; cross-module callers (the
 * Workspace preferences editor) route mapping resets through this use case rather
 * than calling `shortcutStore.set(...)` directly, so the write boundary stays on
 * the owning side.
 */
export function resetShortcutMappings(): void {
    const state = shortcutStore.value;
    if (!state) {
        return;
    }
    shortcutStore.trySet({
        definitions: state.definitions,
        customMappings: {},
    });
}
