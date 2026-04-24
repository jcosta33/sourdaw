import { describe, it, expect } from 'vitest';

import * as subject from '../EuclideanGenerator';

describe('EuclideanGenerator', () => {
    it('should export EuclideanGenerator', () => {
        expect(subject.EuclideanGenerator).toBeDefined();
        const time = typeof subject.EuclideanGenerator;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
