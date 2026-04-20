import { describe, it, expect } from 'vitest';

import * as subject from '../getTrackPeakLevel';

describe('getTrackPeakLevel', () => {
    it('should export getTrackPeakLevel', () => {
        expect(subject.getTrackPeakLevel).toBeDefined();
        const t = typeof subject.getTrackPeakLevel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
