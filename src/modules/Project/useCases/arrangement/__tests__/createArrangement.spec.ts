import { describe, it, expect } from 'vitest';
import * as subject from '../createArrangement';

describe('createArrangement', () => {
    it('should export createArrangement', () => {
        expect(subject.createArrangement).toBeDefined();
        const t = typeof subject.createArrangement;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
