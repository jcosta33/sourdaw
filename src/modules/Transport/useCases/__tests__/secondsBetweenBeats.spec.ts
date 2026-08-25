import { describe, expect, it } from 'vitest';

import { secondsBetweenBeats } from '../secondsBetweenBeats';

describe('secondsBetweenBeats', () => {
    it('uses the default tempo when the project has no tempo-map changes', () => {
        expect(secondsBetweenBeats([], 0, 8, 120)).toBeCloseTo(4, 12);
    });

    it('integrates across an instant tempo step', () => {
        expect(
            secondsBetweenBeats(
                [
                    { id: 'start', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'step', beat: 2, tempo: 240, curve: 'instant' },
                ],
                0,
                4,
                120
            )
        ).toBeCloseTo(1.5, 12);
    });

    it('integrates a linear tempo ramp instead of flattening it', () => {
        expect(
            secondsBetweenBeats(
                [
                    { id: 'start', beat: 0, tempo: 60, curve: 'linear' },
                    { id: 'end', beat: 4, tempo: 120, curve: 'instant' },
                ],
                0,
                4,
                120
            )
        ).toBeCloseTo(4 * Math.LN2, 9);
    });
});
