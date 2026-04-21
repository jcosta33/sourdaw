import { describe, it, expect } from 'vitest';

import * as subject from '../renameScratchPadSection';

describe('renameScratchPadSection', () => {
    it('should export renameScratchPadSection', () => {
        expect(subject.renameScratchPadSection).toBeDefined();
        const time = typeof subject.renameScratchPadSection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
