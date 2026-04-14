import { describe, it, expect } from 'vitest';
import * as subject from '../separateStems';

describe('separateStems', () => {
    it('should export separateStems', () => {
        expect(subject.separateStems).toBeDefined();
        const t = typeof subject.separateStems;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
