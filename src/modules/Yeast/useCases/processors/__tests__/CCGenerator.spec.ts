import { describe, it, expect } from 'vitest';
import * as subject from '../CCGenerator';

describe('CCGenerator', () => {
    it('should export CCGenerator', () => {
        expect(subject.CCGenerator).toBeDefined();
        const t = typeof subject.CCGenerator;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
