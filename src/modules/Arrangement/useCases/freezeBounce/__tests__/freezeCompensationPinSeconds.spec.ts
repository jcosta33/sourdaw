import { describe, expect, it } from 'vitest';

import { freezeCompensationPinSeconds } from '../freezeCompensationPinSeconds';

describe('freezeCompensationPinSeconds', () => {
    it('pins omitted minus live', () => {
        expect(freezeCompensationPinSeconds(0.04, 0.05)).toBeCloseTo(0.01);
    });

    it('pins the full omitted figure when live is zero (session max)', () => {
        expect(freezeCompensationPinSeconds(0, 0.048)).toBe(0.048);
    });

    it('pins zero when live and omitted are equal', () => {
        expect(freezeCompensationPinSeconds(0.032, 0.032)).toBe(0);
    });

    it('clamps a negative difference to zero', () => {
        expect(freezeCompensationPinSeconds(0.05, 0.04)).toBe(0);
    });
});
