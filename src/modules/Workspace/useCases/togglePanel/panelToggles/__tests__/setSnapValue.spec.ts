import { describe, it, expect } from 'vitest';
import * as subject from '../setSnapValue';

describe('setSnapValue', () => {
    it('should export setSnapValue', () => {
        expect(subject.setSnapValue).toBeDefined();
        const t = typeof subject.setSnapValue;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
