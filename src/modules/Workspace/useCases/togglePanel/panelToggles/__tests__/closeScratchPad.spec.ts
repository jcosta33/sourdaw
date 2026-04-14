import { describe, it, expect } from 'vitest';
import * as subject from '../closeScratchPad';

describe('closeScratchPad', () => {
    it('should export closeScratchPad', () => {
        expect(subject.closeScratchPad).toBeDefined();
        const t = typeof subject.closeScratchPad;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
