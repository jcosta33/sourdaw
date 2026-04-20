import { describe, it, expect } from 'vitest';

import * as subject from '../renameScratchPadSection';

describe('renameScratchPadSection', () => {
    it('should export renameScratchPadSection', () => {
        expect(subject.renameScratchPadSection).toBeDefined();
        const t = typeof subject.renameScratchPadSection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
