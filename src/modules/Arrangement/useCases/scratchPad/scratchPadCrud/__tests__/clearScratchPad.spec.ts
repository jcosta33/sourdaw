import { describe, it, expect } from 'vitest';

import * as subject from '../clearScratchPad';

describe('clearScratchPad', () => {
    it('should export clearScratchPad', () => {
        expect(subject.clearScratchPad).toBeDefined();
        const time = typeof subject.clearScratchPad;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
