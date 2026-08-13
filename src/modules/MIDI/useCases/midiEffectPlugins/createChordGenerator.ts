import { type MidiEffect, type MidiNote, CHORD_INTERVALS } from '../../models/MidiEffectTypes';

export function createChordGenerator(chordType = 'major'): MidiEffect {
    const intervals = CHORD_INTERVALS[chordType] ?? [0, 4, 7];
    return {
        id: 'midi-fx-chord-gen',
        name: `Chord Generator (${chordType})`,
        process: (notes) => {
            const result: MidiNote[] = [];
            for (const note of notes) {
                for (const interval of intervals) {
                    // Clamp to the MIDI pitch range like createTranspose and
                    // createVelocityCurve do; a maj7 on pitch 120 would
                    // otherwise emit 131 downstream.
                    result.push({ ...note, pitch: Math.max(0, Math.min(127, note.pitch + interval)) });
                }
            }
            return result;
        },
    };
}
