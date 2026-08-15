import { describe, it, expect } from 'vitest';

import { type MidiEffectNote } from '../../../../models/MidiEffectTypes';
import { createMidiDelay } from '../createMidiDelay';

function n(startBeat: number, velocity = 100): MidiEffectNote {
    return {
        pitch: 60,
        velocity,
        startBeat,
        durationBeats: 0.25,
        channel: 0,
    };
}

describe('createMidiDelay', () => {
    it('should append delayed repeats with decaying velocity', () => {
        const fx = createMidiDelay(0.5, 2, 0.5);
        const out = fx.process([n(0, 100)]);
        expect(out).toHaveLength(3);
        expect(out[0]!.startBeat).toBe(0);
        expect(out[1]!.startBeat).toBeCloseTo(0.5);
        expect(out[2]!.startBeat).toBeCloseTo(1.0);
        expect(out[1]!.velocity).toBe(Math.max(1, Math.round(100 * 0.5 ** 1)));
        expect(out[2]!.velocity).toBe(Math.max(1, Math.round(100 * 0.5 ** 2)));
    });
});
