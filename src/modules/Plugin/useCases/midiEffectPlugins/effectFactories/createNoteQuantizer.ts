import { type MidiEffect } from '#/modules/Plugin/models/MidiEffectTypes';

export function createNoteQuantizer(gridBeats = 0.25, strength = 1.0): MidiEffect {
    return {
        id: 'midi-fx-quantizer',
        name: `Note Quantizer (${gridBeats}b, ${Math.round(strength * 100)}%)`,
        process: (notes) =>
            notes.map((n) => {
                const quantized = Math.round(n.startBeat / gridBeats) * gridBeats;
                const newStart = n.startBeat + (quantized - n.startBeat) * strength;
                return { ...n, startBeat: newStart };
            }),
    };
}