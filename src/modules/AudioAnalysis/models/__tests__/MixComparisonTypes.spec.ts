import { describe, it, expect } from 'vitest';

import { FREQUENCY_RANGES, type FrequencyBand } from '../MixComparisonTypes';

describe('MixComparisonTypes', () => {
    it('should define seven frequency bands with min below max', () => {
        const bands = Object.keys(FREQUENCY_RANGES) as FrequencyBand[];
        expect(bands).toHaveLength(7);
        for (const band of bands) {
            const [lo, hi] = FREQUENCY_RANGES[band];
            expect(lo).toBeLessThan(hi);
        }
    });

    it('should order bands from sub through air without gaps between adjacent ranges', () => {
        const ordered: FrequencyBand[] = ['sub', 'bass', 'low-mid', 'mid', 'high-mid', 'presence', 'air'];
        for (let index = 0; index < ordered.length - 1; index++) {
            const alpha = ordered[index]!;
            const b = ordered[index + 1]!;
            expect(FREQUENCY_RANGES[alpha][1]).toBe(FREQUENCY_RANGES[b][0]);
        }
    });
});
