import { describe, it, expect } from 'vitest';
import * as subject from '../yeastPanic';

describe('yeastPanic', () => {
    it('should export yeastPanic', () => {
        expect(subject.yeastPanic).toBeDefined();
        const t = typeof subject.yeastPanic;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
