import { describe, it, expect } from 'vitest';
import * as subject from '../removeYeastProcessor';

describe('removeYeastProcessor', () => {
    it('should export removeYeastProcessor', () => {
        expect(subject.removeYeastProcessor).toBeDefined();
        const t = typeof subject.removeYeastProcessor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
