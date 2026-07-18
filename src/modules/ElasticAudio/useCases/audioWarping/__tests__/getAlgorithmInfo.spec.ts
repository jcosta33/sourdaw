import { describe, it, expect } from 'vitest';

import { getAlgorithmInfo } from '../getAlgorithmInfo';

describe('getAlgorithmInfo', () => {
    it('should return metadata for a known warp algorithm', () => {
        const info = getAlgorithmInfo('repitch');
        expect(info.name).toBe('Re-Pitch');
        expect(info.quality).toBe('low');
        expect(info.realTime).toBe(true);
    });

    it('should mark rubber-band-r3 as offline', () => {
        expect(getAlgorithmInfo('rubber-band-r3').realTime).toBe(false);
    });
});
