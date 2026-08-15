import { CHORD_TYPES, type ChordType } from '../../models/ChordTypes';
import { type MidiEffect, type MidiEffectNote } from '../../models/MidiEffectTypes';

const MAJOR_TRIAD_INTERVALS: readonly number[] = [0, 4, 7];

function isChordType(value: string): value is ChordType {
    return Object.hasOwn(CHORD_TYPES, value);
}

export function createChordGenerator(chordType = 'major'): MidiEffect {
    const intervals = isChordType(chordType) ? CHORD_TYPES[chordType] : MAJOR_TRIAD_INTERVALS;
    return {
        id: 'midi-fx-chord-gen',
        name: `Chord Generator (${chordType})`,
        process: (notes) => {
            const result: MidiEffectNote[] = [];
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
