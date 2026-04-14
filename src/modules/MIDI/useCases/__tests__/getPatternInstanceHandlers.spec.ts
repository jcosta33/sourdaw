import { describe, it, expect } from 'vitest';
import * as subject from '../getPatternInstanceHandlers';

describe('getPatternInstanceHandlers', () => {
    it('should export getPatternInstanceHandlers', () => {
        expect(subject.getPatternInstanceHandlers).toBeDefined();
        const t = typeof subject.getPatternInstanceHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
