import { midiStore } from '../../stores/midiStore';
import { type MidiNote } from '../../models/MidiNote';

export function getNotesForClip(clipId: string): MidiNote[] {
    const state = midiStore.value;
    if (!state) {
        return [];
    }
    return state.notesByClipId[clipId] ?? [];
}
