import { midiStore } from '#/modules/Midi/stores/midiStore';
import { type MidiNote } from '#/modules/Midi/models/MidiNote';

export function getNotesForClip(clipId: string): MidiNote[] {
    const state = midiStore.value;
    if (!state) {
        return [];
    }
    return state.notesByClipId[clipId] ?? [];
}
