import { describe, it, expect } from 'vitest';

import * as subject from '../CCGenerator';

describe('CCGenerator', () => {
    it('should export CCGenerator', () => {
        expect(subject.CCGenerator).toBeDefined();
        const time = typeof subject.CCGenerator;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
