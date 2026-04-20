import { describe, it, expect } from 'vitest';

import * as subject from '../EuclideanGenerator';

describe('EuclideanGenerator', () => {
    it('should export EuclideanGenerator', () => {
        expect(subject.EuclideanGenerator).toBeDefined();
        const t = typeof subject.EuclideanGenerator;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
