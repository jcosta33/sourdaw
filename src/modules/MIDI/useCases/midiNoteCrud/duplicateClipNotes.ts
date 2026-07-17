import { createMidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export function duplicateClipNotes(sourceClipId: string, destClipId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }
    const sourceNotes = state.notesByClipId[sourceClipId] ?? [];
    if (sourceNotes.length === 0) {
        return;
    }

    const clonedNotes = sourceNotes.map((note) => {
        const safePitch = Math.round(Math.max(0, Math.min(127, note.pitch)));
        const safeVelocity = Math.round(Math.max(1, Math.min(127, note.velocity ?? 100)));
        const safeDuration = Math.max(0.0625, note.duration);
        const clone = createMidiNote(safePitch, note.startBeat, safeDuration, safeVelocity);

        // Carry over the optional MPE / expression fields so duplicating a clip
        // does not silently strip per-note expression. Only fields the source
        // actually defines are copied; createMidiNote's probability default is
        // overridden when the source carries an explicit value.
        if (note.probability !== undefined) {
            clone.probability = note.probability;
        }
        if (note.pressure !== undefined) {
            clone.pressure = note.pressure;
        }
        if (note.slide !== undefined) {
            clone.slide = note.slide;
        }
        if (note.pitchBend !== undefined) {
            clone.pitchBend = note.pitchBend;
        }

        return clone;
    });

    const existing = state.notesByClipId[destClipId] ?? [];

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [destClipId]: [...existing, ...clonedNotes],
        },
    });
}
