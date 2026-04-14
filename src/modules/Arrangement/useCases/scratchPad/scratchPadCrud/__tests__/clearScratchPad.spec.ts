import { describe, it, expect } from 'vitest';
import * as subject from '../clearScratchPad';

describe('clearScratchPad', () => {
    it('should export clearScratchPad', () => {
        expect(subject.clearScratchPad).toBeDefined();
        const t = typeof subject.clearScratchPad;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
