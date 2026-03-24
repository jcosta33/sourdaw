import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { createMidiNote, type MidiNote } from '#/modules/MIDI/models/MidiNote';

export function addMidiNote(
    clipId: string,
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100
): MidiNote {
    const state = midiStore.value;
    if (!state) {
        throw new Error('MIDI store not initialized');
    }

    const note = createMidiNote(pitch, startBeat, duration, velocity);
    const existing = state.notesByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, note],
        },
    });

    return note;
}
