import { type MidiNote } from '../models/MidiNote';

type QuantizeMidiNoteLengthsInput = {
    notes: readonly MidiNote[];
    gridSize: number;
};

export function quantizeMidiNoteLengths(input: QuantizeMidiNoteLengthsInput): MidiNote[] {
    return input.notes.map((note) => {
        const multiples = Math.round(note.duration / input.gridSize);
        const duration = multiples < 1 ? note.duration : multiples * input.gridSize;
        return { ...note, duration };
    });
}
