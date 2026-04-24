import { describe, it, expect } from 'vitest';

import * as subject from '../getPatternInstanceHandlers';

describe('getPatternInstanceHandlers', () => {
    it('should export getPatternInstanceHandlers', () => {
        expect(subject.getPatternInstanceHandlers).toBeDefined();
        const time = typeof subject.getPatternInstanceHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
