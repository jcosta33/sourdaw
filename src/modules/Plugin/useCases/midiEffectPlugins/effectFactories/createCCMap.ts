import { type MidiEffect } from '../../../models/MidiEffectTypes';

/** Placeholder — CC mapping operates on CC events, not notes. */
export function createCCMap(inputCC: number, outputCC: number, _invert = false): MidiEffect {
    return {
        id: 'midi-fx-cc-map',
        name: `CC Map (${inputCC} → ${outputCC})`,
        process: (notes) => notes,
    };
}
