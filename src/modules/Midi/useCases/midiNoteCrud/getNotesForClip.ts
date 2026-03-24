import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { type MidiNote } from '#/modules/MIDI/models/MidiNote';

export function getNotesForClip(clipId: string): MidiNote[] {
    const state = midiStore.value;
    if (!state) {
        return [];
    }
    return state.notesByClipId[clipId] ?? [];
}
