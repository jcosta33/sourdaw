import { describe, it, expect } from 'vitest';

import { type MidiEffectNote } from '../../../../models/MidiEffectTypes';
import { createVelocityCurve } from '../createVelocityCurve';

function n(velocity: number): MidiEffectNote {
    return {
        pitch: 60,
        velocity,
        startBeat: 0,
        durationBeats: 0.25,
        channel: 0,
    };
}

describe('createVelocityCurve', () => {
    it('should leave velocity unchanged for linear curve', () => {
        const fx = createVelocityCurve('linear');
        expect(fx.process([n(64)])[0]!.velocity).toBe(64);
    });

    it('should apply fixed velocity when curve is fixed', () => {
        const fx = createVelocityCurve('fixed', 42);
        expect(fx.process([n(5), n(100)])[0]!.velocity).toBe(42);
        expect(fx.process([n(5), n(100)])[1]!.velocity).toBe(42);
    });

    it('should clamp soft/hard curve results to 1–127', () => {
        const soft = createVelocityCurve('soft');
        expect(soft.process([n(0)])[0]!.velocity).toBeGreaterThanOrEqual(1);
        const hard = createVelocityCurve('hard');
        expect(hard.process([n(127)])[0]!.velocity).toBeLessThanOrEqual(127);
    });
});
