import { type MidiEffect, SCALES } from './types';

export function createScaleFilter(root = 0, scaleName = 'major'): MidiEffect {
    const scaleNotes = SCALES[scaleName] ?? SCALES.major!;
    return {
        id: 'midi-fx-scale-filter',
        name: `Scale Filter (${scaleName}, root ${root})`,
        process: (notes) => notes.filter((n) => scaleNotes.includes((n.pitch - root + 12) % 12)),
    };
}
