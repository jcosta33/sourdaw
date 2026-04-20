import { describe, it, expect } from 'vitest';

import * as subject from '../findSimilarSamples';

describe('findSimilarSamples', () => {
    it('should export findSimilarSamples', () => {
        expect(subject.findSimilarSamples).toBeDefined();
        const t = typeof subject.findSimilarSamples;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
