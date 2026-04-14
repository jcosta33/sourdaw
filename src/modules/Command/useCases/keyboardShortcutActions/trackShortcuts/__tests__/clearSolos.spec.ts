import { describe, it, expect } from 'vitest';
import * as subject from '../clearSolos';

describe('clearSolos', () => {
    it('should export clearSolos', () => {
        expect(subject.clearSolos).toBeDefined();
        const t = typeof subject.clearSolos;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
