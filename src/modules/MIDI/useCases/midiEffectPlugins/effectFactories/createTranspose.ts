import { clampMidiData7 } from '#/utils/midiData';

import { type MidiEffect } from '../../../models/MidiEffectTypes';

export function createTranspose(semitones = 0): MidiEffect {
    return {
        id: 'midi-fx-transpose',
        name: `Transpose (${semitones > 0 ? '+' : ''}${semitones})`,
        process: (notes) =>
            notes.map((node) => ({
                ...node,
                pitch: clampMidiData7(node.pitch + semitones),
            })),
    };
}
