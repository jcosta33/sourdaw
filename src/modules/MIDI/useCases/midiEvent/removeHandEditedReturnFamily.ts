import { type MidiCC } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

import { getHandEditedReturnFamily } from './getHandEditedReturnFamily';

/**
 * Removes only the edited head's return family and returns its rows in stored order.
 * Other source families survive even when a short neighboring window places them within the same tick.
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
    const removed = getHandEditedReturnFamily(rows, head);
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
