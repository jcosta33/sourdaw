import { describe, it, expect } from 'vitest';

import * as subject from '../closeScratchPad';

describe('closeScratchPad', () => {
    it('should export closeScratchPad', () => {
        expect(subject.closeScratchPad).toBeDefined();
        const time = typeof subject.closeScratchPad;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
