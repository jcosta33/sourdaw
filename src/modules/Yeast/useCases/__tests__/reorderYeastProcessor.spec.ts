import { describe, it, expect } from 'vitest';
import * as subject from '../reorderYeastProcessor';

describe('reorderYeastProcessor', () => {
    it('should export reorderYeastProcessor', () => {
        expect(subject.reorderYeastProcessor).toBeDefined();
        const t = typeof subject.reorderYeastProcessor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
