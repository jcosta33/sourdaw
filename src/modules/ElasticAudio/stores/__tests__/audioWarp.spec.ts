import { describe, expect, it } from 'vitest';

import { DEFAULT_WARP_SETTINGS, WARP_ALGORITHMS } from '../audioWarp';

describe('DEFAULT_WARP_SETTINGS', () => {
    it('defaults to repitch with unity stretch and warping off', () => {
        expect(DEFAULT_WARP_SETTINGS.algorithm).toBe('repitch');
        expect(DEFAULT_WARP_SETTINGS.stretchRatio).toBe(1);
        expect(DEFAULT_WARP_SETTINGS.pitchShiftSemitones).toBe(0);
        expect(DEFAULT_WARP_SETTINGS.enabled).toBe(false);
    });
});

describe('WARP_ALGORITHMS', () => {
    it('offers only the spec-canonical family and no third-party engine ids', () => {
        expect([...WARP_ALGORITHMS]).toEqual(['repitch', 'phase-vocoder', 'wsola']);
    });
});
