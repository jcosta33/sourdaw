import { describe, it, expect } from 'vitest';
import * as subject from '../setDefaultAlgorithm';

describe('setDefaultAlgorithm', () => {
    it('should export setDefaultAlgorithm', () => {
        expect(subject.setDefaultAlgorithm).toBeDefined();
        const t = typeof subject.setDefaultAlgorithm;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
