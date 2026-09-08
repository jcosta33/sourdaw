import { type MidiNote } from '../models/MidiNote';

const SWING_UNIT_BEATS = 0.5;

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
        const stepIndex = Math.round(note.startBeat / gridSize);
        const quantizedBeat = stepIndex * gridSize;
        const swingUnitIndex = Math.round(quantizedBeat / SWING_UNIT_BEATS);
        const isOffbeat = swingUnitIndex % 2 !== 0;
        const swingOffset = isOffbeat ? swing * (gridSize / 2) : 0;
        const targetStartBeat = quantizedBeat + swingOffset;
        const startBeat = note.startBeat + (targetStartBeat - note.startBeat) * strength;

        return { ...note, startBeat };
    });
}
