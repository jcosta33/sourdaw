import { describe, it, expect } from 'vitest';

import { AUTOMATION_SLEW_ALPHA, AUTOMATION_SLEW_TICK_SECONDS, slewStep } from '../automationSlew';

describe('automationSlew', () => {
    it('pins the live slew coefficient and 100Hz tick cadence the offline replica matches', () => {
        expect(AUTOMATION_SLEW_ALPHA).toBe(0.4);
        expect(AUTOMATION_SLEW_TICK_SECONDS).toBe(0.01);
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
