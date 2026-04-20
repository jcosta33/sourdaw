import { midiStore } from '../../stores/midiStore';

import type { GrooveTemplate } from './helpers';

/**
 * Apply a groove template to a MIDI clip.
 * Shifts note start positions according to the template's timing offsets
 * and scales velocities.
 *
 * @param clipId - Target MIDI clip to apply groove to
 * @param groove - The groove template to apply
 * @param amount - Strength of groove application (0.0 = none, 1.0 = full)
 * @returns Map of noteId → original startBeat for undo
 */
export function applyGrooveToClip(
    clipId: string,
    groove: GrooveTemplate,
    amount = 1.0
): Map<string, { startBeat: number; velocity: number }> | null {
    const state = midiStore.value;
    if (!state) {
        return null;
    }

    const notes = state.notesByClipId[clipId];
    if (!notes || notes.length === 0) {
        return null;
    }

    const originals = new Map<string, { startBeat: number; velocity: number }>();

    const updatedNotes = notes.map((note) => {
        originals.set(note.id, { startBeat: note.startBeat, velocity: note.velocity });

        // Find the nearest grid position
        const gridIndex = Math.round(note.startBeat / groove.gridDivision);
        const wrappedIndex = gridIndex % Math.round(1 / groove.gridDivision);

        // Find matching groove offset
        const grooveEntry = groove.offsets.find((o) => o.gridPosition === wrappedIndex);
        if (!grooveEntry) {
            return note;
        }

        const newStartBeat = note.startBeat + grooveEntry.timingOffset * amount;
        const newVelocity = Math.max(
            1,
            Math.min(127, Math.round(note.velocity * (1 + (grooveEntry.velocityScale - 1) * amount)))
        );

        return {
            ...note,
            startBeat: Math.max(0, newStartBeat),
            velocity: newVelocity,
        };
    });

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: updatedNotes,
        },
    });

    return originals;
}
