import { describe, it, expect } from 'vitest';

import * as subject from '../getMasterPeakLevel';

describe('getMasterPeakLevel', () => {
    it('should export getMasterPeakLevel', () => {
        expect(subject.getMasterPeakLevel).toBeDefined();
        const time = typeof subject.getMasterPeakLevel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
