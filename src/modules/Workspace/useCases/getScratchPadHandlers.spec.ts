import { describe, it, expect } from 'vitest';
import { getScratchPadHandlers } from './getScratchPadHandlers';

describe('getScratchPadHandlers', () => {
    it('returns a fresh map of scratch pad command handlers', () => {
        const map = getScratchPadHandlers();
        expect(map.toggleScratchPad).toBeDefined();
        expect(map.captureScratchPad).toBeDefined();
        expect(map.commitScratchPad).toBeDefined();
        expect(map.clearScratchPad).toBeDefined();
        expect(getScratchPadHandlers()).not.toBe(map);
    });
});
