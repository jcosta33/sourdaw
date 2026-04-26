import { describe, it, expect } from 'vitest';

import * as subject from '../setScratchPadSectionColor';

describe('setScratchPadSectionColor', () => {
    it('should export setScratchPadSectionColor', () => {
        expect(subject.setScratchPadSectionColor).toBeDefined();
        const time = typeof subject.setScratchPadSectionColor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
