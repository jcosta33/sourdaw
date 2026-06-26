import { describe, it, expect } from 'vitest';

import { ditherModeToInt } from '../ditherModeToInt';

describe('ditherModeToInt', () => {
    it('encodes each dither mode to its engine integer (off=0, tpdf=1, noise_shaped=2)', () => {
        expect(ditherModeToInt('off')).toBe(0);
        expect(ditherModeToInt('tpdf')).toBe(1);
        expect(ditherModeToInt('noise_shaped')).toBe(2);
    });
});
