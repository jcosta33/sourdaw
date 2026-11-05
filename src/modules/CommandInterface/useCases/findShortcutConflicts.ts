import { isLoopStationPadDefinitionId, isLoopStationPlayPadDefinitionId } from '../models/LoopStationPadShortcut';
import { shortcutCombosEqual } from '../models/ShortcutCombo';
import { type ShortcutDefinition, type ShortcutStoreState } from '../stores/shortcutStore';

/**
 * Whether two definitions can fire in the same state. A play pad fires only
 * while the Loop Station is armed, and armed pads deliberately override global
 * bindings, so a play pad never competes with a non-pad binding. Every other
 * pairing (two globals, a global and a record pad, two pads) can fire together.
 */
function canFireTogether(first: string, second: string): boolean {
    const playPadAgainstGlobal =
        (isLoopStationPlayPadDefinitionId(first) && !isLoopStationPadDefinitionId(second)) ||
        (isLoopStationPlayPadDefinitionId(second) && !isLoopStationPadDefinitionId(first));
    return !playPadAgainstGlobal;
}

/**
 * The other definitions already holding `combo` in a context where they would
 * compete with `definitionId` for the same keypress, by their effective keys
 * (custom mapping, else defaults).
 */
export function findShortcutConflicts(
    state: ShortcutStoreState,
    definitionId: string,
    combo: string
): ShortcutDefinition[] {
    return state.definitions.filter((definition) => {
        if (definition.id === definitionId || !canFireTogether(definitionId, definition.id)) {
            return false;
        }
        const keys = state.customMappings[definition.id] ?? definition.defaultKeys;
        return keys.some((key) => shortcutCombosEqual(key, combo));
    });
}
