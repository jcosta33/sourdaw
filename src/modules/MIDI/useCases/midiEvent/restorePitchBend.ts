import { createMidiError } from '../../errors/MidiError';
import { type MidiPitchBend } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

/**
 * Put a removed pitch-bend point back exactly as it was: its id, value, beat and channel, and the
 * `channelScoped` mark of a recorded row, which `addPitchBend` cannot carry.
 *
 * `previousOrder` is the clip's rows as they stood before the point was removed. The point goes back ahead of
 * the first surviving row that followed it there, because the player breaks same-beat ties by list order: a
 * point appended instead would take the bend from the rows on its beat that followed it. Without it, or with no
 * surviving successor, the point is appended. A point the clip already holds is left as it is.
 */
export function restorePitchBend(
    clipId: string,
    row: MidiPitchBend,
    previousOrder: readonly { id: string }[] = []
): void {
    const state = midiStore.value;
    if (!state) {
        throw createMidiError('MIDI store not initialized');
    }

    const existing = state.pitchBendByClipId[clipId] ?? [];
    if (existing.some(({ id }) => id === row.id)) {
        return;
    }
    const orderedIds = previousOrder.map(({ id }) => id);
    const previousIndex = orderedIds.indexOf(row.id);
    const followers = previousIndex === -1 ? [] : orderedIds.slice(previousIndex + 1);
    const successorIndex = existing.findIndex(({ id }) => followers.includes(id));
    const restored = Array.from(existing);
    restored.splice(successorIndex === -1 ? restored.length : successorIndex, 0, row);

    midiStore.set({
        ...state,
        pitchBendByClipId: {
            ...state.pitchBendByClipId,
            [clipId]: restored,
        },
    });
}
