import { type MidiEffect, SCALES } from '../../models/MidiEffectTypes';

export function createScaleFilter(root = 0, scaleName = 'major'): MidiEffect {
    const scaleNotes = SCALES[scaleName] ?? SCALES.major!;
    return {
        id: 'midi-fx-scale-filter',
        name: `Scale Filter (${scaleName}, root ${root})`,
        process: (notes) => notes.filter((node) => scaleNotes.includes((node.pitch - root + 12) % 12)),
    };
}
