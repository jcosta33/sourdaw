import { describe, it, expect } from 'vitest';

import * as subject from '../getTrackPeakLevel';

describe('getTrackPeakLevel', () => {
    it('should export getTrackPeakLevel', () => {
        expect(subject.getTrackPeakLevel).toBeDefined();
        const time = typeof subject.getTrackPeakLevel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
