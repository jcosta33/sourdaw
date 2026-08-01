import { type MidiNote } from '../models/MidiNote';

type TransposeMidiNotesInput = {
    notes: readonly MidiNote[];
    semitones: number;
};

export function transposeMidiNotes({ notes, semitones }: TransposeMidiNotesInput): MidiNote[] {
    return notes.map((note) => ({
        ...note,
        pitch: Math.max(0, Math.min(127, note.pitch + semitones)),
    }));
}
