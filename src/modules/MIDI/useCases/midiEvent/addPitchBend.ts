import { createMidiError } from '../../errors/MidiError';
import { createMidiPitchBend, type MidiPitchBend } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export function addPitchBend(clipId: string, value: number, beat: number, channel = 0): MidiPitchBend {
    const state = midiStore.value;
    if (!state) {
        throw createMidiError('MIDI store not initialized');
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
