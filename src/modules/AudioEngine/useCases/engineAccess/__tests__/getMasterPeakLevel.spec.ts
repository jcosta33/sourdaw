import { describe, it, expect } from 'vitest';
import * as subject from '../getMasterPeakLevel';

describe('getMasterPeakLevel', () => {
    it('should export getMasterPeakLevel', () => {
        expect(subject.getMasterPeakLevel).toBeDefined();
        const t = typeof subject.getMasterPeakLevel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
