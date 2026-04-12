import { type MidiEffect } from '../../../models/MidiEffectTypes';

export function createMidiDelay(delayBeats = 0.25, repeats = 3, decay = 0.7): MidiEffect {
    return {
        id: 'midi-fx-delay',
        name: `MIDI Delay (${delayBeats}b × ${repeats})`,
        process: (notes) => {
            const result = [...notes];
            for (const note of notes) {
                for (let r = 1; r <= repeats; r++) {
                    result.push({
                        ...note,
                        startBeat: note.startBeat + delayBeats * r,
                        velocity: Math.max(1, Math.round(note.velocity * decay ** r)),
                    });
                }
            }
            return result;
        },
    };
}