import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { createMidiPitchBend, type MidiPitchBend } from '#/modules/MIDI/models/MidiNote';

export function addPitchBend(clipId: string, value: number, beat: number, channel = 0): MidiPitchBend {
    const state = midiStore.value;
    if (!state) {
        throw new Error('MIDI store not initialized');
    }

    const pb = createMidiPitchBend(value, beat, channel);
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
