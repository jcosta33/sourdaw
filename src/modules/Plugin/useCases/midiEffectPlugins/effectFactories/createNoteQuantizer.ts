import { type MidiEffect } from '../../../models/MidiEffectTypes';

export function createNoteQuantizer(gridBeats = 0.25, strength = 1.0): MidiEffect {
    return {
        id: 'midi-fx-quantizer',
        name: `Note Quantizer (${gridBeats}b, ${Math.round(strength * 100)}%)`,
        process: (notes) =>
            notes.map((node) => {
                const quantized = Math.round(node.startBeat / gridBeats) * gridBeats;
                const newStart = node.startBeat + (quantized - node.startBeat) * strength;
                return { ...node, startBeat: newStart };
            }),
    };
}
