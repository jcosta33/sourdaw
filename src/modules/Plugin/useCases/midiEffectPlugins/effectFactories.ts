import { type MidiEffect } from '#/modules/Plugin/models/MidiEffectTypes';

export function createVelocityCurve(curve: 'linear' | 'soft' | 'hard' | 'fixed' = 'linear', fixedVel = 100): MidiEffect {
    return {
        id: 'midi-fx-velocity-curve',
        name: `Velocity Curve (${curve})`,
        process: (notes) =>
            notes.map((n) => {
                let vel = n.velocity;
                switch (curve) {
                    case 'soft': vel = Math.round(Math.sqrt(vel / 127) * 127); break;
                    case 'hard': vel = Math.round((vel / 127) ** 2 * 127); break;
                    case 'fixed': vel = fixedVel; break;
                    case 'linear': default: break;
                }
                return { ...n, velocity: Math.max(1, Math.min(127, vel)) };
            }),
    };
}

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

export function createTranspose(semitones = 0): MidiEffect {
    return {
        id: 'midi-fx-transpose',
        name: `Transpose (${semitones > 0 ? '+' : ''}${semitones})`,
        process: (notes) =>
            notes.map((n) => ({
                ...n,
                pitch: Math.max(0, Math.min(127, n.pitch + semitones)),
            })),
    };
}

/** Placeholder — CC mapping operates on CC events, not notes. */
export function createCCMap(inputCC: number, outputCC: number, _invert = false): MidiEffect {
    return {
        id: 'midi-fx-cc-map',
        name: `CC Map (${inputCC} → ${outputCC})`,
        process: (notes) => notes,
    };
}
