import { describe, it, expect } from 'vitest';

import { getAnalysisHandlers } from '../getAnalysisHandlers';

describe('getAnalysisHandlers', () => {
    it('returns a fresh map of mix-analysis command handlers', () => {
        const map = getAnalysisHandlers();
        expect(map.analyzeMix).toBeDefined();
        expect(map.autoFixMix).toBeDefined();
        expect(getAnalysisHandlers()).not.toBe(map);
    });
});
