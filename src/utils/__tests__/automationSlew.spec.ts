import { describe, it, expect } from 'vitest';

import { AUTOMATION_SLEW_ALPHA, automationSlewTickSecondsForGrain, slewStep } from '../automationSlew';

describe('automationSlew', () => {
    it('pins the live slew coefficient the offline replica matches', () => {
        expect(AUTOMATION_SLEW_ALPHA).toBe(0.4);
    });

    it('derives the tick cadence from the scheduler grain, not from the shipping default', () => {
        // One slewStep per scheduler tick, and the scheduler ticks every
        // scheduleGrainMs — so the cadence tracks the grain at every setting,
        // not only at the 10ms default where a hardcoded 0.01 happened to agree.
        expect(automationSlewTickSecondsForGrain(10)).toBe(0.01);
        expect(automationSlewTickSecondsForGrain(2.5)).toBe(0.0025);
        expect(automationSlewTickSecondsForGrain(25)).toBe(0.025);
        expect(automationSlewTickSecondsForGrain(100)).toBe(0.1);
    });

    it('falls back to the live scheduler grain for an unusable one, rather than refusing to slew', () => {
        // An earlier revision returned 0 here — "do not slew" — reasoning that
        // such a grain could not have driven a live tick. It can: the scheduler
        // worker clamps a non-positive interval to 10 ms and keeps ticking, so
        // live still slews. Returning 0 would have held a value offline that the
        // monitor glided, which is the divergence this module exists to close.
        expect(automationSlewTickSecondsForGrain(0)).toBe(0.01);
        expect(automationSlewTickSecondsForGrain(-5)).toBe(0.01);
        expect(automationSlewTickSecondsForGrain(Number.NaN)).toBe(0.01);
        expect(automationSlewTickSecondsForGrain(Number.POSITIVE_INFINITY)).toBe(0.01);
    });

    it('advances one IIR tick toward the target: y = y + alpha*(target - y)', () => {
        expect(slewStep(0, 1)).toBeCloseTo(0.4, 12);
        expect(slewStep(0.4, 1)).toBeCloseTo(0.64, 12);
        expect(slewStep(0.64, 1)).toBeCloseTo(0.784, 12);
    });

    it('holds when previous equals target (the live seed y[0]=x[0])', () => {
        expect(slewStep(0.73, 0.73)).toBe(0.73);
    });

    it('honours an explicit alpha override', () => {
        expect(slewStep(0, 10, 0.1)).toBeCloseTo(1, 12);
    });

    it('converges toward the target monotonically over repeated ticks', () => {
        let value = 0;
        for (let tick = 0; tick < 40; tick++) {
            const next = slewStep(value, 1);
            expect(next).toBeGreaterThanOrEqual(value);
            value = next;
        }
        expect(value).toBeCloseTo(1, 6);
    });
});
