import { type MidiEffect, type MidiNote, CHORD_INTERVALS } from './types';

export function createChordGenerator(chordType = 'major'): MidiEffect {
    const intervals = CHORD_INTERVALS[chordType] ?? [0, 4, 7];
    return {
        id: 'midi-fx-chord-gen',
        name: `Chord Generator (${chordType})`,
        process: (notes) => {
            const result: MidiNote[] = [];
            for (const note of notes) {
                for (const interval of intervals) {
                    result.push({ ...note, pitch: note.pitch + interval });
                }
            }
            return result;
        },
    };
}
