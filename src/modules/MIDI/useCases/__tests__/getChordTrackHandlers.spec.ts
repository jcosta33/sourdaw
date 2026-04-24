import { describe, it, expect } from 'vitest';

import * as subject from '../getChordTrackHandlers';

describe('getChordTrackHandlers', () => {
    it('should export getChordTrackHandlers', () => {
        expect(subject.getChordTrackHandlers).toBeDefined();
        const time = typeof subject.getChordTrackHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
