import { describe, expect, it } from 'vitest';

import { DEFAULT_WARP_SETTINGS } from '../audioWarp';

describe('DEFAULT_WARP_SETTINGS', () => {
    it('defaults to complex-pro with unity stretch and warping off', () => {
        expect(DEFAULT_WARP_SETTINGS.algorithm).toBe('complex-pro');
        expect(DEFAULT_WARP_SETTINGS.stretchRatio).toBe(1);
        expect(DEFAULT_WARP_SETTINGS.pitchShiftSemitones).toBe(0);
        expect(DEFAULT_WARP_SETTINGS.enabled).toBe(false);
    });
});
