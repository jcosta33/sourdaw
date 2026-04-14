import { describe, it, expect } from 'vitest';
import * as subject from '../getFilteredSamples';

describe('getFilteredSamples', () => {
    it('should export getFilteredSamples', () => {
        expect(subject.getFilteredSamples).toBeDefined();
        const t = typeof subject.getFilteredSamples;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
