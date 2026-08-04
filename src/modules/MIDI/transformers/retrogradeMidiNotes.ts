import { type MidiNote } from '../models/MidiNote';

export function retrogradeMidiNotes(notes: readonly MidiNote[]): MidiNote[] {
    if (notes.length < 2) {
        return notes.map((note) => ({ ...note }));
    }

    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const note of notes) {
        minStart = Math.min(minStart, note.startBeat);
        maxEnd = Math.max(maxEnd, note.startBeat + note.duration);
    }
    const totalLength = maxEnd - minStart;
    return notes.map((note) => ({
        ...note,
        startBeat: minStart + totalLength - (note.startBeat - minStart) - note.duration,
    }));
}
