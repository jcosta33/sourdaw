import { describe, it, expect } from 'vitest';

import * as subject from '../removeScratchPadSection';

describe('removeScratchPadSection', () => {
    it('should export removeScratchPadSection', () => {
        expect(subject.removeScratchPadSection).toBeDefined();
        const time = typeof subject.removeScratchPadSection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
