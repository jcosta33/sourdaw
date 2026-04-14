import { describe, it, expect } from 'vitest';
import * as subject from '../switchArrangement';

describe('switchArrangement', () => {
    it('should export switchArrangement', () => {
        expect(subject.switchArrangement).toBeDefined();
        const t = typeof subject.switchArrangement;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
