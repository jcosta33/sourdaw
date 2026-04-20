import { describe, it, expect } from 'vitest';

import * as subject from '../getChordTrackHandlers';

describe('getChordTrackHandlers', () => {
    it('should export getChordTrackHandlers', () => {
        expect(subject.getChordTrackHandlers).toBeDefined();
        const t = typeof subject.getChordTrackHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
