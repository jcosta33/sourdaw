import { describe, expect, it } from 'vitest';

import { readVerdictFigures } from '../readVerdictFigures';

describe('readVerdictFigures', () => {
    it('prints a movement strictly above the tolerance when the real movement barely exceeds it', () => {
        // At three significant digits the real movement rounds to exactly the tolerance, 1, which reads as held.
        const figures = readVerdictFigures({
            from: -0.744,
            to: 0.25804000000000005,
            relation: 'hold',
            tolerance: 1,
            rounding: 'significant',
            start: 3,
        });

        expect(figures).toEqual({ from: -0.744, to: 0.258, movement: 1.002, broken: true });
        expect(figures.movement).toBeGreaterThan(1);
    });

    it('can state the movement as the difference of the printed endpoints', () => {
        const figures = readVerdictFigures({
            from: 5.66241,
            to: 4.10365,
            relation: 'hold',
            tolerance: 1,
            rounding: 'decimals',
            start: 3,
            movement: 'printed',
        });

        expect(figures).toEqual({ from: 5.662, to: 4.104, movement: 1.558, broken: true });
    });
});
