import { describe, it, expect } from 'vitest';

import {
    MICRO_FADE_SECONDS,
    MIN_RENDER_TIMEOUT_MS,
    RENDER_TIMEOUT_MULTIPLIER,
    YIELD_EVERY_N_NOTES,
    MAX_OFFLINE_FRAMES,
} from '../constants';

describe('offlineRender/constants', () => {
    it('should export expected numeric guards', () => {
        expect(MICRO_FADE_SECONDS).toBe(0.003);
        expect(MIN_RENDER_TIMEOUT_MS).toBe(60_000);
        expect(RENDER_TIMEOUT_MULTIPLIER).toBe(10);
        expect(YIELD_EVERY_N_NOTES).toBe(200);
        expect(MAX_OFFLINE_FRAMES).toBe(2 ** 30);
    });
});
