import { describe, it, expect } from 'vitest';
import * as subject from '../getFinalFeatureHandlers';

describe('getFinalFeatureHandlers', () => {
    it('should export getFinalFeatureHandlers', () => {
        expect(subject.getFinalFeatureHandlers).toBeDefined();
        const t = typeof subject.getFinalFeatureHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
