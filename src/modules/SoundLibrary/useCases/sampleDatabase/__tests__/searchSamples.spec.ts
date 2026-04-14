import { describe, it, expect } from 'vitest';
import * as subject from '../searchSamples';

describe('searchSamples', () => {
    it('should export searchSamples', () => {
        expect(subject.searchSamples).toBeDefined();
        const t = typeof subject.searchSamples;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
