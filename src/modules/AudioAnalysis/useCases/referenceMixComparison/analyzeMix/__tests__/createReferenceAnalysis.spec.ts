import { describe, it, expect } from 'vitest';

import * as subject from '../createReferenceAnalysis';

describe('createReferenceAnalysis', () => {
    it('should export createReferenceAnalysis', () => {
        expect(subject.createReferenceAnalysis).toBeDefined();
        const time = typeof subject.createReferenceAnalysis;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
