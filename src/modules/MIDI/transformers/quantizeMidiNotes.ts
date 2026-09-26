import { quantizeBeatToGrid } from '#/utils/Music/quantizeBeatToGrid';

import { type MidiNote } from '../models/MidiNote';

type QuantizeMidiNotesInput = {
    notes: readonly MidiNote[];
    gridSize: number;
    strength?: number;
    swing?: number;
    noteIds?: readonly string[];
};

export function quantizeMidiNotes({
    notes,
    gridSize,
    strength = 1,
    swing = 0,
    noteIds,
}: QuantizeMidiNotesInput): MidiNote[] {
    const targetIds = noteIds && noteIds.length > 0 ? new Set(noteIds) : null;
    return notes.map((note) => {
        if (targetIds && !targetIds.has(note.id)) {
            return note;
        }
        const startBeat = quantizeBeatToGrid({ beat: note.startBeat, gridSize, strength, swing });

        return { ...note, startBeat };
    });
}
