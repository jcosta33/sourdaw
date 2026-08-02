import { type MidiNote } from '../models/MidiNote';

const SWING_UNIT_BEATS = 0.5;

type QuantizeMidiNotesInput = {
    notes: readonly MidiNote[];
    gridSize: number;
    strength?: number;
    swing?: number;
};

export function quantizeMidiNotes({ notes, gridSize, strength = 1, swing = 0 }: QuantizeMidiNotesInput): MidiNote[] {
    return notes.map((note) => {
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
