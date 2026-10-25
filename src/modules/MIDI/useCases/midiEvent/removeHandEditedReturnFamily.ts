import { isCarriedBendReturnOnEditedHead } from '../../services/registeredParameterState';
import { midiStore } from '../../stores/midiStore';

/**
 * Removes the returns a split or glue wrote just after a clip's head, whatever ids they currently
 * carry: revisits rewrite the family in place under its standing ids, so an undo entry cannot
 * capture them by the ids it saw at gesture time and must sweep the family at undo time instead.
 */
export function removeHandEditedReturnFamily(clipId: string, head: { channel: number; beat: number }): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }
    const rows = state.ccByClipId[clipId];
    if (!rows) {
        return;
    }
    const remaining = rows.filter((row) => !isCarriedBendReturnOnEditedHead(row, head));
    if (remaining.length === rows.length) {
        return;
    }
    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: remaining,
        },
    });
}
