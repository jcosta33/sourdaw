import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export function getNotesForClip(clipId: string): MidiNote[] {
    const state = midiStore.value;
    if (!state) {
        return [];
    }
    return state.notesByClipId[clipId] ?? [];
}
