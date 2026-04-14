import { describe, it, expect } from 'vitest';
import * as subject from '../addYeastProcessor';

describe('addYeastProcessor', () => {
    it('should export addYeastProcessor', () => {
        expect(subject.addYeastProcessor).toBeDefined();
        const t = typeof subject.addYeastProcessor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
