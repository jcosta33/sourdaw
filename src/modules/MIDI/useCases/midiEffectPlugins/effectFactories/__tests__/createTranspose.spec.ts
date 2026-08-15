import { describe, it, expect } from 'vitest';

import { type MidiEffectNote } from '../../../../models/MidiEffectTypes';
import { createTranspose } from '../createTranspose';

function n(pitch: number): MidiEffectNote {
    return {
        pitch,
        velocity: 100,
        startBeat: 0,
        durationBeats: 0.25,
        channel: 0,
    };
}

describe('createTranspose', () => {
    it('should shift pitch by semitones and clamp to 0–127', () => {
        const fx = createTranspose(5);
        const out = fx.process([n(60), n(125)]);
        expect(out[0]!.pitch).toBe(65);
        expect(out[1]!.pitch).toBe(127);
    });

    it('should negative transpose without going below zero', () => {
        const fx = createTranspose(-12);
        expect(fx.process([n(5)])[0]!.pitch).toBe(0);
    });

    it('should include zero in the name when semitones is zero', () => {
        expect(createTranspose(0).name).toContain('Transpose (0)');
    });
});
