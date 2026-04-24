import { describe, it, expect } from 'vitest';

import * as subject from '../reorderScratchPadSection';

describe('reorderScratchPadSection', () => {
    it('should export reorderScratchPadSection', () => {
        expect(subject.reorderScratchPadSection).toBeDefined();
        const time = typeof subject.reorderScratchPadSection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
