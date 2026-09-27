import { createMidiError } from '../../errors/MidiError';
import { createMidiPitchBend, type MidiPitchBend } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export function addPitchBend(clipId: string, value: number, beat: number, channel = 0, id?: string): MidiPitchBend {
    const state = midiStore.value;
    if (!state) {
        throw createMidiError('MIDI store not initialized');
    }

    const created = createMidiPitchBend(value, beat, channel);
    // Undo/redo re-creates a removed point under the id the history entries
    // captured; a freshly minted id would orphan the opposite callback.
    const pb: MidiPitchBend = id === undefined ? created : { ...created, id };
    const existing = state.pitchBendByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        pitchBendByClipId: {
            ...state.pitchBendByClipId,
            [clipId]: [...existing, pb],
        },
    });

    return pb;
}
