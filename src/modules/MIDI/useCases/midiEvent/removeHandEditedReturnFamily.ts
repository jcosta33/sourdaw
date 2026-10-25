import { type MidiCC } from '../../models/MidiNote';
import { isCarriedBendReturnOnEditedHead } from '../../services/registeredParameterState';
import { midiStore } from '../../stores/midiStore';

/**
 * Removes the returns a split or glue wrote just after a clip's head, whatever ids they currently
 * carry, and returns the rows it removed: revisits rewrite the family in place under its standing
 * ids, so an undo entry cannot capture them by the ids it saw at gesture time and must sweep the
 * family at undo time, restoring the rows it removed from its own pre-gesture capture.
 */
export function removeHandEditedReturnFamily(
    clipId: string,
    head: { channel: number; beat: number }
): readonly MidiCC[] {
    const state = midiStore.value;
    if (!state) {
        return [];
    }
    const rows = state.ccByClipId[clipId];
    if (!rows) {
        return [];
    }
    const removed = rows.filter((row) => isCarriedBendReturnOnEditedHead(row, head));
    if (removed.length === 0) {
        return [];
    }
    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: rows.filter((row) => !removed.includes(row)),
        },
    });
    return removed;
}
