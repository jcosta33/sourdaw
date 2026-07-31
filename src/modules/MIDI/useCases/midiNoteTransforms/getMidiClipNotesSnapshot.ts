import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export function getMidiClipNotesSnapshot(clipId: string): MidiNote[] | null {
    const notes = midiStore.value?.notesByClipId[clipId];
    if (!notes) {
        return null;
    }
    return notes.map((note) => ({ ...note }));
}
