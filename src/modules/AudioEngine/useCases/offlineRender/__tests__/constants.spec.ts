import { describe, it, expect } from 'vitest';

import { MIN_RENDER_TIMEOUT_MS, RENDER_TIMEOUT_MULTIPLIER, YIELD_EVERY_N_NOTES } from '../constants';

describe('offlineRender/constants', () => {
    it('should export expected numeric guards', () => {
        expect(MIN_RENDER_TIMEOUT_MS).toBe(60_000);
        expect(RENDER_TIMEOUT_MULTIPLIER).toBe(10);
        expect(YIELD_EVERY_N_NOTES).toBe(200);
    });
});
