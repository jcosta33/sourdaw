import { type MidiEffect } from '../../../models/MidiEffectTypes';

export function createTranspose(semitones = 0): MidiEffect {
    return {
        id: 'midi-fx-transpose',
        name: `Transpose (${semitones > 0 ? '+' : ''}${semitones})`,
        process: (notes) =>
            notes.map((node) => ({
                ...node,
                pitch: Math.max(0, Math.min(127, node.pitch + semitones)),
            })),
    };
}
