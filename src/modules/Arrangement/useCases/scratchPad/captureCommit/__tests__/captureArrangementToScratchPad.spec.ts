import { describe, it, expect } from 'vitest';

import * as subject from '../captureArrangementToScratchPad';

describe('captureArrangementToScratchPad', () => {
    it('should export captureArrangementToScratchPad', () => {
        expect(subject.captureArrangementToScratchPad).toBeDefined();
        const time = typeof subject.captureArrangementToScratchPad;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
