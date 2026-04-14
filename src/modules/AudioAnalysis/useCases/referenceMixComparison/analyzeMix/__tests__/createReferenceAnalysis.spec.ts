import { describe, it, expect } from 'vitest';
import * as subject from '../createReferenceAnalysis';

describe('createReferenceAnalysis', () => {
    it('should export createReferenceAnalysis', () => {
        expect(subject.createReferenceAnalysis).toBeDefined();
        const t = typeof subject.createReferenceAnalysis;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
