import { midiStore } from '../../stores/midiStore';
import { createMidiNote, type MidiNote } from '../../models/MidiNote';
import { createMidiError } from '../../errors/MidiError';

export function addMidiNote(
    clipId: string,
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100
): MidiNote {
    const state = midiStore.value;
    if (!state) {
        throw createMidiError('MIDI store not initialized');
    }

    const safePitch = Math.round(Math.max(0, Math.min(127, pitch)));
    const safeVelocity = Math.round(Math.max(1, Math.min(127, velocity)));
    const safeStart = Math.max(0, startBeat);
    const safeDuration = Math.max(0.0625, duration); // 64th note minimum

    const note = createMidiNote(safePitch, safeStart, safeDuration, safeVelocity);
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
