import { describe, it, expect } from 'vitest';

import { MAX_RATIO, MIN_RATIO, clampRatio } from '../helpers';

describe('clampRatio', () => {
    it('should clamp ratios to the stretch min and max bounds', () => {
        expect(clampRatio(0.1)).toBe(MIN_RATIO);
        expect(clampRatio(10)).toBe(MAX_RATIO);
    });

    it('should leave in-range values unchanged', () => {
        expect(clampRatio(1)).toBe(1);
        expect(clampRatio(2.5)).toBe(2.5);
    });
});
