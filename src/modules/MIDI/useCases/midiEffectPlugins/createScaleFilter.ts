import { type MidiEffect, SCALES, getScale } from '../../models/MidiEffectTypes';

export function createScaleFilter(root = 0, scaleName = 'major'): MidiEffect {
    const scaleNotes = getScale(scaleName) ?? SCALES.major!;
    return {
        id: 'midi-fx-scale-filter',
        name: `Scale Filter (${scaleName}, root ${root})`,
        process: (notes) => notes.filter((node) => scaleNotes.includes((node.pitch - root + 12) % 12)),
    };
}
