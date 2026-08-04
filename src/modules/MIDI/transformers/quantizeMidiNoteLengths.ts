import { type MidiNote } from '../models/MidiNote';

type QuantizeMidiNoteLengthsInput = {
    notes: readonly MidiNote[];
    gridSize: number;
};

const MIN_NOTE_LENGTH_GRID_SIZE = 0.03125;

export function quantizeMidiNoteLengths(input: QuantizeMidiNoteLengthsInput): MidiNote[] {
    if (!Number.isFinite(input.gridSize) || input.gridSize < MIN_NOTE_LENGTH_GRID_SIZE) {
        return input.notes.map((note) => ({ ...note }));
    }
    return input.notes.map((note) => {
        const multiples = Math.round(note.duration / input.gridSize);
        const snappedDuration = multiples * input.gridSize;
        const duration = multiples < 1 || !Number.isFinite(snappedDuration) ? note.duration : snappedDuration;
        return { ...note, duration };
    });
}
