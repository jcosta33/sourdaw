import { describe, it, expect } from 'vitest';

import * as subject from '../setDefaultAlgorithm';

describe('setDefaultAlgorithm', () => {
    it('should export setDefaultAlgorithm', () => {
        expect(subject.setDefaultAlgorithm).toBeDefined();
        const time = typeof subject.setDefaultAlgorithm;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
