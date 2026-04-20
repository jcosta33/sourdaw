import { describe, it, expect } from 'vitest';

import * as subject from '../addScratchPadSection';

describe('addScratchPadSection', () => {
    it('should export addScratchPadSection', () => {
        expect(subject.addScratchPadSection).toBeDefined();
        const t = typeof subject.addScratchPadSection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
