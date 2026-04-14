import { describe, it, expect } from 'vitest';
import * as subject from '../setCvValue';

describe('setCvValue', () => {
    it('should export setCvValue', () => {
        expect(subject.setCvValue).toBeDefined();
        const t = typeof subject.setCvValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
