import { shortcutCombosEqual } from '../models/ShortcutCombo';
import { type ShortcutDefinition, type ShortcutStoreState } from '../stores/shortcutStore';

/**
 * The other definitions whose effective keys (custom mapping, else defaults)
 * already hold `combo`. Every holder counts, Loop Station pads included: a
 * play pad rebound onto Cmd+C would take Copy's key whenever the station is
 * armed, so a rebind names and moves the key from any definition that has it.
 */
export function findShortcutConflicts(
    state: ShortcutStoreState,
    definitionId: string,
    combo: string
): ShortcutDefinition[] {
    return state.definitions.filter((definition) => {
        if (definition.id === definitionId) {
            return false;
        }
        const keys = state.customMappings[definition.id] ?? definition.defaultKeys;
        return keys.some((key) => shortcutCombosEqual(key, combo));
    });
}
