import { describe, it, expect } from 'vitest';

import * as subject from '../reorderScratchPadSection';

describe('reorderScratchPadSection', () => {
    it('should export reorderScratchPadSection', () => {
        expect(subject.reorderScratchPadSection).toBeDefined();
        const t = typeof subject.reorderScratchPadSection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
