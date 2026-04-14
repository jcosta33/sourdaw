import { describe, it, expect } from 'vitest';
import { interpolateLatent } from '../interpolateLatent';

describe('interpolateLatent', () => {
    it('should linearly interpolate timeSec and each latent dimension', () => {
        const a = { timeSec: 0, values: [0, 10] };
        const b = { timeSec: 2, values: [10, 30] };

        expect(interpolateLatent(a, b, 0.5)).toEqual({
            timeSec: 1,
            values: [5, 20],
        });
    });

    it('should treat missing dimensions in b as zero', () => {
        const a = { timeSec: 0, values: [4] };
        const b = { timeSec: 0, values: [] };

        expect(interpolateLatent(a, b, 0.5).values[0]).toBe(2);
    });
});
