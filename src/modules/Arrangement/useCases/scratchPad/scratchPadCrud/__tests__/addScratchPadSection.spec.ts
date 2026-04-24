import { describe, it, expect } from 'vitest';

import * as subject from '../addScratchPadSection';

describe('addScratchPadSection', () => {
    it('should export addScratchPadSection', () => {
        expect(subject.addScratchPadSection).toBeDefined();
        const time = typeof subject.addScratchPadSection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
