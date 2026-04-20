import { describe, it, expect } from 'vitest';

import * as subject from '../captureArrangementToScratchPad';

describe('captureArrangementToScratchPad', () => {
    it('should export captureArrangementToScratchPad', () => {
        expect(subject.captureArrangementToScratchPad).toBeDefined();
        const t = typeof subject.captureArrangementToScratchPad;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
