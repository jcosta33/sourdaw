import { clampMidiData7 } from '#/utils/midiData';

import { type MidiNote } from '../models/MidiNote';

type TransposeMidiNotesInput = {
    notes: readonly MidiNote[];
    semitones: number;
    noteIds?: readonly string[];
};

export function transposeMidiNotes({ notes, semitones, noteIds }: TransposeMidiNotesInput): MidiNote[] {
    const targetIds = noteIds && noteIds.length > 0 ? new Set(noteIds) : null;
    return notes.map((note) => {
        if (targetIds && !targetIds.has(note.id)) {
            return note;
        }
        return {
            ...note,
            pitch: clampMidiData7(note.pitch + semitones),
        };
    });
}
