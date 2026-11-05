import { shortcutCombosEqual } from '../models/ShortcutCombo';
import { shortcutStore } from '../stores/shortcutStore';

import { findShortcutConflicts } from './findShortcutConflicts';

/**
 * Set the custom key combo for one shortcut definition, reassigning it: every
 * other definition that held the combo (see `findShortcutConflicts`) loses it
 * in the same write, so one key never fires two commands. A definition left
 * with no key stays explicitly unbound (`[]`) rather than falling back to its
 * defaults. Callers that should ask first (the Preferences editor) check
 * `findShortcutConflicts` before calling.
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
    const customMappings: Record<string, string[]> = { ...state.customMappings, [definitionId]: [combo] };
    for (const holder of findShortcutConflicts(state, definitionId, combo)) {
        const keys = state.customMappings[holder.id] ?? holder.defaultKeys;
        customMappings[holder.id] = keys.filter((key) => !shortcutCombosEqual(key, combo));
    }
    // `trySet`, not `set`: a refused write threw out of the remap handler, so
    // on a full quota the new binding did not take at all — worse than not
    // persisting, because the shortcut the user just assigned did nothing.
    // See #1557.
    shortcutStore.trySet({ definitions: state.definitions, customMappings });
}
