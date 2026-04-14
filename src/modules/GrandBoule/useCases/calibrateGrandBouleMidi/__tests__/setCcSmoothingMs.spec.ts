import { describe, it, expect } from 'vitest';
import * as subject from '../setCcSmoothingMs';

describe('setCcSmoothingMs', () => {
    it('should export setCcSmoothingMs', () => {
        expect(subject.setCcSmoothingMs).toBeDefined();
        const t = typeof subject.setCcSmoothingMs;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
