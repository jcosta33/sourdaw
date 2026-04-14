import { describe, it, expect } from 'vitest';
import * as subject from '../setScratchPadSectionColor';

describe('setScratchPadSectionColor', () => {
    it('should export setScratchPadSectionColor', () => {
        expect(subject.setScratchPadSectionColor).toBeDefined();
        const t = typeof subject.setScratchPadSectionColor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
